import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';
import {
  DEFAULT_GRID_ASPECT_RATIO,
  DEFAULT_GRID_RESOLUTION,
  getGridOutputDimensions,
  isGridAspectRatio,
  isGridResolution,
  type GridAspectRatio,
  type GridResolution,
} from '@/lib/grid-generation-settings';

const FAL_API_KEY = process.env.FAL_KEY!;

interface RefFirstFrameInput {
  scene_ids: string[];
  model?: 'banana' | 'fibo' | 'grok';
  aspect_ratio?: GridAspectRatio;
  resolution?: GridResolution;
}

const ENDPOINTS: Record<NonNullable<RefFirstFrameInput['model']>, string> = {
  banana: 'fal-ai/nano-banana-2/edit',
  fibo: 'bria/fibo-edit/edit',
  grok: 'xai/grok-imagine-image/edit',
};

interface SceneRefContext {
  sceneId: string;
  prompt: string;
  imageUrls: string[];
}

type RefStoryboardPlan = {
  scene_first_frame_prompts?: string[];
};

function applyFirstFrameGenerationSettings(
  prompt: string,
  aspectRatio: GridAspectRatio,
  resolution: GridResolution
): string {
  const dimensions = getGridOutputDimensions(aspectRatio, resolution);

  return `${prompt}\n\nOutput requirements:\n- Final image aspect ratio must be ${aspectRatio}.\n- Target output resolution around ${dimensions.width}x${dimensions.height} (${resolution.replace('_', '.').toUpperCase()}).\n- Keep composition natural and avoid cropped heads/limbs unless explicitly requested.`;
}

async function getSceneRefContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sceneId: string,
  log: ReturnType<typeof createLogger>,
  storyboardPlanCache: Map<string, RefStoryboardPlan | null>
): Promise<SceneRefContext | null> {
  const { data: scene, error: sceneError } = await supabase
    .from('scenes')
    .select('id, prompt, multi_prompt, order, storyboard_id')
    .eq('id', sceneId)
    .single();

  if (sceneError || !scene) {
    log.error('Failed to fetch scene', {
      scene_id: sceneId,
      error: sceneError?.message,
    });
    return null;
  }

  const promptFromScene =
    (typeof scene.prompt === 'string' ? scene.prompt : '') ||
    (Array.isArray(scene.multi_prompt) ? scene.multi_prompt.join('. ') : '');

  let promptFromFirstFrame = '';
  const { data: existingFirstFrame } = await supabase
    .from('first_frames')
    .select('visual_prompt')
    .eq('scene_id', sceneId)
    .limit(1)
    .maybeSingle();

  if (typeof existingFirstFrame?.visual_prompt === 'string') {
    promptFromFirstFrame = existingFirstFrame.visual_prompt.trim();
  }

  let promptFromPlan = '';

  const storyboardId = scene.storyboard_id as string | null;
  const sceneOrder = typeof scene.order === 'number' ? scene.order : null;

  if (storyboardId && sceneOrder !== null) {
    if (!storyboardPlanCache.has(storyboardId)) {
      const { data: storyboard } = await supabase
        .from('storyboards')
        .select('plan')
        .eq('id', storyboardId)
        .single();

      const plan =
        storyboard?.plan && typeof storyboard.plan === 'object'
          ? (storyboard.plan as RefStoryboardPlan)
          : null;

      storyboardPlanCache.set(storyboardId, plan);
    }

    const cachedPlan = storyboardPlanCache.get(storyboardId);
    const prompts = cachedPlan?.scene_first_frame_prompts;
    if (Array.isArray(prompts) && typeof prompts[sceneOrder] === 'string') {
      promptFromPlan = prompts[sceneOrder].trim();
    }
  }

  const prompt = (
    promptFromFirstFrame ||
    promptFromPlan ||
    promptFromScene
  ).trim();
  if (!prompt) {
    log.warn('Scene has no prompt for first-frame generation', {
      scene_id: sceneId,
    });
    return null;
  }

  const { data: objects } = await supabase
    .from('objects')
    .select('final_url')
    .eq('scene_id', sceneId)
    .order('scene_order', { ascending: true });

  const objectUrls = (objects || [])
    .map((obj: { final_url: string | null }) => obj.final_url)
    .filter((url: string | null): url is string => !!url);

  const { data: background } = await supabase
    .from('backgrounds')
    .select('final_url')
    .eq('scene_id', sceneId)
    .limit(1)
    .single();

  if (!background?.final_url) {
    log.warn('Scene has no background for first-frame generation', {
      scene_id: sceneId,
    });
    return null;
  }

  return {
    sceneId,
    prompt,
    imageUrls: [background.final_url, ...objectUrls],
  };
}

async function getOrCreateFirstFrame(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sceneId: string,
  visualPrompt: string
): Promise<{ id: string } | null> {
  const { data: existing } = await supabase
    .from('first_frames')
    .select('id')
    .eq('scene_id', sceneId)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing;

  const { data: created, error: createError } = await supabase
    .from('first_frames')
    .insert({
      scene_id: sceneId,
      visual_prompt: visualPrompt,
      status: 'pending',
    })
    .select('id')
    .single();

  if (createError || !created) {
    return null;
  }

  return created;
}

async function queueFirstFrameRequest(
  firstFrameId: string,
  refs: SceneRefContext,
  endpoint: string,
  model: NonNullable<RefFirstFrameInput['model']>,
  aspectRatio: GridAspectRatio,
  resolution: GridResolution,
  webhookBase: string,
  log: ReturnType<typeof createLogger>
): Promise<{ requestId: string | null; error: string | null }> {
  const webhookParams = new URLSearchParams({
    step: 'EnhanceImage',
    first_frame_id: firstFrameId,
    aspect_ratio: aspectRatio,
    resolution,
  });

  const webhookUrl = `${webhookBase}/api/webhook/fal?${webhookParams.toString()}`;
  const falUrl = new URL(`https://queue.fal.run/${endpoint}`);
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  const requestBody: Record<string, unknown> =
    model === 'fibo'
      ? {
          image_url: refs.imageUrls[0],
          instruction: refs.prompt,
        }
      : {
          image_urls: refs.imageUrls,
          prompt: refs.prompt,
        };

  if (model === 'banana') {
    requestBody.safety_tolerance = '6';
  }

  log.api('fal.ai', endpoint, {
    scene_id: refs.sceneId,
    first_frame_id: firstFrameId,
    refs_count: refs.imageUrls.length,
  });

  log.startTiming('fal_ref_first_frame_request');

  try {
    const response = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('fal.ai ref-first-frame request failed', {
        status: response.status,
        error: errorText,
        time_ms: log.endTiming('fal_ref_first_frame_request'),
      });
      return {
        requestId: null,
        error: `fal.ai request failed: ${response.status}`,
      };
    }

    const result = await response.json();
    log.success('fal.ai ref-first-frame request accepted', {
      request_id: result.request_id,
      time_ms: log.endTiming('fal_ref_first_frame_request'),
    });

    return { requestId: result.request_id, error: null };
  } catch (error) {
    log.error('fal.ai ref-first-frame request exception', {
      error: error instanceof Error ? error.message : String(error),
      time_ms: log.endTiming('fal_ref_first_frame_request'),
    });
    return { requestId: null, error: 'Request exception' };
  }
}

export async function POST(req: NextRequest) {
  const log = createLogger();
  log.setContext({ step: 'GenerateRefFirstFrame' });

  try {
    const authClient = await createClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const input: RefFirstFrameInput = await req.json();
    const { scene_ids, model = 'banana', aspect_ratio, resolution } = input;

    if (!scene_ids || !Array.isArray(scene_ids) || scene_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'scene_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    const endpoint = ENDPOINTS[model];
    if (!endpoint) {
      return NextResponse.json(
        {
          success: false,
          error: `model must be one of: ${Object.keys(ENDPOINTS).join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (aspect_ratio && !isGridAspectRatio(aspect_ratio)) {
      return NextResponse.json(
        {
          success: false,
          error: 'aspect_ratio must be one of: 1:1, 9:16, 16:9',
        },
        { status: 400 }
      );
    }

    if (resolution && !isGridResolution(resolution)) {
      return NextResponse.json(
        {
          success: false,
          error: 'resolution must be one of: 1k, 1_5k, 2k, 3k, 4k',
        },
        { status: 400 }
      );
    }

    const selectedAspectRatio =
      aspect_ratio && isGridAspectRatio(aspect_ratio)
        ? aspect_ratio
        : DEFAULT_GRID_ASPECT_RATIO;
    const selectedResolution =
      resolution && isGridResolution(resolution)
        ? resolution
        : DEFAULT_GRID_RESOLUTION;

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL',
        },
        { status: 500 }
      );
    }

    const supabase = createServiceClient();

    const results: Array<{
      scene_id: string;
      first_frame_id: string | null;
      request_id: string | null;
      status: 'queued' | 'skipped' | 'failed';
      error?: string;
    }> = [];

    const storyboardPlanCache = new Map<string, RefStoryboardPlan | null>();

    for (const sceneId of scene_ids) {
      const context = await getSceneRefContext(
        supabase,
        sceneId,
        log,
        storyboardPlanCache
      );

      if (!context) {
        results.push({
          scene_id: sceneId,
          first_frame_id: null,
          request_id: null,
          status: 'skipped',
          error: 'Prerequisites not met',
        });
        continue;
      }

      const firstFrame = await getOrCreateFirstFrame(
        supabase,
        sceneId,
        context.prompt
      );

      if (!firstFrame?.id) {
        results.push({
          scene_id: sceneId,
          first_frame_id: null,
          request_id: null,
          status: 'failed',
          error: 'Failed to create first frame record',
        });
        continue;
      }

      await supabase
        .from('first_frames')
        .update({
          visual_prompt: context.prompt,
          image_edit_status: 'processing',
          image_edit_error_message: null,
          image_edit_model: model,
        })
        .eq('id', firstFrame.id);

      const queueContext: SceneRefContext = {
        ...context,
        prompt: applyFirstFrameGenerationSettings(
          context.prompt,
          selectedAspectRatio,
          selectedResolution
        ),
      };

      const { requestId, error } = await queueFirstFrameRequest(
        firstFrame.id,
        queueContext,
        endpoint,
        model,
        selectedAspectRatio,
        selectedResolution,
        webhookBase,
        log
      );

      if (error || !requestId) {
        await supabase
          .from('first_frames')
          .update({
            image_edit_status: 'failed',
            image_edit_error_message: 'request_error',
          })
          .eq('id', firstFrame.id);

        results.push({
          scene_id: sceneId,
          first_frame_id: firstFrame.id,
          request_id: null,
          status: 'failed',
          error: error || 'Unknown error',
        });
        continue;
      }

      await supabase
        .from('first_frames')
        .update({ image_edit_request_id: requestId })
        .eq('id', firstFrame.id);

      results.push({
        scene_id: sceneId,
        first_frame_id: firstFrame.id,
        request_id: requestId,
        status: 'queued',
      });
    }

    const queuedCount = results.filter((r) => r.status === 'queued').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: scene_ids.length,
        queued: queuedCount,
        skipped: skippedCount,
        failed: failedCount,
      },
      settings: {
        aspect_ratio: selectedAspectRatio,
        resolution: selectedResolution,
      },
    });
  } catch (error) {
    log.error('Unexpected error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
