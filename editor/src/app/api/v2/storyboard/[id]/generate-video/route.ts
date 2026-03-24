import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createTask, uploadFile } from '@/lib/kieai';
import { resolveProvider } from '@/lib/provider-routing';
import { createServiceClient } from '@/lib/supabase/admin';
import { buildKlingMultiPromptPayload } from '@/lib/video-shot-durations';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  scene_indices: z.array(z.number().int().min(0)).optional(),
  scene_ids: z.array(z.string().uuid()).optional(),
  audio: z.boolean().optional(),
  confirm: z.boolean().optional(),
  aspect_ratio: z.string().optional(),
  model: z.enum(['klingo3']).optional(),
});

const KLING_ENDPOINTS = {
  klingo3: 'fal-ai/kling-video/o3/standard/reference-to-video',
} as const;
const KIE_VIDEO_MODEL = 'kling-3.0/video';

const MAX_KLING_ELEMENTS = 3;

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

function getMultiShotTotalDuration(
  multiPromptPayload: Array<{ prompt: string; duration: string }>
): number {
  return multiPromptPayload.reduce(
    (sum, shot) => sum + Number(shot.duration),
    0
  );
}

function sanitizeKlingPrompt(prompt: string | null | undefined): string {
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
    const model = parsedBody.data.model ?? 'klingo3';
    const endpoint = KLING_ENDPOINTS[model];
    const providerResolution = await resolveProvider({
      service: 'video',
      req,
      body: parsedBody.data,
    });

    if (providerResolution.provider === 'fal' && !process.env.FAL_KEY) {
      return NextResponse.json({ error: 'Missing FAL_KEY' }, { status: 500 });
    }

    const db = createServiceClient('studio');

    const { data: storyboard, error: storyboardError } = await db
      .from('storyboards')
      .select('id, project_id, plan, plan_status, aspect_ratio')
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
        prompt,
        multi_prompt,
        multi_shots,
        video_status,
        objects (scene_order, final_url, url, status),
        backgrounds (final_url, url, status),
        voiceovers (duration)
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
        video_status: string | null;
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
        voiceovers: Array<{ duration: number | null }>;
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

    const jobs: Array<{
      scene_id: string;
      scene_index: number;
      duration_seconds: number;
      estimated_cost_usd: number;
      request_id?: string;
      fal_request_id?: string;
      provider?: 'fal' | 'kie';
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
      prompt: string | null;
      multi_prompt: string[] | null;
      multi_shots: Array<{ duration?: string }> | null;
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
      voiceovers: Array<{ duration: number | null }>;
    }>) {
      // Duration priority: ceil(voiceover duration) → plan duration → 5s default
      const maxVoiceoverDuration = Math.max(
        0,
        ...(scene.voiceovers ?? []).map((v) => v.duration ?? 0)
      );
      const voiceoverBasedDuration =
        maxVoiceoverDuration > 0 ? Math.ceil(maxVoiceoverDuration) : 0;
      const planDuration = planSceneDurations?.[scene.order] ?? 5;
      const baseDuration = voiceoverBasedDuration || planDuration;

      // For multi-shot, enforce total duration = ceil(voiceover duration) when available.
      let actualDuration = baseDuration;
      let multiPromptPayload: Array<{
        prompt: string;
        duration: string;
      }> | null = null;
      const sanitizedMultiPrompts = (scene.multi_prompt ?? [])
        .map((prompt) => sanitizeKlingPrompt(prompt))
        .filter((prompt) => prompt.length > 0);

      if (sanitizedMultiPrompts.length > 1) {
        multiPromptPayload = buildKlingMultiPromptPayload({
          prompts: sanitizedMultiPrompts,
          targetTotalSeconds: baseDuration,
          multiShots: scene.multi_shots,
        });
        actualDuration = getMultiShotTotalDuration(multiPromptPayload);
      }

      const estimatedCost = calculateSceneCost(actualDuration, withAudio);
      const sanitizedPrompt = sanitizeKlingPrompt(scene.prompt);
      const scenePrompt = sanitizedMultiPrompts[0] ?? sanitizedPrompt;

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
          duration_seconds: actualDuration,
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
          duration_seconds: actualDuration,
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
          duration_seconds: actualDuration,
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
          duration_seconds: actualDuration,
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
        .slice(0, MAX_KLING_ELEMENTS);

      const payload: Record<string, unknown> = {
        elements: objectUrls.map((url) => ({
          frontal_image_url: url,
          reference_image_urls: [url],
        })),
        image_urls: [backgroundUrl],
        aspect_ratio: aspectRatioOverride ?? storyboard.aspect_ratio ?? '9:16',
        generate_audio: withAudio,
      };

      if (multiPromptPayload && multiPromptPayload.length > 1) {
        payload.multi_prompt = multiPromptPayload;
        payload.shot_type = 'customize';
      } else {
        payload.prompt =
          multiPromptPayload?.[0]?.prompt ??
          sanitizedMultiPrompts[0] ??
          scenePrompt;
        payload.duration = String(baseDuration);
      }

      await db
        .from('scenes')
        .update({
          video_status: 'processing',
          video_resolution: '720p',
        })
        .eq('id', scene.id);

      let requestId: string | null = null;

      if (providerResolution.provider === 'kie') {
        const webhookUrl = `${webhookBaseUrl}/api/webhook/kieai?step=GenerateVideo&scene_id=${scene.id}`;

        try {
          const [uploadedBackgroundUrl, uploadedObjectUrls] = await Promise.all(
            [
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
            ]
          );

          const input: Record<string, unknown> = {
            image_urls: [uploadedBackgroundUrl],
            aspect_ratio:
              aspectRatioOverride ?? storyboard.aspect_ratio ?? '9:16',
            mode: 'std',
            sound: false,
            kling_elements: uploadedObjectUrls.map((uploadedUrl, index) => ({
              name: `Element ${index + 1}`,
              description: `Scene ${scene.order + 1} element ${index + 1}`,
              element_input_urls: [uploadedUrl],
            })),
          };

          if (multiPromptPayload && multiPromptPayload.length > 1) {
            input.multi_shots = true;
            input.multi_prompt = multiPromptPayload;
          } else {
            input.prompt =
              multiPromptPayload?.[0]?.prompt ??
              sanitizedMultiPrompts[0] ??
              scenePrompt;
            input.duration = String(baseDuration);
          }

          const result = await createTask({
            model: KIE_VIDEO_MODEL,
            callbackUrl: webhookUrl,
            input,
          });

          requestId = result.taskId;
        } catch {
          requestId = null;
        }
      } else {
        const falUrl = new URL(`https://queue.fal.run/${endpoint}`);
        falUrl.searchParams.set(
          'fal_webhook',
          `${webhookBaseUrl}/api/webhook/fal?step=GenerateVideo&scene_id=${scene.id}`
        );

        const falRes = await fetch(falUrl.toString(), {
          method: 'POST',
          headers: {
            Authorization: `Key ${process.env.FAL_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!falRes.ok) {
          await db
            .from('scenes')
            .update({
              video_status: 'failed',
              video_error_message: 'request_error',
            })
            .eq('id', scene.id);

          await logSceneGenerationAttempt({
            db,
            sceneId: scene.id,
            storyboardId,
            prompt: scenePrompt,
            status: 'failed',
            feedback: `Failed to queue scene ${scene.order}`,
          });

          return NextResponse.json(
            { error: `Failed to queue scene ${scene.order}` },
            { status: 500 }
          );
        }

        const falData = await falRes.json();
        requestId =
          typeof falData?.request_id === 'string' ? falData.request_id : null;
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
          feedback: `Missing fal request_id for scene ${scene.order}`,
        });

        return NextResponse.json(
          {
            error: `${providerResolution.provider === 'kie' ? 'kie.ai' : 'fal.ai'} response missing request_id for scene ${scene.order}`,
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
          model:
            providerResolution.provider === 'kie' ? KIE_VIDEO_MODEL : endpoint,
          provider: providerResolution.provider,
          aspect_ratio:
            aspectRatioOverride ?? storyboard.aspect_ratio ?? '9:16',
          duration_seconds: actualDuration,
          generated_at: new Date().toISOString(),
          generated_by: 'system',
          audio: withAudio,
        },
        status: 'pending',
      });

      jobs.push({
        scene_id: scene.id,
        scene_index: scene.order,
        duration_seconds: actualDuration,
        estimated_cost_usd: estimatedCost,
        request_id: requestId,
        fal_request_id: requestId,
        provider: providerResolution.provider,
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
    console.error('[v2/storyboard/generate-video] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
