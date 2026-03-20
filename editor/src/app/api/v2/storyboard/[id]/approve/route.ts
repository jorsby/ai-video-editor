import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { getSeriesStyleForProject } from '@/lib/prompts/style-injector';
import { klingO3PlanSchema } from '@/lib/schemas/kling-o3-plan';
import { createServiceClient } from '@/lib/supabase/admin';
import { matchAssetsWithAI } from '@/lib/supabase/series-asset-ai-matcher';
import {
  resolveSeriesAssetCandidatesForProject,
  type SeriesAssetCandidate,
} from '@/lib/supabase/series-asset-resolver';

type RouteContext = { params: Promise<{ id: string }> };

type Resolution = '0.5k' | '1k' | '2k';

const bodySchema = z.object({
  resolution: z.enum(['0.5k', '1k', '2k']).optional(),
  retry_failed: z.boolean().optional(),
});

const RESOLUTION_TO_SIZE: Record<
  Resolution,
  { width: number; height: number }
> = {
  '0.5k': { width: 512, height: 512 },
  '1k': { width: 1024, height: 1024 },
  '2k': { width: 2048, height: 2048 },
};

const FAL_IMAGE_ENDPOINT = 'fal-ai/nano-banana-2';

type MissingAssetType = 'object' | 'background';

function getWebhookBaseUrl() {
  return process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
}

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
}) {
  const size = RESOLUTION_TO_SIZE[params.resolution];
  const falUrl = new URL(`https://queue.fal.run/${FAL_IMAGE_ENDPOINT}`);
  falUrl.searchParams.set('fal_webhook', params.webhookUrl);

  const res = await fetch(falUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: params.prompt,
      num_images: 1,
      image_size: { width: size.width, height: size.height },
      enable_safety_checker: false,
      output_format: 'png',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal.ai queue failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const requestId =
    typeof data?.request_id === 'string' ? data.request_id : null;

  if (!requestId) {
    throw new Error('fal.ai response missing request_id');
  }

  return requestId;
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
      .select('id, project_id, mode, plan, plan_status')
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

    const parsedPlan = klingO3PlanSchema.safeParse(storyboard.plan);
    if (!parsedPlan.success) {
      return NextResponse.json(
        { error: 'Storyboard plan is invalid or missing' },
        { status: 400 }
      );
    }

    const plan = parsedPlan.data;

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
      const webhookBase = getWebhookBaseUrl();
      if (!webhookBase) {
        return NextResponse.json(
          { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
          { status: 500 }
        );
      }

      if (!process.env.FAL_KEY) {
        return NextResponse.json({ error: 'Missing FAL_KEY' }, { status: 500 });
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
            webhookUrl: `${webhookBase}/api/webhook/fal?${webhookParams.toString()}`,
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
              model: FAL_IMAGE_ENDPOINT,
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
            webhookUrl: `${webhookBase}/api/webhook/fal?${webhookParams.toString()}`,
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
              model: FAL_IMAGE_ENDPOINT,
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
                model: FAL_IMAGE_ENDPOINT,
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
              model: FAL_IMAGE_ENDPOINT,
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
      const webhookBase = getWebhookBaseUrl();
      if (!webhookBase) {
        return NextResponse.json(
          { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
          { status: 500 }
        );
      }

      if (!process.env.FAL_KEY) {
        return NextResponse.json({ error: 'Missing FAL_KEY' }, { status: 500 });
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
            webhookUrl: `${webhookBase}/api/webhook/fal?${webhookParams.toString()}`,
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
              model: FAL_IMAGE_ENDPOINT,
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
            webhookUrl: `${webhookBase}/api/webhook/fal?${webhookParams.toString()}`,
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
              model: FAL_IMAGE_ENDPOINT,
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
    console.error('[v2/storyboard/approve] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
