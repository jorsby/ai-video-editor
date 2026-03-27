import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { normalizeKieAspectRatio, queueKieImageTask } from '@/lib/kie-image';
import { getSeriesStyleForProject } from '@/lib/prompts/style-injector';
import {
  isProviderRoutingError,
  resolveProvider,
} from '@/lib/provider-routing';
import { grokPlanSchema } from '@/lib/schemas/grok-plan';
import { createServiceClient } from '@/lib/supabase/admin';
import { matchAssetsWithAI } from '@/lib/supabase/series-asset-ai-matcher';
import {
  resolveSeriesAssetCandidatesForProject,
  type SeriesAssetCandidate,
} from '@/lib/supabase/series-asset-resolver';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

type Resolution = '0.5k' | '1k' | '2k';

const bodySchema = z.object({
  resolution: z.enum(['0.5k', '1k', '2k']).optional(),
  retry_failed: z.boolean().optional(),
});

function resolveStoryboardAspectRatio(value: unknown): string {
  if (typeof value !== 'string') return '9:16';
  return normalizeKieAspectRatio(value, '9:16');
}

type MissingAssetType = 'object' | 'background';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function appendPromptSuffix(prompt: string, suffix: string | null): string {
  if (!suffix) return prompt;
  return `${prompt.trim()} ${suffix}`.trim();
}

function appendStyleToScenePrompt(
  scenePrompt: string | string[],
  styleSuffix: string | null
): string | string[] {
  if (!styleSuffix) return scenePrompt;
  if (Array.isArray(scenePrompt)) {
    return scenePrompt.map((shotPrompt) =>
      appendPromptSuffix(shotPrompt, styleSuffix)
    );
  }
  return appendPromptSuffix(scenePrompt, styleSuffix);
}

function toScenePromptText(prompt: string | string[]): string {
  if (Array.isArray(prompt)) return prompt.join(' | ');
  return prompt;
}

type MatchedAsset = {
  url: string;
  variantId: string;
};

type MatchIssue = {
  gridPosition: number;
  name: string;
  confidence: number;
  reason: string;
};

type AssetJobMeta = {
  asset_type: MissingAssetType;
  grid_position: number;
  name: string;
  request_id: string | null;
  status: 'queued' | 'failed';
  error?: string;
};

type SkippedAssetMeta = {
  asset_type: MissingAssetType;
  grid_position: number;
  name: string;
  reason: 'no_prompt';
};

async function logGenerationAttempt(params: {
  db: ReturnType<typeof createServiceClient>;
  entityType: MissingAssetType;
  entityId: string;
  storyboardId: string;
  prompt: string | null;
  generationMeta?: Record<string, unknown>;
  feedback?: string | null;
  resultUrl?: string | null;
  status: 'pending' | 'failed' | 'skipped';
}) {
  const {
    db,
    entityType,
    entityId,
    storyboardId,
    prompt,
    generationMeta,
    feedback,
    resultUrl,
    status,
  } = params;

  const { data: latest } = await db
    .from('generation_logs')
    .select('version')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (latest?.version ?? 0) + 1;

  await db.from('generation_logs').insert({
    entity_type: entityType,
    entity_id: entityId,
    storyboard_id: storyboardId,
    version: nextVersion,
    prompt,
    generation_meta: generationMeta ?? null,
    feedback: feedback ?? null,
    result_url: resultUrl ?? null,
    status,
  });
}

async function resolveObjectMatches(params: {
  objectNames: string[];
  objectDescriptions: Array<string | null>;
  sceneObjectIndices: number[][];
  scenePrompts: Array<string | string[]>;
  candidates: SeriesAssetCandidate[];
}): Promise<{
  byGridPosition: Map<number, MatchedAsset>;
  aiMatched: number;
  issues: MatchIssue[];
}> {
  const {
    objectNames,
    objectDescriptions,
    sceneObjectIndices,
    scenePrompts,
    candidates,
  } = params;

  const uniqueGridPositions = Array.from(
    new Set(sceneObjectIndices.flat().filter((idx) => idx >= 0))
  );

  const usageByGrid = new Map<
    number,
    Array<{ sceneIndex: number; prompt: string }>
  >();

  for (let sceneIdx = 0; sceneIdx < sceneObjectIndices.length; sceneIdx++) {
    const scenePromptText = toScenePromptText(
      scenePrompts[sceneIdx] ?? ''
    ).slice(0, 600);

    for (const gridPosition of sceneObjectIndices[sceneIdx] ?? []) {
      if (!usageByGrid.has(gridPosition)) usageByGrid.set(gridPosition, []);
      const usageRows = usageByGrid.get(gridPosition);
      if (!usageRows) continue;

      usageRows.push({
        sceneIndex: sceneIdx,
        prompt: scenePromptText,
      });
    }
  }

  const aiMatches = await matchAssetsWithAI({
    itemType: 'object',
    items: uniqueGridPositions.map((gridPosition) => ({
      gridPosition,
      name: objectNames[gridPosition] ?? `Object ${gridPosition + 1}`,
      description: objectDescriptions[gridPosition] ?? null,
      sceneUsage: usageByGrid.get(gridPosition) ?? [],
    })),
    candidates,
  });

  const byGridPosition = new Map<number, MatchedAsset>();
  const issues: MatchIssue[] = [];
  let aiMatched = 0;

  for (const gridPosition of uniqueGridPositions) {
    const decision = aiMatches.get(gridPosition);
    if (decision?.matched && decision.candidate) {
      byGridPosition.set(gridPosition, {
        url: decision.candidate.url,
        variantId: decision.candidate.variantId,
      });
      aiMatched++;
      continue;
    }

    issues.push({
      gridPosition,
      name: objectNames[gridPosition] ?? `Object ${gridPosition + 1}`,
      confidence: decision?.confidence ?? 0,
      reason: decision?.reason ?? 'No AI match selected.',
    });
  }

  return {
    byGridPosition,
    aiMatched,
    issues,
  };
}

async function resolveBackgroundMatches(params: {
  backgroundNames: string[];
  sceneBgIndices: number[];
  scenePrompts: Array<string | string[]>;
  candidates: SeriesAssetCandidate[];
}): Promise<{
  byGridPosition: Map<number, MatchedAsset>;
  aiMatched: number;
  issues: MatchIssue[];
}> {
  const { backgroundNames, sceneBgIndices, scenePrompts, candidates } = params;

  const uniqueGridPositions = Array.from(
    new Set(sceneBgIndices.filter((idx) => idx >= 0))
  );

  const usageByGrid = new Map<
    number,
    Array<{ sceneIndex: number; prompt: string }>
  >();

  for (let sceneIdx = 0; sceneIdx < sceneBgIndices.length; sceneIdx++) {
    const gridPosition = sceneBgIndices[sceneIdx];
    if (gridPosition == null || gridPosition < 0) continue;

    if (!usageByGrid.has(gridPosition)) usageByGrid.set(gridPosition, []);

    const usageRows = usageByGrid.get(gridPosition);
    if (!usageRows) continue;

    usageRows.push({
      sceneIndex: sceneIdx,
      prompt: toScenePromptText(scenePrompts[sceneIdx] ?? '').slice(0, 600),
    });
  }

  const aiMatches = await matchAssetsWithAI({
    itemType: 'background',
    items: uniqueGridPositions.map((gridPosition) => ({
      gridPosition,
      name: backgroundNames[gridPosition] ?? `Background ${gridPosition + 1}`,
      description: null,
      sceneUsage: usageByGrid.get(gridPosition) ?? [],
    })),
    candidates,
  });

  const byGridPosition = new Map<number, MatchedAsset>();
  const issues: MatchIssue[] = [];
  let aiMatched = 0;

  for (const gridPosition of uniqueGridPositions) {
    const decision = aiMatches.get(gridPosition);
    if (decision?.matched && decision.candidate) {
      byGridPosition.set(gridPosition, {
        url: decision.candidate.url,
        variantId: decision.candidate.variantId,
      });
      aiMatched++;
      continue;
    }

    issues.push({
      gridPosition,
      name: backgroundNames[gridPosition] ?? `Background ${gridPosition + 1}`,
      confidence: decision?.confidence ?? 0,
      reason: decision?.reason ?? 'No AI match selected.',
    });
  }

  return {
    byGridPosition,
    aiMatched,
    issues,
  };
}

function summarizeUsagePrompts(
  prompts: Array<string | string[]>,
  maxItems = 2
): string {
  const samples = prompts
    .map((prompt) => toScenePromptText(prompt).trim())
    .filter(Boolean)
    .slice(0, maxItems);

  if (samples.length === 0) return '';

  return samples
    .map((sample, index) => `Scene cue ${index + 1}: ${sample.slice(0, 280)}`)
    .join('\n');
}

function buildMissingObjectPrompt(params: {
  name: string;
  description: string | null;
  usagePrompts: Array<string | string[]>;
}): string {
  const { name, description, usagePrompts } = params;
  const details = description?.trim() ? ` ${description.trim()}` : '';
  const usage = summarizeUsagePrompts(usagePrompts);

  return [
    'Generate ONE standalone reusable visual asset.',
    `Asset name: ${name}.${details}`,
    'Render a single isolated subject on a transparent background (alpha), no text, no watermark, no background scene.',
    'Keep full subject visible with clean cutout edges, no floor shadow, and high detail for reuse across scenes.',
    usage ? `Story context for visual consistency:\n${usage}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildMissingBackgroundPrompt(params: {
  name: string;
  usagePrompts: Array<string | string[]>;
}): string {
  const { name, usagePrompts } = params;
  const usage = summarizeUsagePrompts(usagePrompts);

  return [
    'Generate ONE reusable location background plate.',
    `Location name: ${name}.`,
    'Environment only, no people or characters, no text, no watermark.',
    'Use neutral baseline lighting so this background can be reused in different scene lighting conditions.',
    usage ? `Story context for set design consistency:\n${usage}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

async function queueMissingAssetJob(params: {
  prompt: string;
  resolution: Resolution;
  webhookUrl: string;
  assetType: MissingAssetType;
  backgroundAspectRatio: string;
}) {
  const assetAspectRatio =
    params.assetType === 'background' ? params.backgroundAspectRatio : '1:1';

  const queued = await queueKieImageTask({
    prompt: params.prompt,
    callbackUrl: params.webhookUrl,
    aspectRatio: assetAspectRatio,
    resolution: params.resolution,
    outputFormat: 'png',
  });

  if (!queued.requestId) {
    throw new Error('kie.ai response missing task_id');
  }

  return queued.requestId;
}

type StoryboardScene = {
  id: string;
  order: number;
  prompt: string | null;
  multi_prompt: string[] | null;
  shot_durations: number[] | null;
  duration: number | null;
  background_name: string | null;
  object_names: string[] | null;
  audio_text: string | null;
  language: string | null;
};

function getScenePromptList(scene: StoryboardScene): string[] {
  if (Array.isArray(scene.multi_prompt) && scene.multi_prompt.length > 0) {
    return scene.multi_prompt
      .map((prompt) => (typeof prompt === 'string' ? prompt.trim() : ''))
      .filter((prompt) => prompt.length > 0);
  }

  if (typeof scene.prompt === 'string' && scene.prompt.trim().length > 0) {
    return [scene.prompt.trim()];
  }

  return [];
}

async function approveExistingStoryboardScenes(params: {
  db: ReturnType<typeof createServiceClient>;
  storyboardId: string;
  projectId: string;
  planStatus: string;
  userId: string;
}) {
  const { db, storyboardId, projectId, planStatus, userId } = params;

  const getFirstSuccessfulAssetImageUrl = (
    variants: unknown
  ): string | null => {
    if (!Array.isArray(variants)) return null;

    for (const variant of variants) {
      if (!isRecord(variant)) continue;
      const images = variant.series_asset_variant_images;
      if (!Array.isArray(images)) continue;

      for (const image of images) {
        if (!isRecord(image)) continue;
        // Backward compatibility: older rows don't have image.status.
        if (
          typeof image.status === 'string' &&
          image.status.length > 0 &&
          image.status !== 'success'
        ) {
          continue;
        }
        if (typeof image.url !== 'string') continue;

        const trimmedUrl = image.url.trim();
        if (trimmedUrl.length > 0) return trimmedUrl;
      }
    }

    return null;
  };

  if (planStatus !== 'draft') {
    return NextResponse.json(
      { error: 'Storyboard must be in draft status to approve' },
      { status: 409 }
    );
  }

  const { data: scenes, error: scenesError } = await db
    .from('scenes')
    .select(
      'id, order, prompt, multi_prompt, shot_durations, duration, background_name, object_names, audio_text, language'
    )
    .eq('storyboard_id', storyboardId)
    .order('order', { ascending: true });

  if (scenesError) {
    return NextResponse.json(
      { error: 'Failed to load storyboard scenes' },
      { status: 500 }
    );
  }

  const storyboardScenes = (scenes ?? []) as StoryboardScene[];

  if (storyboardScenes.length === 0) {
    return NextResponse.json(
      { error: 'Storyboard must contain at least one scene' },
      { status: 400 }
    );
  }

  const validationErrors: string[] = [];

  for (const scene of storyboardScenes) {
    const sceneLabel = `scene ${scene.order + 1}`;
    const shotPrompts = getScenePromptList(scene);
    const duration = Number(scene.duration);
    const backgroundName =
      typeof scene.background_name === 'string'
        ? scene.background_name.trim()
        : '';

    if (shotPrompts.length === 0) {
      validationErrors.push(`${sceneLabel}: shot_prompts is required`);
    }

    if (!backgroundName) {
      validationErrors.push(`${sceneLabel}: background_name is required`);
    }

    if (duration !== 6 && duration !== 10) {
      validationErrors.push(`${sceneLabel}: duration must be 6 or 10`);
    }
  }

  if (validationErrors.length > 0) {
    return NextResponse.json(
      {
        error: 'Scene validation failed',
        details: validationErrors,
      },
      { status: 400 }
    );
  }

  const { data: series, error: seriesError } = await db
    .from('series')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle();

  if (seriesError || !series?.id) {
    return NextResponse.json(
      { error: 'Series not found for storyboard project' },
      { status: 404 }
    );
  }

  const { data: seriesAssets, error: assetError } = await db
    .schema('studio')
    .from('series_assets')
    .select('slug, type')
    .eq('series_id', series.id);

  if (assetError) {
    return NextResponse.json(
      { error: 'Failed to load series assets' },
      { status: 500 }
    );
  }

  const locationSlugs = new Set(
    (seriesAssets ?? [])
      .filter((asset: { type: string }) => asset.type === 'location')
      .map((asset: { slug: string }) => asset.slug)
      .filter((slug: string) => slug.length > 0)
  );

  const objectSlugs = new Set(
    (seriesAssets ?? [])
      .filter(
        (asset: { type: string }) =>
          asset.type === 'character' || asset.type === 'prop'
      )
      .map((asset: { slug: string }) => asset.slug)
      .filter((slug: string) => slug.length > 0)
  );

  const assetValidationErrors: string[] = [];

  for (const scene of storyboardScenes) {
    const sceneLabel = `scene ${scene.order + 1}`;
    const backgroundSlug =
      typeof scene.background_name === 'string'
        ? scene.background_name.trim()
        : '';

    if (backgroundSlug && !locationSlugs.has(backgroundSlug)) {
      assetValidationErrors.push(
        `${sceneLabel}: background_name slug "${backgroundSlug}" not found in series location assets`
      );
    }

    const sceneObjects = Array.isArray(scene.object_names)
      ? scene.object_names
          .map((name) => (typeof name === 'string' ? name.trim() : ''))
          .filter((name) => name.length > 0)
      : [];

    for (const objectSlug of sceneObjects) {
      if (!objectSlugs.has(objectSlug)) {
        assetValidationErrors.push(
          `${sceneLabel}: object slug "${objectSlug}" not found in series assets`
        );
      }
    }
  }

  if (assetValidationErrors.length > 0) {
    return NextResponse.json(
      {
        error: 'Asset validation failed',
        details: assetValidationErrors,
      },
      { status: 400 }
    );
  }

  const sceneIds = storyboardScenes.map((scene) => scene.id);

  if (sceneIds.length > 0) {
    const { error: deleteVoiceoversError } = await db
      .from('voiceovers')
      .delete()
      .in('scene_id', sceneIds);

    if (deleteVoiceoversError) {
      return NextResponse.json(
        { error: 'Failed to refresh scene voiceovers' },
        { status: 500 }
      );
    }
  }

  const voiceoverRows = storyboardScenes
    .map((scene) => {
      const text =
        typeof scene.audio_text === 'string' ? scene.audio_text.trim() : '';
      if (!text) return null;

      const language =
        typeof scene.language === 'string' && scene.language.trim().length > 0
          ? scene.language.trim()
          : 'tr';

      return {
        scene_id: scene.id,
        text,
        language,
        status: 'success',
      };
    })
    .filter(
      (
        row
      ): row is {
        scene_id: string;
        text: string;
        language: string;
        status: 'success';
      } => !!row
    );

  if (voiceoverRows.length > 0) {
    const { error: voiceoverInsertError } = await db
      .from('voiceovers')
      .insert(voiceoverRows);

    if (voiceoverInsertError) {
      return NextResponse.json(
        { error: 'Failed to create scene voiceovers' },
        { status: 500 }
      );
    }
  }

  const backgroundRows: Array<{
    scene_id: string;
    url: string;
    final_url: string;
    status: 'success';
    grid_position: number;
  }> = [];
  const objectRows: Array<{
    scene_id: string;
    url: string;
    final_url: string;
    status: 'success';
    grid_position: number;
  }> = [];

  const backgroundUrlBySlug = new Map<string, string>();
  const objectUrlBySlug = new Map<string, string>();

  for (const scene of storyboardScenes) {
    const sceneLabel = `scene ${scene.order + 1}`;
    const backgroundSlug =
      typeof scene.background_name === 'string'
        ? scene.background_name.trim()
        : '';

    if (backgroundSlug) {
      let backgroundUrl = backgroundUrlBySlug.get(backgroundSlug);

      if (!backgroundUrl) {
        const { data: backgroundAssets, error: backgroundAssetError } = await db
          .schema('studio')
          .from('series_assets')
          .select(
            'id, series_asset_variants(id, series_asset_variant_images(url, storage_path))'
          )
          .eq('series_id', series.id)
          .eq('slug', backgroundSlug)
          .eq('type', 'location')
          .limit(1);

        if (backgroundAssetError) {
          return NextResponse.json(
            { error: 'Failed to resolve background asset URL' },
            { status: 500 }
          );
        }

        const backgroundAsset = backgroundAssets?.[0];
        const resolvedBackgroundUrl = getFirstSuccessfulAssetImageUrl(
          backgroundAsset?.series_asset_variants
        );

        if (!resolvedBackgroundUrl) {
          return NextResponse.json(
            {
              error: `No successful image found for background slug "${backgroundSlug}" in ${sceneLabel}`,
            },
            { status: 400 }
          );
        }

        backgroundUrl = resolvedBackgroundUrl;
        backgroundUrlBySlug.set(backgroundSlug, resolvedBackgroundUrl);
      }

      backgroundRows.push({
        scene_id: scene.id,
        url: backgroundUrl,
        final_url: backgroundUrl,
        status: 'success',
        grid_position: 0,
      });
    }

    const sceneObjects = Array.isArray(scene.object_names)
      ? scene.object_names
          .map((name) => (typeof name === 'string' ? name.trim() : ''))
          .filter((name) => name.length > 0)
      : [];

    for (const [index, objectSlug] of sceneObjects.entries()) {
      let objectUrl = objectUrlBySlug.get(objectSlug);

      if (!objectUrl) {
        const { data: objectAssets, error: objectAssetError } = await db
          .schema('studio')
          .from('series_assets')
          .select(
            'id, series_asset_variants(id, series_asset_variant_images(url, storage_path))'
          )
          .eq('series_id', series.id)
          .eq('slug', objectSlug)
          .in('type', ['character', 'prop'])
          .limit(1);

        if (objectAssetError) {
          return NextResponse.json(
            { error: 'Failed to resolve object asset URL' },
            { status: 500 }
          );
        }

        const objectAsset = objectAssets?.[0];
        const resolvedObjectUrl = getFirstSuccessfulAssetImageUrl(
          objectAsset?.series_asset_variants
        );

        if (!resolvedObjectUrl) {
          return NextResponse.json(
            {
              error: `No successful image found for object slug "${objectSlug}" in ${sceneLabel}`,
            },
            { status: 400 }
          );
        }

        objectUrl = resolvedObjectUrl;
        objectUrlBySlug.set(objectSlug, resolvedObjectUrl);
      }

      objectRows.push({
        scene_id: scene.id,
        url: objectUrl,
        final_url: objectUrl,
        status: 'success',
        grid_position: index,
      });
    }
  }

  if (backgroundRows.length > 0) {
    const { error: backgroundInsertError } = await db
      .schema('studio')
      .from('backgrounds')
      .insert(backgroundRows);

    if (backgroundInsertError) {
      return NextResponse.json(
        { error: 'Failed to create scene backgrounds' },
        { status: 500 }
      );
    }
  }

  if (objectRows.length > 0) {
    const { error: objectInsertError } = await db
      .schema('studio')
      .from('objects')
      .insert(objectRows);

    if (objectInsertError) {
      return NextResponse.json(
        { error: 'Failed to create scene objects' },
        { status: 500 }
      );
    }
  }

  const { error: approveError } = await db
    .from('storyboards')
    .update({ plan_status: 'approved' })
    .eq('id', storyboardId)
    .eq('plan_status', 'draft');

  if (approveError) {
    return NextResponse.json(
      { error: 'Failed to approve storyboard' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    plan_status: 'approved',
    storyboard_id: storyboardId,
    scenes_validated: storyboardScenes.length,
    voiceovers_created: voiceoverRows.length,
  });
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: storyboardId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: parsedBody.error.issues[0]?.message ?? 'Invalid request body',
        },
        { status: 400 }
      );
    }

    const resolution = parsedBody.data.resolution ?? '1k';
    const retryFailed = parsedBody.data.retry_failed ?? false;

    const db = createServiceClient('studio');

    const { data: storyboard, error: storyboardError } = await db
      .from('storyboards')
      .select('id, project_id, mode, plan, plan_status, aspect_ratio')
      .eq('id', storyboardId)
      .single();

    if (storyboardError || !storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    const { data: project, error: projectError } = await db
      .from('projects')
      .select('id')
      .eq('id', storyboard.project_id)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const backgroundAspectRatio = resolveStoryboardAspectRatio(
      storyboard.aspect_ratio
    );

    const { data: existingScenes, error: existingScenesError } = await db
      .from('scenes')
      .select('id')
      .eq('storyboard_id', storyboardId)
      .limit(1);

    if (existingScenesError) {
      return NextResponse.json(
        { error: 'Failed to load storyboard scenes' },
        { status: 500 }
      );
    }

    if ((existingScenes ?? []).length > 0) {
      return approveExistingStoryboardScenes({
        db,
        storyboardId,
        projectId: storyboard.project_id as string,
        planStatus: storyboard.plan_status,
        userId: user.id,
      });
    }

    const parsedPlan = grokPlanSchema.safeParse(storyboard.plan);
    if (!parsedPlan.success) {
      return NextResponse.json(
        { error: 'Storyboard plan is invalid or missing' },
        { status: 400 }
      );
    }

    const plan = parsedPlan.data;

    const providerResolution = await resolveProvider({
      service: 'video',
      req,
      body: parsedBody.data,
    });

    const existingAssetJobs =
      isRecord(storyboard.plan) && isRecord(storyboard.plan.v2_asset_jobs)
        ? storyboard.plan.v2_asset_jobs
        : null;

    const canRetryExistingFailed =
      retryFailed &&
      storyboard.plan_status === 'failed' &&
      storyboard.mode === 'ref_to_video';

    if (
      existingAssetJobs &&
      !canRetryExistingFailed &&
      (storyboard.plan_status === 'generating' ||
        storyboard.plan_status === 'approved' ||
        storyboard.plan_status === 'failed')
    ) {
      return NextResponse.json({
        status: storyboard.plan_status,
        asset_jobs: Array.isArray(existingAssetJobs.jobs)
          ? existingAssetJobs.jobs
          : [],
      });
    }

    const { data: existingScene } = await db
      .from('scenes')
      .select('id')
      .eq('storyboard_id', storyboardId)
      .limit(1)
      .maybeSingle();

    if (existingScene && !canRetryExistingFailed) {
      if (
        storyboard.plan_status === 'generating' ||
        storyboard.plan_status === 'approved' ||
        storyboard.plan_status === 'failed'
      ) {
        return NextResponse.json({
          status: storyboard.plan_status,
          asset_jobs:
            existingAssetJobs && Array.isArray(existingAssetJobs.jobs)
              ? existingAssetJobs.jobs
              : [],
        });
      }

      return NextResponse.json(
        { error: 'Storyboard already has scenes. Cannot approve twice.' },
        { status: 409 }
      );
    }

    let seriesStyleSuffix: string | null = null;
    try {
      seriesStyleSuffix = await getSeriesStyleForProject(
        db,
        storyboard.project_id as string
      );
    } catch (styleError) {
      console.warn(
        '[v2/storyboard/approve] Failed to resolve series style (non-fatal):',
        styleError
      );
    }

    const styledScenePrompts = plan.scene_prompts.map((scenePrompt) =>
      appendStyleToScenePrompt(scenePrompt, seriesStyleSuffix)
    );

    const queueFailureMessage = (error: unknown) =>
      String(error instanceof Error ? error.message : error).slice(0, 400);

    if (canRetryExistingFailed) {
      const webhookBase = resolveWebhookBaseUrl(req);
      if (!webhookBase) {
        return NextResponse.json(
          { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
          { status: 500 }
        );
      }

      const { data: existingScenes, error: scenesError } = await db
        .from('scenes')
        .select('id')
        .eq('storyboard_id', storyboardId);

      if (scenesError || !existingScenes || existingScenes.length === 0) {
        return NextResponse.json(
          { error: 'Storyboard scenes not found for retry' },
          { status: 404 }
        );
      }

      const sceneIds = existingScenes.map((scene: { id: string }) => scene.id);

      const [{ data: failedObjectsRows }, { data: failedBackgroundRows }] =
        await Promise.all([
          db
            .from('objects')
            .select('id, grid_position, name, description, generation_prompt')
            .in('scene_id', sceneIds)
            .eq('status', 'failed'),
          db
            .from('backgrounds')
            .select('id, grid_position, name, generation_prompt')
            .in('scene_id', sceneIds)
            .eq('status', 'failed'),
        ]);

      const objectFailedByPosition = new Map<
        number,
        {
          id: string;
          name: string;
          description: string | null;
          generation_prompt: string | null;
        }
      >();
      for (const row of failedObjectsRows ?? []) {
        const position = Number(row.grid_position);
        if (!Number.isInteger(position) || position < 0) continue;
        if (objectFailedByPosition.has(position)) continue;

        objectFailedByPosition.set(position, {
          id: row.id,
          name:
            typeof row.name === 'string' && row.name.trim().length > 0
              ? row.name
              : (plan.objects[position]?.name ?? `Object ${position + 1}`),
          description:
            typeof row.description === 'string' ? row.description : null,
          generation_prompt:
            typeof row.generation_prompt === 'string'
              ? row.generation_prompt
              : null,
        });
      }

      const backgroundFailedByPosition = new Map<
        number,
        { id: string; name: string; generation_prompt: string | null }
      >();
      for (const row of failedBackgroundRows ?? []) {
        const position = Number(row.grid_position);
        if (!Number.isInteger(position) || position < 0) continue;
        if (backgroundFailedByPosition.has(position)) continue;

        backgroundFailedByPosition.set(position, {
          id: row.id,
          name:
            typeof row.name === 'string' && row.name.trim().length > 0
              ? row.name
              : (plan.background_names[position] ??
                `Background ${position + 1}`),
          generation_prompt:
            typeof row.generation_prompt === 'string'
              ? row.generation_prompt
              : null,
        });
      }

      const objectUsageByGrid = new Map<number, Array<string | string[]>>();
      const backgroundUsageByGrid = new Map<number, Array<string | string[]>>();

      for (let sceneIdx = 0; sceneIdx < styledScenePrompts.length; sceneIdx++) {
        const scenePrompt = styledScenePrompts[sceneIdx];

        for (const gridPosition of plan.scene_object_indices[sceneIdx] ?? []) {
          if (!objectUsageByGrid.has(gridPosition)) {
            objectUsageByGrid.set(gridPosition, []);
          }
          objectUsageByGrid.get(gridPosition)?.push(scenePrompt);
        }

        const bgPosition = plan.scene_bg_indices[sceneIdx];
        if (bgPosition != null && bgPosition >= 0) {
          if (!backgroundUsageByGrid.has(bgPosition)) {
            backgroundUsageByGrid.set(bgPosition, []);
          }
          backgroundUsageByGrid.get(bgPosition)?.push(scenePrompt);
        }
      }

      const assetJobs: AssetJobMeta[] = [];
      const skippedAssets: SkippedAssetMeta[] = [];
      const callbackPath = '/api/webhook/kieai';

      for (const [gridPosition, info] of objectFailedByPosition) {
        const prompt = info.generation_prompt?.trim() ?? '';

        if (!prompt) {
          skippedAssets.push({
            asset_type: 'object',
            grid_position: gridPosition,
            name: info.name,
            reason: 'no_prompt',
          });

          await logGenerationAttempt({
            db,
            entityType: 'object',
            entityId: info.id,
            storyboardId,
            prompt: null,
            status: 'skipped',
            feedback: 'Skipped: no generation_prompt saved',
          });

          continue;
        }

        const webhookParams = new URLSearchParams({
          step: 'GenerateMissingAssetImage',
          storyboard_id: storyboardId,
          asset_type: 'object',
          grid_position: String(gridPosition),
          asset_name: info.name,
          ...(info.description ? { asset_description: info.description } : {}),
        });

        try {
          const requestId = await queueMissingAssetJob({
            prompt,
            resolution,
            webhookUrl: `${webhookBase}${callbackPath}?${webhookParams.toString()}`,
            assetType: 'object',
            backgroundAspectRatio,
          });

          await db
            .from('objects')
            .update({
              request_id: requestId,
              status: 'processing',
              error_message: null,
            })
            .in('scene_id', sceneIds)
            .eq('grid_position', gridPosition)
            .eq('status', 'failed');

          await logGenerationAttempt({
            db,
            entityType: 'object',
            entityId: info.id,
            storyboardId,
            prompt,
            generationMeta: {
              model: 'nano-banana-2',
              provider: providerResolution.provider,
              output_format: 'png',
              resolution,
              generated_at: new Date().toISOString(),
              generated_by: 'system',
            },
            status: 'pending',
          });

          assetJobs.push({
            asset_type: 'object',
            grid_position: gridPosition,
            name: info.name,
            request_id: requestId,
            status: 'queued',
          });
        } catch (queueError) {
          const errorMessage = queueFailureMessage(queueError);

          await db
            .from('objects')
            .update({ status: 'failed', error_message: errorMessage })
            .in('scene_id', sceneIds)
            .eq('grid_position', gridPosition)
            .eq('status', 'failed');

          await logGenerationAttempt({
            db,
            entityType: 'object',
            entityId: info.id,
            storyboardId,
            prompt,
            status: 'failed',
            feedback: errorMessage,
          });

          assetJobs.push({
            asset_type: 'object',
            grid_position: gridPosition,
            name: info.name,
            request_id: null,
            status: 'failed',
            error: errorMessage,
          });
        }
      }

      for (const [gridPosition, info] of backgroundFailedByPosition) {
        const prompt = info.generation_prompt?.trim() ?? '';

        if (!prompt) {
          skippedAssets.push({
            asset_type: 'background',
            grid_position: gridPosition,
            name: info.name,
            reason: 'no_prompt',
          });

          await logGenerationAttempt({
            db,
            entityType: 'background',
            entityId: info.id,
            storyboardId,
            prompt: null,
            status: 'skipped',
            feedback: 'Skipped: no generation_prompt saved',
          });

          continue;
        }

        const webhookParams = new URLSearchParams({
          step: 'GenerateMissingAssetImage',
          storyboard_id: storyboardId,
          asset_type: 'background',
          grid_position: String(gridPosition),
          asset_name: info.name,
        });

        try {
          const requestId = await queueMissingAssetJob({
            prompt,
            resolution,
            webhookUrl: `${webhookBase}${callbackPath}?${webhookParams.toString()}`,
            assetType: 'background',
            backgroundAspectRatio,
          });

          await db
            .from('backgrounds')
            .update({
              request_id: requestId,
              status: 'processing',
              error_message: null,
            })
            .in('scene_id', sceneIds)
            .eq('grid_position', gridPosition)
            .eq('status', 'failed');

          await logGenerationAttempt({
            db,
            entityType: 'background',
            entityId: info.id,
            storyboardId,
            prompt,
            generationMeta: {
              model: 'nano-banana-2',
              provider: providerResolution.provider,
              output_format: 'png',
              resolution,
              generated_at: new Date().toISOString(),
              generated_by: 'system',
            },
            status: 'pending',
          });

          assetJobs.push({
            asset_type: 'background',
            grid_position: gridPosition,
            name: info.name,
            request_id: requestId,
            status: 'queued',
          });
        } catch (queueError) {
          const errorMessage = queueFailureMessage(queueError);

          await db
            .from('backgrounds')
            .update({ status: 'failed', error_message: errorMessage })
            .in('scene_id', sceneIds)
            .eq('grid_position', gridPosition)
            .eq('status', 'failed');

          await logGenerationAttempt({
            db,
            entityType: 'background',
            entityId: info.id,
            storyboardId,
            prompt,
            status: 'failed',
            feedback: errorMessage,
          });

          assetJobs.push({
            asset_type: 'background',
            grid_position: gridPosition,
            name: info.name,
            request_id: null,
            status: 'failed',
            error: errorMessage,
          });
        }
      }

      const queuedJobsCount = assetJobs.filter(
        (job) => job.status === 'queued'
      ).length;
      const failedJobsCount = assetJobs.filter(
        (job) => job.status === 'failed'
      ).length;
      const skippedJobsCount = skippedAssets.length;

      const nextStatus =
        queuedJobsCount > 0
          ? 'generating'
          : failedJobsCount > 0 || skippedJobsCount > 0
            ? 'failed'
            : 'approved';

      const previousJobs =
        existingAssetJobs && Array.isArray(existingAssetJobs.jobs)
          ? existingAssetJobs.jobs
          : [];

      const retryPlan = {
        ...(storyboard.plan as Record<string, unknown>),
        scene_prompts: styledScenePrompts,
        v2_asset_jobs: {
          strategy: 'direct-asset',
          provider: providerResolution.provider,
          resolution,
          queued: queuedJobsCount,
          failed: failedJobsCount,
          skipped: skippedJobsCount,
          jobs: [...previousJobs, ...assetJobs],
          skipped_items: skippedAssets,
          retried_at: new Date().toISOString(),
        },
      };

      await db
        .from('storyboards')
        .update({ plan_status: nextStatus, plan: retryPlan })
        .eq('id', storyboardId);

      return NextResponse.json({
        status: nextStatus,
        provider: providerResolution.provider,
        retried: true,
        asset_jobs: assetJobs,
        skipped: skippedAssets,
      });
    }

    let seriesAssetCandidates: Awaited<
      ReturnType<typeof resolveSeriesAssetCandidatesForProject>
    > | null = null;

    try {
      seriesAssetCandidates = await resolveSeriesAssetCandidatesForProject(
        db,
        storyboard.project_id as string
      );
    } catch (seriesAssetError) {
      console.warn(
        '[v2/storyboard/approve] Series asset candidate lookup failed (non-fatal):',
        seriesAssetError
      );
    }

    const objectNames = plan.objects.map((object) => object.name);
    const objectDescriptions = plan.objects.map((object) =>
      typeof object.description === 'string' ? object.description : null
    );

    const objectAiMatch = await resolveObjectMatches({
      objectNames,
      objectDescriptions,
      sceneObjectIndices: plan.scene_object_indices,
      scenePrompts: styledScenePrompts,
      candidates: [
        ...(seriesAssetCandidates?.characters ?? []),
        ...(seriesAssetCandidates?.props ?? []),
      ],
    });

    const backgroundAiMatch = await resolveBackgroundMatches({
      backgroundNames: plan.background_names,
      sceneBgIndices: plan.scene_bg_indices,
      scenePrompts: styledScenePrompts,
      candidates: seriesAssetCandidates?.locations ?? [],
    });

    const requiredObjectPositions = Array.from(
      new Set(plan.scene_object_indices.flat().filter((idx) => idx >= 0))
    );
    const requiredBackgroundPositions = Array.from(
      new Set(plan.scene_bg_indices.filter((idx) => idx >= 0))
    );

    const missingObjectPositions = requiredObjectPositions.filter(
      (gridPosition) => !objectAiMatch.byGridPosition.has(gridPosition)
    );
    const missingBackgroundPositions = requiredBackgroundPositions.filter(
      (gridPosition) => !backgroundAiMatch.byGridPosition.has(gridPosition)
    );

    const missingObjectCount = missingObjectPositions.length;
    const missingBackgroundCount = missingBackgroundPositions.length;

    const objectUsageByGrid = new Map<number, Array<string | string[]>>();
    const backgroundUsageByGrid = new Map<number, Array<string | string[]>>();

    for (let sceneIdx = 0; sceneIdx < styledScenePrompts.length; sceneIdx++) {
      const scenePrompt = styledScenePrompts[sceneIdx];

      for (const gridPosition of plan.scene_object_indices[sceneIdx] ?? []) {
        if (!objectUsageByGrid.has(gridPosition)) {
          objectUsageByGrid.set(gridPosition, []);
        }
        objectUsageByGrid.get(gridPosition)?.push(scenePrompt);
      }

      const bgPosition = plan.scene_bg_indices[sceneIdx];
      if (bgPosition != null && bgPosition >= 0) {
        if (!backgroundUsageByGrid.has(bgPosition)) {
          backgroundUsageByGrid.set(bgPosition, []);
        }
        backgroundUsageByGrid.get(bgPosition)?.push(scenePrompt);
      }
    }

    const defaultObjectPromptByGrid = new Map<number, string>();
    for (const gridPosition of missingObjectPositions) {
      const object = plan.objects[gridPosition];
      const assetName = object?.name ?? `Object ${gridPosition + 1}`;
      const assetDescription =
        typeof object?.description === 'string' ? object.description : null;

      defaultObjectPromptByGrid.set(
        gridPosition,
        buildMissingObjectPrompt({
          name: assetName,
          description: assetDescription,
          usagePrompts: objectUsageByGrid.get(gridPosition) ?? [],
        })
      );
    }

    const defaultBackgroundPromptByGrid = new Map<number, string>();
    for (const gridPosition of missingBackgroundPositions) {
      const assetName =
        plan.background_names[gridPosition] ?? `Background ${gridPosition + 1}`;

      defaultBackgroundPromptByGrid.set(
        gridPosition,
        buildMissingBackgroundPrompt({
          name: assetName,
          usagePrompts: backgroundUsageByGrid.get(gridPosition) ?? [],
        })
      );
    }

    const sceneIds: string[] = [];
    const sceneCount = styledScenePrompts.length;
    const languages = Object.keys(plan.voiceover_list);

    for (let i = 0; i < sceneCount; i++) {
      const scenePrompt = styledScenePrompts[i];

      // Build multi_shots metadata from plan if available
      const shotDurations = plan.scene_shot_durations?.[i];
      const multiShotsData =
        Array.isArray(scenePrompt) && Array.isArray(shotDurations)
          ? shotDurations.map((d) => ({ duration: String(d) }))
          : null;

      const { data: scene, error: sceneError } = await db
        .from('scenes')
        .insert({
          storyboard_id: storyboardId,
          order: i,
          prompt: Array.isArray(scenePrompt) ? null : scenePrompt,
          multi_prompt: Array.isArray(scenePrompt) ? scenePrompt : null,
          multi_shots: multiShotsData,
        })
        .select('id')
        .single();

      if (sceneError || !scene) {
        return NextResponse.json(
          { error: 'Failed to create scene rows' },
          { status: 500 }
        );
      }

      sceneIds.push(scene.id as string);

      for (const lang of languages) {
        const { error: voiceoverError } = await db.from('voiceovers').insert({
          scene_id: scene.id,
          text: plan.voiceover_list[lang]?.[i] ?? '',
          language: lang,
          status: 'success',
        });

        if (voiceoverError) {
          return NextResponse.json(
            { error: 'Failed to create voiceover rows' },
            { status: 500 }
          );
        }
      }
    }

    for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
      const objectIndices = plan.scene_object_indices[sceneIdx] ?? [];

      for (let position = 0; position < objectIndices.length; position++) {
        const gridPosition = objectIndices[position];
        const object = plan.objects[gridPosition];
        const matchedAsset = objectAiMatch.byGridPosition.get(gridPosition);

        const generationPrompt =
          defaultObjectPromptByGrid.get(gridPosition) ?? null;

        const { error: objectError } = await db.from('objects').insert({
          scene_id: sceneIds[sceneIdx],
          scene_order: position,
          grid_position: gridPosition,
          name: object?.name ?? `Object ${gridPosition + 1}`,
          description: object?.description ?? null,
          url: matchedAsset?.url ?? null,
          final_url: matchedAsset?.url ?? null,
          series_asset_variant_id: matchedAsset?.variantId ?? null,
          generation_prompt: generationPrompt,
          generation_meta: generationPrompt
            ? {
                model: 'nano-banana-2',
                provider: providerResolution.provider,
                output_format: 'png',
                resolution,
                use_case: 'missing_object_generation',
                generated_by: 'system',
              }
            : {},
          status: matchedAsset ? 'success' : 'pending',
        });

        if (objectError) {
          return NextResponse.json(
            { error: 'Failed to create object rows' },
            { status: 500 }
          );
        }
      }
    }

    for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
      const bgIndex = plan.scene_bg_indices[sceneIdx];
      const matchedBg = backgroundAiMatch.byGridPosition.get(bgIndex);

      const generationPrompt =
        defaultBackgroundPromptByGrid.get(bgIndex) ?? null;

      const { error: bgError } = await db.from('backgrounds').insert({
        scene_id: sceneIds[sceneIdx],
        grid_position: bgIndex,
        name: plan.background_names[bgIndex] ?? `Background ${bgIndex + 1}`,
        url: matchedBg?.url ?? null,
        final_url: matchedBg?.url ?? null,
        series_asset_variant_id: matchedBg?.variantId ?? null,
        generation_prompt: generationPrompt,
        generation_meta: generationPrompt
          ? {
              model: 'nano-banana-2',
              provider: providerResolution.provider,
              output_format: 'png',
              resolution,
              use_case: 'missing_background_generation',
              generated_by: 'system',
            }
          : {},
        status: matchedBg ? 'success' : 'pending',
      });

      if (bgError) {
        return NextResponse.json(
          { error: 'Failed to create background rows' },
          { status: 500 }
        );
      }
    }

    const assetJobs: AssetJobMeta[] = [];
    const skippedAssets: SkippedAssetMeta[] = [];

    if (missingObjectCount > 0 || missingBackgroundCount > 0) {
      const webhookBase = resolveWebhookBaseUrl(req);
      if (!webhookBase) {
        return NextResponse.json(
          { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
          { status: 500 }
        );
      }

      const [{ data: pendingObjectRows }, { data: pendingBackgroundRows }] =
        await Promise.all([
          missingObjectCount > 0
            ? db
                .from('objects')
                .select(
                  'id, grid_position, name, description, generation_prompt'
                )
                .in('scene_id', sceneIds)
                .in('grid_position', missingObjectPositions)
                .eq('status', 'pending')
            : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
          missingBackgroundCount > 0
            ? db
                .from('backgrounds')
                .select('id, grid_position, name, generation_prompt')
                .in('scene_id', sceneIds)
                .in('grid_position', missingBackgroundPositions)
                .eq('status', 'pending')
            : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
        ]);

      const pendingObjectByGrid = new Map<
        number,
        {
          id: string;
          name: string;
          description: string | null;
          generation_prompt: string | null;
        }
      >();
      for (const row of pendingObjectRows ?? []) {
        const gridPosition = Number(row.grid_position);
        if (!Number.isInteger(gridPosition) || gridPosition < 0) continue;
        if (pendingObjectByGrid.has(gridPosition)) continue;

        pendingObjectByGrid.set(gridPosition, {
          id: row.id as string,
          name:
            typeof row.name === 'string' && row.name.trim().length > 0
              ? row.name
              : `Object ${gridPosition + 1}`,
          description:
            typeof row.description === 'string' ? row.description : null,
          generation_prompt:
            typeof row.generation_prompt === 'string'
              ? row.generation_prompt
              : null,
        });
      }

      const pendingBackgroundByGrid = new Map<
        number,
        { id: string; name: string; generation_prompt: string | null }
      >();
      for (const row of pendingBackgroundRows ?? []) {
        const gridPosition = Number(row.grid_position);
        if (!Number.isInteger(gridPosition) || gridPosition < 0) continue;
        if (pendingBackgroundByGrid.has(gridPosition)) continue;

        pendingBackgroundByGrid.set(gridPosition, {
          id: row.id as string,
          name:
            typeof row.name === 'string' && row.name.trim().length > 0
              ? row.name
              : `Background ${gridPosition + 1}`,
          generation_prompt:
            typeof row.generation_prompt === 'string'
              ? row.generation_prompt
              : null,
        });
      }

      const callbackPath = '/api/webhook/kieai';

      for (const gridPosition of missingObjectPositions) {
        const info = pendingObjectByGrid.get(gridPosition);
        if (!info) continue;

        const assetName = info.name;
        const assetDescription = info.description;
        const prompt = info.generation_prompt?.trim() ?? '';

        if (!prompt) {
          skippedAssets.push({
            asset_type: 'object',
            grid_position: gridPosition,
            name: assetName,
            reason: 'no_prompt',
          });

          await db
            .from('objects')
            .update({ status: 'failed', error_message: 'no_prompt_saved' })
            .in('scene_id', sceneIds)
            .eq('grid_position', gridPosition)
            .eq('status', 'pending');

          await logGenerationAttempt({
            db,
            entityType: 'object',
            entityId: info.id,
            storyboardId,
            prompt: null,
            status: 'skipped',
            feedback: 'Skipped: no generation_prompt saved',
          });

          continue;
        }

        const webhookParams = new URLSearchParams({
          step: 'GenerateMissingAssetImage',
          storyboard_id: storyboardId,
          asset_type: 'object',
          grid_position: String(gridPosition),
          asset_name: assetName,
          ...(assetDescription ? { asset_description: assetDescription } : {}),
        });

        try {
          const requestId = await queueMissingAssetJob({
            prompt,
            resolution,
            webhookUrl: `${webhookBase}${callbackPath}?${webhookParams.toString()}`,
            assetType: 'object',
            backgroundAspectRatio,
          });

          await db
            .from('objects')
            .update({ request_id: requestId, status: 'processing' })
            .in('scene_id', sceneIds)
            .eq('grid_position', gridPosition)
            .eq('status', 'pending');

          await logGenerationAttempt({
            db,
            entityType: 'object',
            entityId: info.id,
            storyboardId,
            prompt,
            generationMeta: {
              model: 'nano-banana-2',
              provider: providerResolution.provider,
              output_format: 'png',
              resolution,
              generated_at: new Date().toISOString(),
              generated_by: 'system',
            },
            status: 'pending',
          });

          assetJobs.push({
            asset_type: 'object',
            grid_position: gridPosition,
            name: assetName,
            request_id: requestId,
            status: 'queued',
          });
        } catch (queueError) {
          const errorMessage = queueFailureMessage(queueError);

          await db
            .from('objects')
            .update({ status: 'failed', error_message: errorMessage })
            .in('scene_id', sceneIds)
            .eq('grid_position', gridPosition)
            .eq('status', 'pending');

          await logGenerationAttempt({
            db,
            entityType: 'object',
            entityId: info.id,
            storyboardId,
            prompt,
            status: 'failed',
            feedback: errorMessage,
          });

          assetJobs.push({
            asset_type: 'object',
            grid_position: gridPosition,
            name: assetName,
            request_id: null,
            status: 'failed',
            error: errorMessage,
          });
        }
      }

      for (const gridPosition of missingBackgroundPositions) {
        const info = pendingBackgroundByGrid.get(gridPosition);
        if (!info) continue;

        const assetName = info.name;
        const prompt = info.generation_prompt?.trim() ?? '';

        if (!prompt) {
          skippedAssets.push({
            asset_type: 'background',
            grid_position: gridPosition,
            name: assetName,
            reason: 'no_prompt',
          });

          await db
            .from('backgrounds')
            .update({ status: 'failed', error_message: 'no_prompt_saved' })
            .in('scene_id', sceneIds)
            .eq('grid_position', gridPosition)
            .eq('status', 'pending');

          await logGenerationAttempt({
            db,
            entityType: 'background',
            entityId: info.id,
            storyboardId,
            prompt: null,
            status: 'skipped',
            feedback: 'Skipped: no generation_prompt saved',
          });

          continue;
        }

        const webhookParams = new URLSearchParams({
          step: 'GenerateMissingAssetImage',
          storyboard_id: storyboardId,
          asset_type: 'background',
          grid_position: String(gridPosition),
          asset_name: assetName,
        });

        try {
          const requestId = await queueMissingAssetJob({
            prompt,
            resolution,
            webhookUrl: `${webhookBase}${callbackPath}?${webhookParams.toString()}`,
            assetType: 'background',
            backgroundAspectRatio,
          });

          await db
            .from('backgrounds')
            .update({ request_id: requestId, status: 'processing' })
            .in('scene_id', sceneIds)
            .eq('grid_position', gridPosition)
            .eq('status', 'pending');

          await logGenerationAttempt({
            db,
            entityType: 'background',
            entityId: info.id,
            storyboardId,
            prompt,
            generationMeta: {
              model: 'nano-banana-2',
              provider: providerResolution.provider,
              output_format: 'png',
              resolution,
              generated_at: new Date().toISOString(),
              generated_by: 'system',
            },
            status: 'pending',
          });

          assetJobs.push({
            asset_type: 'background',
            grid_position: gridPosition,
            name: assetName,
            request_id: requestId,
            status: 'queued',
          });
        } catch (queueError) {
          const errorMessage = queueFailureMessage(queueError);

          await db
            .from('backgrounds')
            .update({ status: 'failed', error_message: errorMessage })
            .in('scene_id', sceneIds)
            .eq('grid_position', gridPosition)
            .eq('status', 'pending');

          await logGenerationAttempt({
            db,
            entityType: 'background',
            entityId: info.id,
            storyboardId,
            prompt,
            status: 'failed',
            feedback: errorMessage,
          });

          assetJobs.push({
            asset_type: 'background',
            grid_position: gridPosition,
            name: assetName,
            request_id: null,
            status: 'failed',
            error: errorMessage,
          });
        }
      }
    }

    const queuedJobsCount = assetJobs.filter(
      (job) => job.status === 'queued'
    ).length;
    const failedJobsCount = assetJobs.filter(
      (job) => job.status === 'failed'
    ).length;
    const skippedJobsCount = skippedAssets.length;

    const nextPlanStatus =
      queuedJobsCount > 0
        ? 'generating'
        : failedJobsCount > 0 || skippedJobsCount > 0
          ? 'failed'
          : 'approved';

    const planWithJobMetadata = {
      ...(storyboard.plan as Record<string, unknown>),
      scene_prompts: styledScenePrompts,
      v2_asset_match: {
        strategy: 'ai-only',
        objects: {
          matched: objectAiMatch.byGridPosition.size,
          missing: missingObjectCount,
          ai_matched: objectAiMatch.aiMatched,
          issues: objectAiMatch.issues,
        },
        backgrounds: {
          matched: backgroundAiMatch.byGridPosition.size,
          missing: missingBackgroundCount,
          ai_matched: backgroundAiMatch.aiMatched,
          issues: backgroundAiMatch.issues,
        },
      },
      v2_asset_jobs: {
        strategy: 'direct-asset',
        provider: providerResolution.provider,
        resolution,
        queued: queuedJobsCount,
        failed: failedJobsCount,
        skipped: skippedJobsCount,
        jobs: assetJobs,
        skipped_items: skippedAssets,
      },
    };

    const { error: updateStoryboardError } = await db
      .from('storyboards')
      .update({
        plan_status: nextPlanStatus,
        plan: planWithJobMetadata,
      })
      .eq('id', storyboardId);

    if (updateStoryboardError) {
      return NextResponse.json(
        { error: 'Failed to update storyboard status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: nextPlanStatus,
      provider: providerResolution.provider,
      asset_jobs: assetJobs,
      skipped: skippedAssets,
      match_summary: {
        strategy: 'ai-only',
        objects: {
          matched: objectAiMatch.byGridPosition.size,
          missing: missingObjectCount,
          ai_matched: objectAiMatch.aiMatched,
          issues: objectAiMatch.issues,
        },
        backgrounds: {
          matched: backgroundAiMatch.byGridPosition.size,
          missing: missingBackgroundCount,
          ai_matched: backgroundAiMatch.aiMatched,
          issues: backgroundAiMatch.issues,
        },
      },
      reused_series_assets: {
        objects: missingObjectCount === 0,
        backgrounds: missingBackgroundCount === 0,
      },
    });
  } catch (error) {
    if (isProviderRoutingError(error)) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          source: error.source,
          field: error.field,
          service: error.service,
          value: error.value,
        },
        { status: error.statusCode }
      );
    }

    console.error('[v2/storyboard/approve] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
