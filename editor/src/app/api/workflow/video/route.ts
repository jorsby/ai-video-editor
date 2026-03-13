import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

const FAL_API_KEY = process.env.FAL_KEY!;
const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL!;

// ── Model configuration ───────────────────────────────────────────────

interface ModelConfig {
  endpoint: string;
  mode: 'image_to_video' | 'ref_to_video';
  validResolutions: string[];
  bucketDuration: (rawCeil: number) => number;
  buildPayload:
    | ((opts: {
        prompt: string;
        image_url: string;
        resolution: string;
        duration: number;
        aspect_ratio?: string;
        image_urls?: string[];
        elements?: Array<{
          frontal_image_url: string;
          reference_image_urls: string[];
        }>;
        multi_prompt?: string[];
        multi_shots?: boolean;
        video_urls?: string[];
        enable_audio?: boolean;
      }) => Record<string, unknown>)
    | null;
}

function splitMultiPromptDurations(
  prompts: string[],
  totalDuration: number
): { prompt: string; duration: string }[] {
  const count = prompts.length;
  const base = Math.floor(totalDuration / count);
  const remainder = totalDuration - base * count;

  return prompts.map((p, i) => {
    const shotDuration = Math.max(
      3,
      Math.min(15, base + (i < remainder ? 1 : 0))
    );
    return { prompt: p, duration: String(shotDuration) };
  });
}

const MODEL_CONFIG: Record<string, ModelConfig> = {
  'wan2.6': {
    endpoint: 'fal-ai/wan/v2.6/image-to-video',
    mode: 'image_to_video',
    validResolutions: ['720p', '1080p'],
    bucketDuration: (raw) => (raw <= 5 ? 5 : raw <= 10 ? 10 : 15),
    buildPayload: ({ prompt, image_url, resolution, duration }) => ({
      prompt,
      image_url,
      resolution,
      duration: String(duration),
      enable_safety_checker: false,
    }),
  },
  'bytedance1.5pro': {
    endpoint: 'fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
    mode: 'image_to_video',
    validResolutions: ['480p', '720p'],
    bucketDuration: (raw) => Math.max(4, Math.min(12, raw)),
    buildPayload: ({
      prompt,
      image_url,
      resolution,
      duration,
      aspect_ratio,
    }) => ({
      prompt,
      image_url,
      aspect_ratio: aspect_ratio ?? '16:9',
      resolution,
      duration,
    }),
  },
  grok: {
    endpoint: 'xai/grok-imagine-video/image-to-video',
    mode: 'image_to_video',
    validResolutions: ['480p', '720p'],
    bucketDuration: (raw) => Math.max(1, Math.min(15, raw)),
    buildPayload: ({ prompt, image_url, resolution, duration }) => ({
      prompt,
      image_url,
      resolution,
      duration,
    }),
  },
  wan26flash: {
    endpoint: 'wan/v2.6/reference-to-video/flash',
    mode: 'ref_to_video',
    validResolutions: ['720p', '1080p'],
    bucketDuration: (raw) => (raw <= 5 ? 5 : 10),
    buildPayload: ({
      prompt,
      image_urls,
      video_urls,
      resolution,
      duration,
      aspect_ratio,
      multi_shots,
      enable_audio,
    }) => ({
      prompt,
      video_urls: video_urls ?? [],
      image_urls: image_urls ?? [],
      aspect_ratio: aspect_ratio ?? '16:9',
      resolution,
      duration: String(duration),
      enable_audio: enable_audio ?? true,
      enable_safety_checker: false,
      multi_shots: multi_shots ?? false,
    }),
  },
  klingo3: {
    endpoint: 'fal-ai/kling-video/o3/standard/reference-to-video',
    mode: 'ref_to_video',
    validResolutions: ['720p', '1080p'],
    bucketDuration: (raw) => Math.max(3, Math.min(15, raw)),
    buildPayload: ({
      prompt,
      elements,
      image_urls,
      duration,
      aspect_ratio,
      multi_prompt,
      enable_audio,
    }) => ({
      prompt:
        multi_prompt && multi_prompt.length > 0
          ? multi_prompt.join('. ')
          : prompt,
      elements: elements || [],
      image_urls: image_urls || [],
      duration,
      aspect_ratio: aspect_ratio ?? '16:9',
      generate_audio: enable_audio ?? false,
    }),
  },
  klingo3pro: {
    endpoint: 'fal-ai/kling-video/o3/pro/reference-to-video',
    mode: 'ref_to_video',
    validResolutions: ['720p', '1080p'],
    bucketDuration: (raw) => Math.max(3, Math.min(15, raw)),
    buildPayload: ({
      prompt,
      elements,
      image_urls,
      duration,
      aspect_ratio,
      multi_prompt,
      enable_audio,
    }) => ({
      prompt:
        multi_prompt && multi_prompt.length > 0
          ? multi_prompt.join('. ')
          : prompt,
      elements: elements || [],
      image_urls: image_urls || [],
      duration,
      aspect_ratio: aspect_ratio ?? '16:9',
      generate_audio: enable_audio ?? false,
    }),
  },
  skyreels: {
    endpoint: 'skyreels-direct',
    mode: 'ref_to_video',
    validResolutions: ['720p', '1080p'],
    bucketDuration: (raw) => Math.max(1, Math.min(5, raw)),
    buildPayload: null,
  },
};

const SKYREELS_API_URL = 'https://apis.skyreels.ai/api/v1/video/multiobject';

const DEFAULT_MODEL = 'bytedance1.5pro';

type ModelKey = keyof typeof MODEL_CONFIG;

function isModelKey(value: string): value is ModelKey {
  return value in MODEL_CONFIG;
}

// ── Prompt resolution ─────────────────────────────────────────────────

function resolvePrompt(
  scenePrompt: string,
  model: string,
  objectCount: number
): string {
  let resolved = scenePrompt;
  if (model === 'wan26flash') {
    resolved = resolved.replaceAll(`{bg}`, `Character1`);
    for (let i = 1; i <= objectCount; i++) {
      resolved = resolved.replaceAll(`{object_${i}}`, `Character${i + 1}`);
    }
  }
  return resolved;
}

function resolveMultiPrompt(
  shots: string[],
  model: string,
  objectCount: number
): string[] {
  return shots.map((shot) => resolvePrompt(shot, model, objectCount));
}

// ── Types ─────────────────────────────────────────────────────────────

interface GenerateVideoInput {
  scene_ids: string[];
  resolution: '480p' | '720p' | '1080p';
  model?: string;
  generation_path?: 'i2v';
  aspect_ratio?: string;
  fallback_duration?: number;
  storyboard_id?: string;
  enable_audio?: boolean;
  duration_overrides?: Record<string, number>;
  skyreels_duration_mode?: 'auto' | 'fixed';
  skyreels_duration_seconds?: number;
}

interface VideoContext {
  scene_id: string;
  final_url: string;
  visual_prompt: string;
  duration: number;
}

interface RefVideoContext {
  scene_id: string;
  prompt: string;
  multi_prompt?: string[];
  multi_shots?: boolean;
  object_urls: string[];
  background_url: string;
  duration: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

async function getVideoContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sceneId: string,
  bucketDuration: (raw: number) => number,
  log: ReturnType<typeof createLogger>,
  fallbackDuration?: number
): Promise<VideoContext | null> {
  const { data: scene, error: sceneError } = await supabase
    .from('scenes')
    .select(
      `id, video_status, first_frames (id, final_url, visual_prompt), voiceovers (duration)`
    )
    .eq('id', sceneId)
    .single();

  if (sceneError || !scene) {
    log.error('Failed to fetch scene', {
      scene_id: sceneId,
      error: sceneError?.message,
    });
    return null;
  }

  const firstFrame = (
    scene.first_frames as Array<{
      id: string;
      final_url: string | null;
      visual_prompt: string | null;
    }>
  )?.[0];
  if (!firstFrame) {
    log.error('No first_frame found for scene', { scene_id: sceneId });
    return null;
  }
  if (!firstFrame.final_url) {
    log.warn('No final_url for first_frame', { scene_id: sceneId });
    return null;
  }
  if (scene.video_status === 'processing') {
    log.warn('Video already processing, skipping', { scene_id: sceneId });
    return null;
  }

  const maxDuration = Math.max(
    0,
    ...((scene.voiceovers as Array<{ duration?: number }>) || []).map(
      (v) => v.duration ?? 0
    )
  );
  if (maxDuration === 0) {
    if (fallbackDuration && fallbackDuration > 0) {
      log.info('Using fallback duration', {
        scene_id: sceneId,
        fallback_duration: fallbackDuration,
      });
    } else {
      log.warn('No voiceover duration found', { scene_id: sceneId });
      return null;
    }
  }

  const raw = maxDuration > 0 ? Math.ceil(maxDuration) : fallbackDuration!;
  return {
    scene_id: sceneId,
    final_url: firstFrame.final_url,
    visual_prompt: firstFrame.visual_prompt || '',
    duration: bucketDuration(raw),
  };
}

async function getRefVideoContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sceneId: string,
  model: string,
  bucketDuration: (raw: number) => number,
  log: ReturnType<typeof createLogger>,
  fallbackDuration?: number,
  durationOverride?: number,
  skyreelsDurationMode: 'auto' | 'fixed' = 'auto'
): Promise<RefVideoContext | null> {
  const { data: scene, error: sceneError } = await supabase
    .from('scenes')
    .select(
      `id, prompt, multi_prompt, multi_shots, video_status, voiceovers (duration)`
    )
    .eq('id', sceneId)
    .single();

  if (sceneError || !scene) {
    log.error('Failed to fetch scene', {
      scene_id: sceneId,
      error: sceneError?.message,
    });
    return null;
  }
  if (!scene.prompt && !scene.multi_prompt) {
    log.error('No prompt on scene', { scene_id: sceneId });
    return null;
  }
  if (scene.video_status === 'processing') {
    log.warn('Video already processing, skipping', { scene_id: sceneId });
    return null;
  }

  const { data: objects } = await supabase
    .from('objects')
    .select('final_url')
    .eq('scene_id', sceneId)
    .order('scene_order', { ascending: true });
  const objectUrls: string[] = (objects || [])
    .map((o: { final_url: string | null }) => o.final_url)
    .filter((url: string | null): url is string => !!url);

  const { data: bg } = await supabase
    .from('backgrounds')
    .select('final_url')
    .eq('scene_id', sceneId)
    .limit(1)
    .single();
  if (!bg?.final_url) {
    log.error('No background found for scene', { scene_id: sceneId });
    return null;
  }

  const objectCount = objectUrls.length;
  if (model === 'skyreels' && objectCount > 3) {
    log.error('SkyReels max 3 objects exceeded', { scene_id: sceneId });
    return null;
  }
  if (model === 'wan26flash' && objectCount + 1 > 5) {
    log.error('WAN 2.6 Flash max 5 images exceeded', { scene_id: sceneId });
    return null;
  }
  if ((model === 'klingo3' || model === 'klingo3pro') && objectCount > 4) {
    log.error('Kling O3 max 4 elements exceeded', { scene_id: sceneId });
    return null;
  }

  const maxDuration = Math.max(
    0,
    ...((scene.voiceovers as Array<{ duration?: number }>) || []).map(
      (v) => v.duration ?? 0
    )
  );

  const hasDurationOverride =
    typeof durationOverride === 'number' && durationOverride > 0;

  if (
    maxDuration === 0 &&
    !hasDurationOverride &&
    (!fallbackDuration || fallbackDuration <= 0)
  ) {
    log.warn('No voiceover duration found', { scene_id: sceneId });
    return null;
  }

  let raw: number;

  if (hasDurationOverride) {
    raw = durationOverride;
  } else if (model === 'skyreels' && skyreelsDurationMode === 'auto') {
    // Policy: <=4s keep natural bucket, >4s force 5s then timeline can stretch.
    raw =
      maxDuration > 0
        ? maxDuration > 4
          ? 5
          : Math.max(1, Math.ceil(maxDuration))
        : fallbackDuration!;
  } else if (model === 'wan26flash') {
    // WAN ref flash only supports 5 or 10 seconds.
    // Product rule: <=7.5s => 5s, >7.5s => 10s.
    raw = maxDuration > 0 ? (maxDuration <= 7.5 ? 5 : 10) : fallbackDuration!;
  } else {
    raw = maxDuration > 0 ? Math.ceil(maxDuration) : fallbackDuration!;
  }

  const durationInt = bucketDuration(raw);

  if (model === 'skyreels') {
    return {
      scene_id: sceneId,
      prompt: scene.prompt || '',
      object_urls: objectUrls,
      background_url: bg.final_url,
      duration: durationInt,
    };
  }

  let multiPromptShots: string[] | undefined;
  if (
    scene.multi_prompt &&
    Array.isArray(scene.multi_prompt) &&
    scene.multi_prompt.length > 0
  ) {
    multiPromptShots = scene.multi_prompt as string[];
  } else if (scene.prompt && scene.prompt.startsWith('[')) {
    try {
      const parsed = JSON.parse(scene.prompt);
      if (
        Array.isArray(parsed) &&
        parsed.every((s: unknown) => typeof s === 'string')
      )
        multiPromptShots = parsed;
    } catch {
      /* not JSON */
    }
  }

  if (multiPromptShots) {
    const resolvedShots = resolveMultiPrompt(
      multiPromptShots,
      model,
      objectCount
    );
    return {
      scene_id: sceneId,
      prompt: '',
      multi_prompt: resolvedShots,
      multi_shots: scene.multi_shots ?? undefined,
      object_urls: objectUrls,
      background_url: bg.final_url,
      duration: durationInt,
    };
  }

  return {
    scene_id: sceneId,
    prompt: resolvePrompt(scene.prompt, model, objectCount),
    multi_shots: scene.multi_shots ?? undefined,
    object_urls: objectUrls,
    background_url: bg.final_url,
    duration: durationInt,
  };
}

async function sendSkyReelsRequest(
  context: RefVideoContext,
  aspect_ratio: string | undefined,
  log: ReturnType<typeof createLogger>
): Promise<{ taskId: string | null; error: string | null }> {
  const apiKey = process.env.SKYREELS_API_KEY;
  if (!apiKey)
    return { taskId: null, error: 'SKYREELS_API_KEY not configured' };

  const refImages = [context.background_url, ...context.object_urls];
  if (refImages.length > 4)
    return {
      taskId: null,
      error: `SkyReels max 4 ref_images but got ${refImages.length}`,
    };

  const payload = {
    api_key: apiKey,
    prompt: context.prompt,
    ref_images: refImages,
    duration: context.duration,
    aspect_ratio: aspect_ratio ?? '16:9',
  };

  log.api('skyreels', 'multiobject/submit', {
    scene_id: context.scene_id,
    ref_image_count: refImages.length,
    duration: context.duration,
  });
  log.startTiming('skyreels_submit');

  try {
    const response = await fetch(`${SKYREELS_API_URL}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      log.error('SkyReels submit failed', {
        status: response.status,
        error: errorText,
        time_ms: log.endTiming('skyreels_submit'),
      });

      if (response.status === 481) {
        return {
          taskId: null,
          error: 'skyreels_parallel_limit',
        };
      }

      return {
        taskId: null,
        error: `SkyReels submit failed: ${response.status}`,
      };
    }
    const result = await response.json();
    log.success('SkyReels task submitted', {
      task_id: result.task_id,
      time_ms: log.endTiming('skyreels_submit'),
    });
    return { taskId: result.task_id, error: null };
  } catch (err) {
    log.error('SkyReels submit exception', {
      error: err instanceof Error ? err.message : String(err),
      time_ms: log.endTiming('skyreels_submit'),
    });
    return { taskId: null, error: 'SkyReels request exception' };
  }
}

async function sendRefVideoRequest(
  context: RefVideoContext,
  resolution: string,
  model: string,
  modelConfig: ModelConfig,
  aspect_ratio: string | undefined,
  enableAudio: boolean,
  log: ReturnType<typeof createLogger>
): Promise<{ requestId: string | null; error: string | null }> {
  const webhookParams = new URLSearchParams({
    step: 'GenerateVideo',
    scene_id: context.scene_id,
  });
  const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/fal?${webhookParams.toString()}`;

  const falUrl = new URL(`https://queue.fal.run/${modelConfig.endpoint}`);
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  log.api('fal.ai', modelConfig.endpoint, {
    scene_id: context.scene_id,
    model,
    resolution,
    duration: context.duration,
    aspect_ratio,
    ...(model === 'wan26flash' ? { enable_audio: enableAudio } : {}),
  });
  log.startTiming('fal_video_request');

  try {
    let payload: Record<string, unknown>;
    if (model === 'wan26flash') {
      payload = modelConfig.buildPayload!({
        prompt: context.prompt,
        image_url: '',
        image_urls: [context.background_url, ...context.object_urls],
        video_urls: [],
        resolution,
        duration: context.duration,
        aspect_ratio,
        multi_shots: context.multi_shots,
        enable_audio: enableAudio,
      });
    } else {
      const elements = context.object_urls.map((url) => ({
        frontal_image_url: url,
        reference_image_urls: [url],
      }));
      payload = modelConfig.buildPayload!({
        prompt: context.prompt,
        image_url: '',
        resolution,
        elements,
        image_urls: [context.background_url],
        duration: context.duration,
        aspect_ratio,
        multi_prompt: context.multi_prompt,
        multi_shots: context.multi_shots,
        enable_audio: enableAudio,
      });
    }

    const falResponse = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, web_search: true }),
    });
    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      log.error('fal.ai ref video request failed', {
        status: falResponse.status,
        error: errorText,
        time_ms: log.endTiming('fal_video_request'),
      });
      return {
        requestId: null,
        error: `fal.ai request failed: ${falResponse.status}`,
      };
    }
    const falResult = await falResponse.json();
    log.success('fal.ai ref video request accepted', {
      request_id: falResult.request_id,
      time_ms: log.endTiming('fal_video_request'),
    });
    return { requestId: falResult.request_id, error: null };
  } catch (err) {
    log.error('fal.ai ref video request exception', {
      error: err instanceof Error ? err.message : String(err),
      time_ms: log.endTiming('fal_video_request'),
    });
    return { requestId: null, error: 'Request exception' };
  }
}

async function sendVideoRequest(
  context: VideoContext,
  resolution: string,
  modelConfig: ModelConfig,
  aspect_ratio: string | undefined,
  log: ReturnType<typeof createLogger>
): Promise<{ requestId: string | null; error: string | null }> {
  const webhookParams = new URLSearchParams({
    step: 'GenerateVideo',
    scene_id: context.scene_id,
  });
  const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/fal?${webhookParams.toString()}`;

  const falUrl = new URL(`https://queue.fal.run/${modelConfig.endpoint}`);
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  log.api('fal.ai', modelConfig.endpoint, {
    scene_id: context.scene_id,
    resolution,
    duration: context.duration,
  });
  log.startTiming('fal_video_request');

  try {
    const payload = modelConfig.buildPayload!({
      prompt: context.visual_prompt,
      image_url: context.final_url,
      resolution,
      duration: context.duration,
      aspect_ratio,
    });
    const falResponse = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, web_search: true }),
    });
    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      log.error('fal.ai video request failed', {
        status: falResponse.status,
        error: errorText,
        time_ms: log.endTiming('fal_video_request'),
      });
      return {
        requestId: null,
        error: `fal.ai request failed: ${falResponse.status}`,
      };
    }
    const falResult = await falResponse.json();
    log.success('fal.ai video request accepted', {
      request_id: falResult.request_id,
      time_ms: log.endTiming('fal_video_request'),
    });
    return { requestId: falResult.request_id, error: null };
  } catch (err) {
    log.error('fal.ai video request exception', {
      error: err instanceof Error ? err.message : String(err),
      time_ms: log.endTiming('fal_video_request'),
    });
    return { requestId: null, error: 'Request exception' };
  }
}

async function queueDirectRefVideo(
  supabase: ReturnType<typeof createServiceClient>,
  sceneId: string,
  resolution: string,
  model: ModelKey,
  modelConfig: ModelConfig,
  aspect_ratio: string | undefined,
  wanEnableAudio: boolean,
  durationOverride: number | undefined,
  log: ReturnType<typeof createLogger>,
  fallback_duration: number | undefined,
  skyreelsDurationMode: 'auto' | 'fixed',
  skyreelsDurationSeconds: number | undefined
): Promise<{
  scene_id: string;
  request_id: string | null;
  status: 'queued' | 'skipped' | 'failed';
  error?: string;
}> {
  const effectiveDurationOverride =
    model === 'skyreels' && skyreelsDurationMode === 'fixed'
      ? skyreelsDurationSeconds
      : durationOverride;

  const refContext = await getRefVideoContext(
    supabase,
    sceneId,
    model,
    modelConfig.bucketDuration,
    log,
    fallback_duration,
    effectiveDurationOverride,
    skyreelsDurationMode
  );

  if (!refContext) {
    return {
      scene_id: sceneId,
      request_id: null,
      status: 'skipped',
      error: 'Prerequisites not met',
    };
  }

  await supabase
    .from('scenes')
    .update({
      video_status: 'processing',
      video_resolution: resolution,
      video_model: model,
    })
    .eq('id', refContext.scene_id);

  if (model === 'skyreels') {
    const { taskId, error } = await sendSkyReelsRequest(
      refContext,
      aspect_ratio,
      log
    );

    if (error || !taskId) {
      if (error === 'skyreels_parallel_limit') {
        await supabase
          .from('scenes')
          .update({
            video_status: 'pending',
            video_error_message: 'skyreels_parallel_limit',
          })
          .eq('id', refContext.scene_id);

        return {
          scene_id: sceneId,
          request_id: null,
          status: 'skipped',
          error: 'SkyReels parallel limit exceeded',
        };
      }

      await supabase
        .from('scenes')
        .update({
          video_status: 'failed',
          video_error_message: error || 'request_error',
        })
        .eq('id', refContext.scene_id);

      return {
        scene_id: sceneId,
        request_id: null,
        status: 'failed',
        error: error || 'Unknown error',
      };
    }

    await supabase
      .from('scenes')
      .update({ video_request_id: taskId })
      .eq('id', refContext.scene_id);

    return {
      scene_id: sceneId,
      request_id: taskId,
      status: 'queued',
    };
  }

  const { requestId, error } = await sendRefVideoRequest(
    refContext,
    resolution,
    model,
    modelConfig,
    aspect_ratio,
    wanEnableAudio,
    log
  );

  if (error || !requestId) {
    await supabase
      .from('scenes')
      .update({
        video_status: 'failed',
        video_error_message: 'request_error',
      })
      .eq('id', refContext.scene_id);

    return {
      scene_id: sceneId,
      request_id: null,
      status: 'failed',
      error: error || 'Unknown error',
    };
  }

  await supabase
    .from('scenes')
    .update({ video_request_id: requestId })
    .eq('id', refContext.scene_id);

  return {
    scene_id: sceneId,
    request_id: requestId,
    status: 'queued',
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const log = createLogger();
  log.setContext({ step: 'GenerateVideo' });

  try {
    const authClient = await createClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    log.info('Request received');
    const input: GenerateVideoInput = await req.json();
    const {
      scene_ids,
      resolution = '720p',
      model = DEFAULT_MODEL,
      generation_path,
      aspect_ratio,
      fallback_duration,
      storyboard_id,
      enable_audio = true,
      duration_overrides,
      skyreels_duration_mode = 'auto',
      skyreels_duration_seconds,
    } = input;

    if (!scene_ids || !Array.isArray(scene_ids) || scene_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'scene_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    if (generation_path && generation_path !== 'i2v') {
      return NextResponse.json(
        {
          success: false,
          error: 'generation_path only supports i2v override',
        },
        { status: 400 }
      );
    }

    const modelConfig = MODEL_CONFIG[model];
    if (!modelConfig) {
      return NextResponse.json(
        {
          success: false,
          error: `model must be one of: ${Object.keys(MODEL_CONFIG).join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (!['auto', 'fixed'].includes(skyreels_duration_mode)) {
      return NextResponse.json(
        {
          success: false,
          error: 'skyreels_duration_mode must be auto or fixed',
        },
        { status: 400 }
      );
    }

    if (typeof enable_audio !== 'boolean') {
      return NextResponse.json(
        {
          success: false,
          error: 'enable_audio must be a boolean',
        },
        { status: 400 }
      );
    }

    if (
      duration_overrides !== undefined &&
      (typeof duration_overrides !== 'object' || duration_overrides === null)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'duration_overrides must be an object when provided',
        },
        { status: 400 }
      );
    }

    if (
      duration_overrides &&
      Object.entries(duration_overrides).some(
        ([sceneId, seconds]) =>
          typeof sceneId !== 'string' ||
          !sceneId ||
          (seconds !== 5 && seconds !== 10)
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'duration_overrides values must be 5 or 10 seconds',
        },
        { status: 400 }
      );
    }

    if (
      skyreels_duration_mode === 'fixed' &&
      (typeof skyreels_duration_seconds !== 'number' ||
        skyreels_duration_seconds < 1 ||
        skyreels_duration_seconds > 5)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'skyreels_duration_seconds must be between 1 and 5',
        },
        { status: 400 }
      );
    }

    const usesResolution = !['klingo3', 'klingo3pro'].includes(model);
    if (usesResolution && !modelConfig.validResolutions.includes(resolution)) {
      return NextResponse.json(
        {
          success: false,
          error: `resolution must be one of: ${modelConfig.validResolutions.join(', ')} for model ${model}`,
        },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    let storyboardMode: string | null = null;
    let storyboardModel: string | null = null;
    let storyboardVideoMode: 'narrative' | 'dialogue_scene' | null = null;

    if (storyboard_id) {
      const { data: sb } = await supabase
        .from('storyboards')
        .select('mode, model, plan')
        .eq('id', storyboard_id)
        .single();

      storyboardMode = sb?.mode ?? null;
      storyboardModel = sb?.model ?? null;
      if (
        sb?.plan &&
        typeof sb.plan === 'object' &&
        'video_mode' in sb.plan &&
        (sb.plan.video_mode === 'narrative' ||
          sb.plan.video_mode === 'dialogue_scene')
      ) {
        storyboardVideoMode = sb.plan.video_mode;
      }
    }

    const isStoryboardRefMode = storyboardMode === 'ref_to_video';
    const forceI2v = generation_path === 'i2v';

    if (forceI2v && modelConfig.mode !== 'image_to_video') {
      return NextResponse.json(
        {
          success: false,
          error: 'i2v override requires an image_to_video model',
        },
        { status: 400 }
      );
    }

    const directStoryboardRefModel: ModelKey | null =
      storyboardModel &&
      isModelKey(storyboardModel) &&
      MODEL_CONFIG[storyboardModel].mode === 'ref_to_video'
        ? storyboardModel
        : null;

    const requestedRefModel: ModelKey | null =
      isModelKey(model) && MODEL_CONFIG[model].mode === 'ref_to_video'
        ? model
        : null;

    const isRefMode = isStoryboardRefMode
      ? !forceI2v
      : modelConfig.mode === 'ref_to_video';

    const effectiveDirectRefModel: ModelKey | null = isRefMode
      ? isStoryboardRefMode
        ? directStoryboardRefModel
        : requestedRefModel
      : null;

    const isNarrativeMode = storyboardVideoMode === 'narrative';
    const effectiveEnableAudio =
      isNarrativeMode &&
      (effectiveDirectRefModel === 'wan26flash' ||
        effectiveDirectRefModel === 'klingo3' ||
        effectiveDirectRefModel === 'klingo3pro')
        ? false
        : enable_audio;

    if (isRefMode && !effectiveDirectRefModel) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Direct ref_to_video path requires a valid ref model (klingo3, klingo3pro, wan26flash, skyreels)',
        },
        { status: 400 }
      );
    }

    log.info('Processing video requests', {
      scene_count: scene_ids.length,
      resolution,
      model,
      mode: isRefMode
        ? 'ref_to_video'
        : forceI2v
          ? 'i2v_override'
          : 'image_to_video',
      ...(model === 'skyreels'
        ? {
            skyreels_duration_mode,
            skyreels_duration_seconds:
              skyreels_duration_mode === 'fixed'
                ? skyreels_duration_seconds
                : undefined,
          }
        : {}),
      ...(model === 'wan26flash'
        ? {
            enable_audio: effectiveEnableAudio,
            storyboard_video_mode: storyboardVideoMode,
          }
        : {}),
    });

    const results: Array<{
      scene_id: string;
      request_id: string | null;
      status: 'queued' | 'skipped' | 'failed';
      error?: string;
    }> = [];

    for (let i = 0; i < scene_ids.length; i++) {
      const sceneId = scene_ids[i];
      if (i > 0) {
        log.info('Waiting before next request', { delay_ms: 1000, index: i });
        await delay(1000);
      }

      if (forceI2v) {
        const i2vContext = await getVideoContext(
          supabase,
          sceneId,
          modelConfig.bucketDuration,
          log,
          fallback_duration
        );

        if (!i2vContext) {
          results.push({
            scene_id: sceneId,
            request_id: null,
            status: 'skipped',
            error: 'Prerequisites not met (missing first frame)',
          });
          continue;
        }

        await supabase
          .from('scenes')
          .update({
            video_status: 'processing',
            video_resolution: resolution,
            video_model: model,
          })
          .eq('id', i2vContext.scene_id);

        const { requestId, error } = await sendVideoRequest(
          i2vContext,
          resolution,
          modelConfig,
          aspect_ratio,
          log
        );

        if (error || !requestId) {
          await supabase
            .from('scenes')
            .update({
              video_status: 'failed',
              video_error_message: 'request_error',
            })
            .eq('id', i2vContext.scene_id);

          results.push({
            scene_id: sceneId,
            request_id: null,
            status: 'failed',
            error: error || 'Unknown error',
          });
          continue;
        }

        await supabase
          .from('scenes')
          .update({ video_request_id: requestId })
          .eq('id', i2vContext.scene_id);

        results.push({
          scene_id: sceneId,
          request_id: requestId,
          status: 'queued',
        });

        continue;
      }

      if (isRefMode && effectiveDirectRefModel) {
        const durationOverrideForScene = duration_overrides?.[sceneId];

        const directResult = await queueDirectRefVideo(
          supabase,
          sceneId,
          resolution,
          effectiveDirectRefModel,
          MODEL_CONFIG[effectiveDirectRefModel],
          aspect_ratio,
          effectiveEnableAudio,
          durationOverrideForScene,
          log,
          fallback_duration,
          skyreels_duration_mode,
          skyreels_duration_seconds
        );
        results.push(directResult);

        if (
          effectiveDirectRefModel === 'skyreels' &&
          directResult.error === 'SkyReels parallel limit exceeded'
        ) {
          const remainingSceneIds = scene_ids.slice(i + 1);

          if (remainingSceneIds.length > 0) {
            await supabase
              .from('scenes')
              .update({
                video_status: 'pending',
                video_error_message: 'skyreels_parallel_limit',
              })
              .in('id', remainingSceneIds)
              .eq('video_status', 'failed');

            results.push(
              ...remainingSceneIds.map((remainingSceneId) => ({
                scene_id: remainingSceneId,
                request_id: null,
                status: 'skipped' as const,
                error:
                  'Deferred due to SkyReels parallel limit (will need retry)',
              }))
            );
          }

          break;
        }

        continue;
      }

      const context = await getVideoContext(
        supabase,
        sceneId,
        modelConfig.bucketDuration,
        log,
        fallback_duration
      );
      if (!context) {
        results.push({
          scene_id: sceneId,
          request_id: null,
          status: 'skipped',
          error: 'Prerequisites not met',
        });
        continue;
      }

      await supabase
        .from('scenes')
        .update({
          video_status: 'processing',
          video_resolution: resolution,
          video_model: model,
        })
        .eq('id', context.scene_id);
      const { requestId, error } = await sendVideoRequest(
        context,
        resolution,
        modelConfig,
        aspect_ratio,
        log
      );
      if (error || !requestId) {
        await supabase
          .from('scenes')
          .update({
            video_status: 'failed',
            video_error_message: 'request_error',
          })
          .eq('id', context.scene_id);
        results.push({
          scene_id: sceneId,
          request_id: null,
          status: 'failed',
          error: error || 'Unknown error',
        });
        continue;
      }
      await supabase
        .from('scenes')
        .update({ video_request_id: requestId })
        .eq('id', context.scene_id);
      results.push({
        scene_id: sceneId,
        request_id: requestId,
        status: 'queued',
      });
    }

    const queuedCount = results.filter((r) => r.status === 'queued').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

    log.summary('success', {
      total: scene_ids.length,
      queued: queuedCount,
      skipped: skippedCount,
      failed: failedCount,
    });

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: scene_ids.length,
        queued: queuedCount,
        skipped: skippedCount,
        failed: failedCount,
      },
    });
  } catch (error) {
    log.error('Unexpected error', {
      error: error instanceof Error ? error.message : String(error),
    });
    log.summary('error', { reason: 'unexpected_exception' });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
