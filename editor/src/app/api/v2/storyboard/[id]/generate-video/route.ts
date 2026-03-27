import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createTask, uploadFile } from '@/lib/kieai';
import {
  isProviderRoutingError,
  resolveProvider,
} from '@/lib/provider-routing';
import { getScenePromptContractFromGenerationMeta } from '@/lib/storyboard/prompt-compiler';
import { createServiceClient } from '@/lib/supabase/admin';
import { buildMultiPromptPayload } from '@/lib/video-shot-durations';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  scene_indices: z.array(z.number().int().min(0)).optional(),
  scene_ids: z.array(z.string().uuid()).optional(),
  audio: z.boolean().optional(),
  confirm: z.boolean().optional(),
  aspect_ratio: z.string().optional(),
});

const KIE_VIDEO_MODEL = 'grok-imagine/image-to-video';

const MAX_GROK_IMAGE_URLS = 7;

const COST_PER_SECOND_USD = {
  withAudio: 0.112,
  withoutAudio: 0.084,
};

function calculateSceneCost(
  durationSeconds: number,
  withAudio: boolean
): number {
  const rate = withAudio
    ? COST_PER_SECOND_USD.withAudio
    : COST_PER_SECOND_USD.withoutAudio;
  return Math.round((durationSeconds * rate + Number.EPSILON) * 1000) / 1000;
}

function normalizeGrokDuration(durationSeconds: number): '6' | '10' {
  return durationSeconds <= 8 ? '6' : '10';
}

function normalizeGrokAspectRatio(value: string): '16:9' | '9:16' {
  return value === '16:9' ? '16:9' : '9:16';
}

function getMultiShotTotalDuration(
  multiPromptPayload: Array<{ prompt: string; duration: string }>
): number {
  return multiPromptPayload.reduce(
    (sum, shot) => sum + Number(shot.duration),
    0
  );
}

function getNarrativeTtsSeconds(
  voiceovers: Array<{
    duration: number | null;
    status: string | null;
    audio_url: string | null;
  }>
): number | null {
  const readyDurations = (voiceovers ?? [])
    .filter(
      (voiceover) =>
        voiceover.status === 'success' &&
        Boolean(voiceover.audio_url) &&
        typeof voiceover.duration === 'number' &&
        Number.isFinite(voiceover.duration) &&
        voiceover.duration > 0
    )
    .map((voiceover) => Number(voiceover.duration));

  if (readyDurations.length === 0) return null;
  return Math.max(...readyDurations);
}

function mapNarrativeDurationFromTts(
  ttsSeconds: number
): 6 | 10 | 'resplit_required' {
  if (ttsSeconds <= 8) return 6;
  if (ttsSeconds <= 12) return 10;
  return 'resplit_required';
}

function sanitizeVideoPrompt(prompt: string | null | undefined): string {
  if (!prompt) {
    return '';
  }

  return prompt
    .replace(/@(?:Element|Image)\d+\b/gi, ' ')
    .replace(
      /(?:\s*[,.;:!?-]?\s*(?:9\s*:\s*16(?:\s*dikey)?|dikey)\s*)+$/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

type ScenePromptSource = 'prompt_contract' | 'multi_prompt' | 'prompt' | 'none';

type ScenePromptResolution = {
  executionPrompt: string;
  promptSource: ScenePromptSource;
  compileStatus: 'ready' | 'blocked' | null;
  hasPromptContract: boolean;
  blockingIssues: unknown[];
  referenceImages: unknown[];
  resolvedAssetRefs: unknown[];
  sanitizedLegacyMultiPrompts: string[];
};

function resolveScenePromptResolution(input: {
  prompt: string | null;
  multiPrompt: string[] | null;
  generationMeta: unknown;
}): ScenePromptResolution {
  const promptContract = getScenePromptContractFromGenerationMeta(
    input.generationMeta
  );
  const hasPromptContract = promptContract !== null;
  const compileStatus = promptContract?.compile_status ?? null;
  const sanitizedCompiledPrompt = sanitizeVideoPrompt(
    promptContract?.compiled_prompt
  );
  const sanitizedLegacyMultiPrompts = (input.multiPrompt ?? [])
    .map((prompt) => sanitizeVideoPrompt(prompt))
    .filter((prompt) => prompt.length > 0);
  const sanitizedLegacyPrompt = sanitizeVideoPrompt(input.prompt);

  if (compileStatus === 'ready' && sanitizedCompiledPrompt.length > 0) {
    return {
      executionPrompt: sanitizedCompiledPrompt,
      promptSource: 'prompt_contract',
      compileStatus,
      hasPromptContract,
      blockingIssues: promptContract?.blocking_issues ?? [],
      referenceImages: promptContract?.reference_images ?? [],
      resolvedAssetRefs: promptContract?.resolved_asset_refs ?? [],
      sanitizedLegacyMultiPrompts,
    };
  }

  if (sanitizedLegacyMultiPrompts.length > 0) {
    return {
      executionPrompt: sanitizedLegacyMultiPrompts[0],
      promptSource: 'multi_prompt',
      compileStatus,
      hasPromptContract,
      blockingIssues: promptContract?.blocking_issues ?? [],
      referenceImages: promptContract?.reference_images ?? [],
      resolvedAssetRefs: promptContract?.resolved_asset_refs ?? [],
      sanitizedLegacyMultiPrompts,
    };
  }

  if (sanitizedLegacyPrompt.length > 0) {
    return {
      executionPrompt: sanitizedLegacyPrompt,
      promptSource: 'prompt',
      compileStatus,
      hasPromptContract,
      blockingIssues: promptContract?.blocking_issues ?? [],
      referenceImages: promptContract?.reference_images ?? [],
      resolvedAssetRefs: promptContract?.resolved_asset_refs ?? [],
      sanitizedLegacyMultiPrompts,
    };
  }

  return {
    executionPrompt: '',
    promptSource: 'none',
    compileStatus,
    hasPromptContract,
    blockingIssues: promptContract?.blocking_issues ?? [],
    referenceImages: promptContract?.reference_images ?? [],
    resolvedAssetRefs: promptContract?.resolved_asset_refs ?? [],
    sanitizedLegacyMultiPrompts,
  };
}

function inferUploadFileName(sourceUrl: string, fallback: string): string {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const candidate = pathname.split('/').pop()?.trim();
    if (candidate && candidate.length > 0) {
      return candidate;
    }
  } catch {
    // Ignore parse errors and use fallback.
  }

  return fallback;
}

async function logSceneGenerationAttempt(params: {
  db: ReturnType<typeof createServiceClient>;
  sceneId: string;
  storyboardId: string;
  prompt: string | null;
  generationMeta?: Record<string, unknown>;
  feedback?: string | null;
  resultUrl?: string | null;
  status: 'pending' | 'failed' | 'skipped';
}) {
  const {
    db,
    sceneId,
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
    .eq('entity_type', 'scene')
    .eq('entity_id', sceneId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  await db.from('generation_logs').insert({
    entity_type: 'scene',
    entity_id: sceneId,
    storyboard_id: storyboardId,
    version: (latest?.version ?? 0) + 1,
    prompt,
    generation_meta: generationMeta ?? null,
    feedback: feedback ?? null,
    result_url: resultUrl ?? null,
    status,
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

    const sceneIndicesFilter = parsedBody.data.scene_indices;
    const sceneIdsFilter = parsedBody.data.scene_ids;
    const withAudio = parsedBody.data.audio ?? true;
    const confirm = parsedBody.data.confirm ?? false;
    const aspectRatioOverride = parsedBody.data.aspect_ratio;
    const providerResolution = await resolveProvider({
      service: 'video',
      req,
      body: parsedBody.data,
    });

    if (providerResolution.provider !== 'kie') {
      return NextResponse.json(
        {
          error:
            'Video generation provider must be kie. Set PROVIDER_VIDEO=kie and remove request overrides.',
        },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');

    const { data: storyboard, error: storyboardError } = await db
      .from('storyboards')
      .select('id, project_id, plan, plan_status, aspect_ratio, input_type')
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

    const planRecord =
      storyboard.plan && typeof storyboard.plan === 'object'
        ? (storyboard.plan as Record<string, unknown>)
        : {};

    const planVideoMode =
      typeof planRecord.video_mode === 'string' ? planRecord.video_mode : null;
    const isNarrativeMode =
      storyboard.input_type === 'voiceover_script' ||
      planVideoMode === 'narrative';

    const planSceneDurations = Array.isArray(planRecord.scene_durations)
      ? planRecord.scene_durations
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      : [];

    const { data: scenes, error: scenesError } = await db
      .from('scenes')
      .select(
        `
        id,
        order,
        duration,
        prompt,
        multi_prompt,
        multi_shots,
        generation_meta,
        video_status,
        objects (scene_order, final_url, url, status),
        backgrounds (final_url, url, status),
        voiceovers (duration, status, audio_url)
      `
      )
      .eq('storyboard_id', storyboardId)
      .order('order', { ascending: true });

    if (scenesError) {
      return NextResponse.json(
        { error: 'Failed to load scenes' },
        { status: 500 }
      );
    }

    const indexFilterSet = sceneIndicesFilter
      ? new Set(sceneIndicesFilter)
      : null;
    const idFilterSet = sceneIdsFilter ? new Set(sceneIdsFilter) : null;

    const candidates = (scenes ?? []).filter(
      (scene: {
        id: string;
        order: number;
        duration: number | null;
        video_status: string | null;
        generation_meta: Record<string, unknown> | null;
        objects: Array<{
          scene_order: number;
          final_url: string | null;
          url: string | null;
          status: string | null;
        }>;
        backgrounds: Array<{
          final_url: string | null;
          url: string | null;
          status: string | null;
        }>;
        voiceovers: Array<{
          duration: number | null;
          status: string | null;
          audio_url: string | null;
        }>;
      }) => {
        if (indexFilterSet && !indexFilterSet.has(scene.order)) {
          return false;
        }
        if (idFilterSet && !idFilterSet.has(scene.id)) {
          return false;
        }

        // Objects are optional (scenes can have only background)
        const objectsReady =
          scene.objects.length === 0 ||
          scene.objects.every(
            (object) =>
              object.status === 'success' &&
              Boolean(object.final_url ?? object.url)
          );

        const backgroundsReady =
          scene.backgrounds.length > 0 &&
          scene.backgrounds.every(
            (background) =>
              background.status === 'success' &&
              Boolean(background.final_url ?? background.url)
          );

        return objectsReady && backgroundsReady;
      }
    );

    const promptResolutionBySceneId = new Map<string, ScenePromptResolution>();
    for (const scene of candidates as Array<{
      id: string;
      prompt: string | null;
      multi_prompt: string[] | null;
      generation_meta: Record<string, unknown> | null;
    }>) {
      promptResolutionBySceneId.set(
        scene.id,
        resolveScenePromptResolution({
          prompt: scene.prompt,
          multiPrompt: scene.multi_prompt,
          generationMeta: scene.generation_meta,
        })
      );
    }

    if (isNarrativeMode) {
      const missingTtsScenes: number[] = [];
      const resplitRequiredScenes: Array<{
        order: number;
        tts_seconds: number;
      }> = [];
      const durationMismatchScenes: Array<{
        order: number;
        scene_duration: number | null;
        expected_duration: 6 | 10;
      }> = [];

      for (const scene of candidates as Array<{
        order: number;
        duration: number | null;
        voiceovers: Array<{
          duration: number | null;
          status: string | null;
          audio_url: string | null;
        }>;
      }>) {
        const ttsSeconds = getNarrativeTtsSeconds(scene.voiceovers ?? []);

        if (!ttsSeconds) {
          missingTtsScenes.push(scene.order);
          continue;
        }

        const mapped = mapNarrativeDurationFromTts(ttsSeconds);

        if (mapped === 'resplit_required') {
          resplitRequiredScenes.push({
            order: scene.order,
            tts_seconds: Number(ttsSeconds.toFixed(2)),
          });
          continue;
        }

        if (scene.duration !== mapped) {
          durationMismatchScenes.push({
            order: scene.order,
            scene_duration: scene.duration,
            expected_duration: mapped,
          });
        }
      }

      if (
        missingTtsScenes.length > 0 ||
        resplitRequiredScenes.length > 0 ||
        durationMismatchScenes.length > 0
      ) {
        return NextResponse.json(
          {
            error:
              'Narrative scenes must use real TTS durations (<=8→6s, <=12→10s, >12s requires re-split + re-TTS) before video generation.',
            narrative_gate_failed: true,
            missing_tts_audio_scenes: missingTtsScenes,
            resplit_required_scenes: resplitRequiredScenes,
            duration_mismatch_scenes: durationMismatchScenes,
          },
          { status: 409 }
        );
      }
    }

    const blockedPromptScenes = (
      candidates as Array<{
        id: string;
        order: number;
      }>
    )
      .map((scene) => ({
        scene,
        resolution: promptResolutionBySceneId.get(scene.id),
      }))
      .filter(
        ({ resolution }) =>
          resolution?.hasPromptContract === true &&
          resolution.compileStatus === 'blocked'
      )
      .map(({ scene, resolution }) => ({
        scene_id: scene.id,
        scene_index: scene.order,
        compile_status: resolution?.compileStatus,
        blocking_issues: resolution?.blockingIssues ?? [],
      }));

    if (blockedPromptScenes.length > 0) {
      return NextResponse.json(
        {
          error:
            'Prompt contract is blocked for one or more scenes. Resolve blocking issues and recompile prompts before generating video.',
          prompt_contract_gate_failed: true,
          blocked_prompt_scenes: blockedPromptScenes,
          action:
            'Update scene prompt_json/validated_runtime via /api/v2/storyboard/{id}/prompts, then retry generate-video.',
        },
        { status: 409 }
      );
    }

    const jobs: Array<{
      scene_id: string;
      scene_index: number;
      duration_seconds: number;
      estimated_cost_usd: number;
      request_id?: string;
      provider?: 'kie';
      status: 'queued' | 'skipped' | 'estimate';
      reason?: 'no_prompt' | 'already_generated' | 'missing_background';
    }> = [];

    const webhookBase = confirm ? resolveWebhookBaseUrl(req) : null;
    if (confirm && !webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }
    const webhookBaseUrl = webhookBase ?? '';

    for (const scene of candidates as Array<{
      id: string;
      order: number;
      duration: number | null;
      prompt: string | null;
      multi_prompt: string[] | null;
      multi_shots: Array<{ duration?: string }> | null;
      generation_meta: Record<string, unknown> | null;
      video_status: string | null;
      objects: Array<{
        scene_order: number;
        final_url: string | null;
        url: string | null;
      }>;
      backgrounds: Array<{
        final_url: string | null;
        url: string | null;
      }>;
      voiceovers: Array<{
        duration: number | null;
        status: string | null;
        audio_url: string | null;
      }>;
    }>) {
      const readyVoiceovers = (scene.voiceovers ?? []).filter(
        (voiceover) =>
          voiceover.status === 'success' &&
          Boolean(voiceover.audio_url) &&
          typeof voiceover.duration === 'number' &&
          Number.isFinite(voiceover.duration) &&
          voiceover.duration > 0
      );

      const maxVoiceoverDuration = Math.max(
        0,
        ...readyVoiceovers.map((voiceover) => voiceover.duration ?? 0)
      );

      const planDuration =
        planSceneDurations?.[scene.order] ??
        (typeof scene.duration === 'number' && scene.duration > 0
          ? scene.duration
          : 5);

      // Narrative lock (workflow):
      // <=8s => 6s, <=12s => 10s, >12s => must re-split (handled in preflight).
      let baseDuration = planDuration;
      if (isNarrativeMode && maxVoiceoverDuration > 0) {
        const mapped = mapNarrativeDurationFromTts(maxVoiceoverDuration);
        baseDuration = mapped === 10 ? 10 : 6;
      }

      // For multi-shot, enforce total duration = ceil(voiceover duration) when available.
      let actualDuration = baseDuration;
      let multiPromptPayload: Array<{
        prompt: string;
        duration: string;
      }> | null = null;
      const promptResolution =
        promptResolutionBySceneId.get(scene.id) ??
        resolveScenePromptResolution({
          prompt: scene.prompt,
          multiPrompt: scene.multi_prompt,
          generationMeta: scene.generation_meta,
        });
      const sanitizedMultiPrompts =
        promptResolution.sanitizedLegacyMultiPrompts;

      if (sanitizedMultiPrompts.length > 1) {
        multiPromptPayload = buildMultiPromptPayload({
          prompts: sanitizedMultiPrompts,
          targetTotalSeconds: baseDuration,
          multiShots: scene.multi_shots,
        });
        actualDuration = getMultiShotTotalDuration(multiPromptPayload);
      }

      const queuedDuration = Number(normalizeGrokDuration(actualDuration));
      const estimatedCost = calculateSceneCost(queuedDuration, withAudio);
      const scenePrompt = promptResolution.executionPrompt;

      if (!scenePrompt) {
        await logSceneGenerationAttempt({
          db,
          sceneId: scene.id,
          storyboardId,
          prompt: null,
          status: 'skipped',
          feedback: 'Skipped: no scene prompt saved',
        });

        jobs.push({
          scene_id: scene.id,
          scene_index: scene.order,
          duration_seconds: queuedDuration,
          estimated_cost_usd: estimatedCost,
          status: 'skipped',
          reason: 'no_prompt',
        });
        continue;
      }

      if (!confirm) {
        jobs.push({
          scene_id: scene.id,
          scene_index: scene.order,
          duration_seconds: queuedDuration,
          estimated_cost_usd: estimatedCost,
          status: 'estimate',
        });
        continue;
      }

      if (
        scene.video_status === 'processing' ||
        scene.video_status === 'success'
      ) {
        jobs.push({
          scene_id: scene.id,
          scene_index: scene.order,
          duration_seconds: queuedDuration,
          estimated_cost_usd: estimatedCost,
          status: 'skipped',
          reason: 'already_generated',
        });
        continue;
      }

      const backgroundUrl =
        scene.backgrounds[0]?.final_url ?? scene.backgrounds[0]?.url;
      if (!backgroundUrl) {
        jobs.push({
          scene_id: scene.id,
          scene_index: scene.order,
          duration_seconds: queuedDuration,
          estimated_cost_usd: estimatedCost,
          status: 'skipped',
          reason: 'missing_background',
        });
        continue;
      }

      const objectUrls = [...scene.objects]
        .sort((a, b) => a.scene_order - b.scene_order)
        .map((object) => object.final_url ?? object.url)
        .filter((url): url is string => Boolean(url))
        .slice(0, MAX_GROK_IMAGE_URLS - 1);

      await db
        .from('scenes')
        .update({
          video_status: 'processing',
          video_resolution: '480p',
        })
        .eq('id', scene.id);

      let requestId: string | null = null;

      const webhookUrl = `${webhookBaseUrl}/api/webhook/kieai?step=GenerateVideo&scene_id=${scene.id}`;

      try {
        const [uploadedBackgroundUrl, uploadedObjectUrls] = await Promise.all([
          uploadFile(
            backgroundUrl,
            inferUploadFileName(
              backgroundUrl,
              `scene-${scene.id}-background.jpg`
            )
          ).then((uploaded) => uploaded.fileUrl),
          Promise.all(
            objectUrls.map((objectUrl, index) =>
              uploadFile(
                objectUrl,
                inferUploadFileName(
                  objectUrl,
                  `scene-${scene.id}-element-${index + 1}.jpg`
                )
              ).then((uploaded) => uploaded.fileUrl)
            )
          ),
        ]);

        const resolvedPrompt =
          promptResolution.promptSource === 'prompt_contract'
            ? scenePrompt
            : multiPromptPayload && multiPromptPayload.length > 1
              ? multiPromptPayload.map((shot) => shot.prompt).join('\n')
              : (multiPromptPayload?.[0]?.prompt ??
                sanitizedMultiPrompts[0] ??
                scenePrompt);

        const input: Record<string, unknown> = {
          image_urls: [uploadedBackgroundUrl, ...uploadedObjectUrls].slice(
            0,
            MAX_GROK_IMAGE_URLS
          ),
          prompt: resolvedPrompt,
          duration: String(queuedDuration),
          resolution: '720p',
          mode: 'normal',
          aspect_ratio: normalizeGrokAspectRatio(
            aspectRatioOverride ?? storyboard.aspect_ratio ?? '9:16'
          ),
        };

        const result = await createTask({
          model: KIE_VIDEO_MODEL,
          callbackUrl: webhookUrl,
          input,
        });

        requestId = result.taskId;
      } catch {
        requestId = null;
      }

      if (!requestId) {
        await db
          .from('scenes')
          .update({
            video_status: 'failed',
            video_error_message: 'missing_request_id',
          })
          .eq('id', scene.id);

        await logSceneGenerationAttempt({
          db,
          sceneId: scene.id,
          storyboardId,
          prompt: scenePrompt,
          status: 'failed',
          feedback: `Missing kie task_id for scene ${scene.order}`,
        });

        return NextResponse.json(
          {
            error: `kie.ai response missing task_id for scene ${scene.order}`,
          },
          { status: 500 }
        );
      }

      await db
        .from('scenes')
        .update({ video_request_id: requestId })
        .eq('id', scene.id);

      await logSceneGenerationAttempt({
        db,
        sceneId: scene.id,
        storyboardId,
        prompt: scenePrompt,
        generationMeta: {
          model: KIE_VIDEO_MODEL,
          provider: 'kie',
          aspect_ratio:
            aspectRatioOverride ?? storyboard.aspect_ratio ?? '9:16',
          duration_seconds: queuedDuration,
          generated_at: new Date().toISOString(),
          generated_by: 'system',
          audio: withAudio,
          prompt_source: promptResolution.promptSource,
          prompt_contract_compile_status: promptResolution.compileStatus,
          prompt_contract_reference_images: promptResolution.referenceImages,
          prompt_contract_resolved_asset_refs:
            promptResolution.resolvedAssetRefs,
        },
        status: 'pending',
      });

      jobs.push({
        scene_id: scene.id,
        scene_index: scene.order,
        duration_seconds: queuedDuration,
        estimated_cost_usd: estimatedCost,
        request_id: requestId,
        provider: 'kie',
        status: 'queued',
      });
    }

    const totalEstimatedCost =
      Math.round(
        jobs.reduce((sum, job) => sum + job.estimated_cost_usd, 0) * 1000
      ) / 1000;

    return NextResponse.json({
      provider: providerResolution.provider,
      jobs,
      total_estimated_cost_usd: totalEstimatedCost,
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

    console.error('[v2/storyboard/generate-video] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
