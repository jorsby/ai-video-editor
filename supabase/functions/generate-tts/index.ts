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

const TTS_ENDPOINTS: Record<string, string> = {
  'turbo-v2.5': 'fal-ai/elevenlabs/tts/turbo-v2.5',
  'multilingual-v2': 'fal-ai/elevenlabs/tts/multilingual-v2',
};

const DEFAULT_TTS_MODEL = 'turbo-v2.5';

interface GenerateTTSInput {
  scene_ids: string[];
  voice?: string;
  model?: 'turbo-v2.5' | 'multilingual-v2';
  language?: string;
  speed?: number;
}

interface SceneContext {
  voiceover_id: string;
  scene_id: string;
  text: string;
  previous_text: string | null;
  next_text: string | null;
}

type SupabaseClient = ReturnType<typeof createClient>;

async function getSceneContext(
  supabase: SupabaseClient,
  sceneId: string,
  language: string,
  log: ReturnType<typeof createLogger>
): Promise<SceneContext | null> {
  // Fetch the scene with its voiceover and storyboard_id
  const { data: scene, error: sceneError } = await supabase
    .from('scenes')
    .select(`
      id,
      order,
      storyboard_id,
      voiceovers (id, text, language)
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

  const voiceover = scene.voiceovers?.find(
    (v: { language: string }) => v.language === language
  );
  if (!voiceover) {
    log.error('No voiceover found for scene/language', {
      scene_id: sceneId,
      language,
    });
    return null;
  }

  // Fetch all scenes in the same storyboard for context
  const { data: allScenes, error: allScenesError } = await supabase
    .from('scenes')
    .select(`
      id,
      order,
      voiceovers (text, language)
    `)
    .eq('storyboard_id', scene.storyboard_id)
    .order('order', { ascending: true });

  if (allScenesError || !allScenes) {
    log.warn('Failed to fetch sibling scenes for context', {
      error: allScenesError?.message,
    });
    return {
      voiceover_id: voiceover.id,
      scene_id: sceneId,
      text: voiceover.text || '',
      previous_text: null,
      next_text: null,
    };
  }

  // Find current scene index
  const currentIndex = allScenes.findIndex(
    (s: { id: string }) => s.id === sceneId
  );

  // Get previous and next scene texts (filtered by same language)
  const previousScene = currentIndex > 0 ? allScenes[currentIndex - 1] : null;
  const nextScene =
    currentIndex < allScenes.length - 1 ? allScenes[currentIndex + 1] : null;

  const previous_text =
    previousScene?.voiceovers?.find(
      (v: { language: string }) => v.language === language
    )?.text || null;
  const next_text =
    nextScene?.voiceovers?.find(
      (v: { language: string }) => v.language === language
    )?.text || null;

  return {
    voiceover_id: voiceover.id,
    scene_id: sceneId,
    text: voiceover.text || '',
    previous_text,
    next_text,
  };
}

async function sendTTSRequest(
  context: SceneContext,
  voice: string,
  endpoint: string,
  speed: number,
  log: ReturnType<typeof createLogger>
): Promise<{ requestId: string | null; error: string | null }> {
  const webhookParams = new URLSearchParams({
    step: 'GenerateTTS',
    voiceover_id: context.voiceover_id,
  });
  const webhookUrl = `${SUPABASE_URL}/functions/v1/webhook?${webhookParams.toString()}`;

  const falUrl = new URL(`https://queue.fal.run/${endpoint}`);
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  log.api('fal.ai', endpoint, {
    text_length: context.text.length,
    has_previous: !!context.previous_text,
    has_next: !!context.next_text,
  });
  log.startTiming('fal_tts_request');

  try {
    const falResponse = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: context.text,
        voice,
        stability: 0.5,
        similarity_boost: 0.75,
        speed,
        previous_text: context.previous_text,
        next_text: context.next_text,
      }),
    });

    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      log.error('fal.ai TTS request failed', {
        status: falResponse.status,
        error: errorText,
        time_ms: log.endTiming('fal_tts_request'),
      });
      return {
        requestId: null,
        error: `fal.ai request failed: ${falResponse.status}`,
      };
    }

    const falResult = await falResponse.json();
    log.success('fal.ai TTS request accepted', {
      request_id: falResult.request_id,
      time_ms: log.endTiming('fal_tts_request'),
    });

    return { requestId: falResult.request_id, error: null };
  } catch (err) {
    log.error('fal.ai TTS request exception', {
      error: err instanceof Error ? err.message : String(err),
      time_ms: log.endTiming('fal_tts_request'),
    });
    return { requestId: null, error: 'Request exception' };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const log = createLogger();
  log.setContext({ step: 'GenerateTTS' });

  try {
    log.info('Request received', { method: req.method });

    const input: GenerateTTSInput = await req.json();
    const {
      scene_ids,
      voice = 'pNInz6obpgDQGcFmaJgB',
      model = DEFAULT_TTS_MODEL,
      language = 'en',
      speed: rawSpeed = 1.0,
    } = input;
    const speed = Math.min(1.2, Math.max(0.7, rawSpeed));

    if (!scene_ids || !Array.isArray(scene_ids) || scene_ids.length === 0) {
      log.error('Invalid input', { scene_ids });
      return errorResponse('scene_ids must be a non-empty array', 400);
    }

    const endpoint = TTS_ENDPOINTS[model];
    if (!endpoint) {
      log.error('Invalid TTS model', { model });
      return errorResponse(
        `model must be one of: ${Object.keys(TTS_ENDPOINTS).join(', ')}`,
        400
      );
    }

    log.info('Processing TTS requests', {
      scene_count: scene_ids.length,
      model,
    });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const results: Array<{
      scene_id: string;
      voiceover_id: string | null;
      request_id: string | null;
      status: 'queued' | 'failed';
      error?: string;
    }> = [];

    for (let i = 0; i < scene_ids.length; i++) {
      const sceneId = scene_ids[i];

      // Add delay between requests (except for the first one)
      if (i > 0) {
        log.info('Waiting before next request', { delay_ms: 1000, index: i });
        await delay(1000);
      }

      // Get scene context with previous/next text
      log.startTiming(`get_context_${i}`);
      const context = await getSceneContext(supabase, sceneId, language, log);
      log.info('Scene context fetched', {
        scene_id: sceneId,
        has_context: !!context,
        time_ms: log.endTiming(`get_context_${i}`),
      });

      if (!context) {
        results.push({
          scene_id: sceneId,
          voiceover_id: null,
          request_id: null,
          status: 'failed',
          error: 'Scene or voiceover not found',
        });
        continue;
      }

      // Skip if text is empty
      if (!context.text || context.text.trim() === '') {
        log.warn('Empty voiceover text, skipping', { scene_id: sceneId });
        await supabase
          .from('voiceovers')
          .update({ status: 'failed', error_message: 'request_error' })
          .eq('id', context.voiceover_id);
        results.push({
          scene_id: sceneId,
          voiceover_id: context.voiceover_id,
          request_id: null,
          status: 'failed',
          error: 'Empty voiceover text',
        });
        continue;
      }

      // Update status to processing
      await supabase
        .from('voiceovers')
        .update({ status: 'processing' })
        .eq('id', context.voiceover_id);

      // Send TTS request
      const { requestId, error } = await sendTTSRequest(
        context,
        voice,
        endpoint,
        speed,
        log
      );

      if (error || !requestId) {
        // Mark as failed with request_error
        await supabase
          .from('voiceovers')
          .update({ status: 'failed', error_message: 'request_error' })
          .eq('id', context.voiceover_id);

        results.push({
          scene_id: sceneId,
          voiceover_id: context.voiceover_id,
          request_id: null,
          status: 'failed',
          error: error || 'Unknown error',
        });
        continue;
      }

      // Store request_id
      await supabase
        .from('voiceovers')
        .update({ request_id: requestId })
        .eq('id', context.voiceover_id);

      results.push({
        scene_id: sceneId,
        voiceover_id: context.voiceover_id,
        request_id: requestId,
        status: 'queued',
      });

      log.success('TTS request queued', {
        scene_id: sceneId,
        voiceover_id: context.voiceover_id,
        request_id: requestId,
      });
    }

    const queuedCount = results.filter((r) => r.status === 'queued').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

    log.summary('success', {
      total: scene_ids.length,
      queued: queuedCount,
      failed: failedCount,
    });

    return jsonResponse({
      success: true,
      results,
      summary: {
        total: scene_ids.length,
        queued: queuedCount,
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
