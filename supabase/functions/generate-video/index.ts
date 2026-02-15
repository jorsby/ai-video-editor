import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createLogger } from '../_shared/logger.ts';

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const FAL_API_KEY = getRequiredEnv('FAL_KEY');
const SUPABASE_URL = getRequiredEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, x-client-info, apikey',
};

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function corsResponse(): Response {
  return new Response(null, { headers: CORS_HEADERS });
}

function jsonResponse(data: object, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function errorResponse(error: string, status = 500): Response {
  return jsonResponse({ success: false, error }, status);
}

// ── Model configuration ───────────────────────────────────────────────

interface ModelConfig {
  endpoint: string;
  validResolutions: string[];
  bucketDuration: (rawCeil: number) => number;
  buildPayload: (opts: {
    prompt: string;
    image_url: string;
    resolution: string;
    duration: number;
    aspect_ratio?: string;
  }) => Record<string, unknown>;
}

const MODEL_CONFIG: Record<string, ModelConfig> = {
  'wan2.6': {
    endpoint: 'workflows/octupost/wan26',
    validResolutions: ['720p', '1080p'],
    bucketDuration: (raw) => (raw <= 5 ? 5 : raw <= 10 ? 10 : 15),
    buildPayload: ({ prompt, image_url, resolution, duration }) => ({
      prompt,
      image_url,
      resolution,
      duration: String(duration),
    }),
  },
  'bytedance1.5pro': {
    endpoint: 'workflows/octupost/bytedancepro15',
    validResolutions: ['480p', '720p', '1080p'],
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
      duration: String(duration),
    }),
  },
  grok: {
    endpoint: 'workflows/octupost/grok',
    validResolutions: ['480p', '720p'],
    bucketDuration: (raw) => Math.max(1, Math.min(15, raw)),
    buildPayload: ({ prompt, image_url, resolution, duration }) => ({
      prompt,
      image_url,
      resolution,
      duration: String(duration),
    }),
  },
};

const DEFAULT_MODEL = 'bytedance1.5pro';

// ── Types ─────────────────────────────────────────────────────────────

interface GenerateVideoInput {
  scene_ids: string[];
  resolution: '480p' | '720p' | '1080p';
  model?: string;
  aspect_ratio?: string;
  fallback_duration?: number;
}

interface VideoContext {
  first_frame_id: string;
  scene_id: string;
  final_url: string;
  visual_prompt: string;
  duration: number;
}

type SupabaseClient = ReturnType<typeof createClient>;

// ── Helpers ───────────────────────────────────────────────────────────

async function getVideoContext(
  supabase: SupabaseClient,
  sceneId: string,
  bucketDuration: (raw: number) => number,
  log: ReturnType<typeof createLogger>,
  fallbackDuration?: number
): Promise<VideoContext | null> {
  const { data: scene, error: sceneError } = await supabase
    .from('scenes')
    .select(`
      id,
      first_frames (id, final_url, visual_prompt, video_status),
      voiceovers (duration)
    `)
    .eq('id', sceneId)
    .single();

  if (sceneError || !scene) {
    log.error('Failed to fetch scene', {
      scene_id: sceneId,
      error: sceneError?.message,
    });
    return null;
  }

  const firstFrame = scene.first_frames?.[0];
  if (!firstFrame) {
    log.error('No first_frame found for scene', { scene_id: sceneId });
    return null;
  }

  if (!firstFrame.final_url) {
    log.warn('No final_url for first_frame (outpaint required)', {
      first_frame_id: firstFrame.id,
    });
    return null;
  }

  if (firstFrame.video_status === 'processing') {
    log.warn('Video already processing, skipping', {
      first_frame_id: firstFrame.id,
    });
    return null;
  }

  const maxDuration = Math.max(
    0,
    ...(scene.voiceovers || []).map(
      (v: { duration?: number }) => v.duration ?? 0
    )
  );
  if (maxDuration === 0) {
    if (fallbackDuration && fallbackDuration > 0) {
      log.info('Using fallback duration (no voiceover)', {
        scene_id: sceneId,
        fallback_duration: fallbackDuration,
      });
    } else {
      log.warn('No voiceover duration found', { scene_id: sceneId });
      return null;
    }
  }

  const raw = maxDuration > 0 ? Math.ceil(maxDuration) : fallbackDuration!;
  const durationInt = bucketDuration(raw);

  return {
    first_frame_id: firstFrame.id,
    scene_id: sceneId,
    final_url: firstFrame.final_url,
    visual_prompt: firstFrame.visual_prompt || '',
    duration: durationInt,
  };
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
    first_frame_id: context.first_frame_id,
  });
  const webhookUrl = `${SUPABASE_URL}/functions/v1/webhook?${webhookParams.toString()}`;

  const falUrl = new URL(`https://queue.fal.run/${modelConfig.endpoint}`);
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  log.api('fal.ai', modelConfig.endpoint, {
    first_frame_id: context.first_frame_id,
    resolution,
    duration: context.duration,
  });
  log.startTiming('fal_video_request');

  try {
    const payload = modelConfig.buildPayload({
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
      body: JSON.stringify(payload),
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const log = createLogger();
  log.setContext({ step: 'GenerateVideo' });

  try {
    log.info('Request received', { method: req.method });

    const input: GenerateVideoInput = await req.json();
    const {
      scene_ids,
      resolution = '720p',
      model = DEFAULT_MODEL,
      aspect_ratio,
      fallback_duration,
    } = input;

    if (!scene_ids || !Array.isArray(scene_ids) || scene_ids.length === 0) {
      log.error('Invalid input', { scene_ids });
      return errorResponse('scene_ids must be a non-empty array', 400);
    }

    const modelConfig = MODEL_CONFIG[model];
    if (!modelConfig) {
      log.error('Invalid model', { model });
      return errorResponse(
        `model must be one of: ${Object.keys(MODEL_CONFIG).join(', ')}`,
        400
      );
    }

    if (!modelConfig.validResolutions.includes(resolution)) {
      log.error('Invalid resolution for model', { model, resolution });
      return errorResponse(
        `resolution must be one of: ${modelConfig.validResolutions.join(', ')} for model ${model}`,
        400
      );
    }

    log.info('Processing video requests', {
      scene_count: scene_ids.length,
      resolution,
      model,
    });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const results: Array<{
      scene_id: string;
      first_frame_id: string | null;
      request_id: string | null;
      status: 'queued' | 'skipped' | 'failed';
      error?: string;
    }> = [];

    for (let i = 0; i < scene_ids.length; i++) {
      const sceneId = scene_ids[i];

      // Add delay between requests (except for the first one)
      if (i > 0) {
        log.info('Waiting before next request', { delay_ms: 1000, index: i });
        await delay(1000);
      }

      // Get video context
      log.startTiming(`get_context_${i}`);
      const context = await getVideoContext(
        supabase,
        sceneId,
        modelConfig.bucketDuration,
        log,
        fallback_duration
      );
      log.info('Video context fetched', {
        scene_id: sceneId,
        has_context: !!context,
        time_ms: log.endTiming(`get_context_${i}`),
      });

      if (!context) {
        results.push({
          scene_id: sceneId,
          first_frame_id: null,
          request_id: null,
          status: 'skipped',
          error:
            'Prerequisites not met (need outpainted image and voiceover duration)',
        });
        continue;
      }

      // Update status to processing and store resolution
      await supabase
        .from('first_frames')
        .update({ video_status: 'processing', video_resolution: resolution })
        .eq('id', context.first_frame_id);

      // Send video request
      const { requestId, error } = await sendVideoRequest(
        context,
        resolution,
        modelConfig,
        aspect_ratio,
        log
      );

      if (error || !requestId) {
        // Mark as failed
        await supabase
          .from('first_frames')
          .update({
            video_status: 'failed',
            video_error_message: 'request_error',
          })
          .eq('id', context.first_frame_id);

        results.push({
          scene_id: sceneId,
          first_frame_id: context.first_frame_id,
          request_id: null,
          status: 'failed',
          error: error || 'Unknown error',
        });
        continue;
      }

      // Store request_id
      await supabase
        .from('first_frames')
        .update({ video_request_id: requestId })
        .eq('id', context.first_frame_id);

      results.push({
        scene_id: sceneId,
        first_frame_id: context.first_frame_id,
        request_id: requestId,
        status: 'queued',
      });

      log.success('Video request queued', {
        scene_id: sceneId,
        first_frame_id: context.first_frame_id,
        request_id: requestId,
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

    return jsonResponse({
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
    return errorResponse('Internal server error');
  }
});
