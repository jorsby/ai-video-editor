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

interface GenerateSfxInput {
  scene_ids: string[];
}

type SupabaseClient = ReturnType<typeof createClient>;

async function getSfxContext(
  supabase: SupabaseClient,
  sceneId: string,
  log: ReturnType<typeof createLogger>
): Promise<{
  scene_id: string;
  video_url: string;
  sfx_prompt: string | null;
} | null> {
  const { data: scene, error: sceneError } = await supabase
    .from('scenes')
    .select(`
      id,
      video_url,
      video_status,
      sfx_status,
      sfx_prompt
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

  if (scene.video_status !== 'success' || !scene.video_url) {
    log.warn('No successful video for scene, skipping', {
      scene_id: sceneId,
      video_status: scene.video_status,
    });
    return null;
  }

  if (scene.sfx_status === 'processing') {
    log.warn('SFX already processing, skipping', {
      scene_id: sceneId,
    });
    return null;
  }

  return {
    scene_id: sceneId,
    video_url: scene.video_url,
    sfx_prompt: scene.sfx_prompt ?? null,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const log = createLogger();
  log.setContext({ step: 'GenerateSFX' });

  try {
    log.info('Request received', { method: req.method });

    const input: GenerateSfxInput = await req.json();
    const { scene_ids } = input;

    if (!scene_ids || !Array.isArray(scene_ids) || scene_ids.length === 0) {
      log.error('Invalid input', { scene_ids });
      return errorResponse('scene_ids must be a non-empty array', 400);
    }

    log.info('Processing SFX requests', {
      scene_count: scene_ids.length,
    });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const results: Array<{
      scene_id: string;
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

      // Get SFX context
      log.startTiming(`get_context_${i}`);
      const context = await getSfxContext(supabase, sceneId, log);
      log.info('SFX context fetched', {
        scene_id: sceneId,
        has_context: !!context,
        time_ms: log.endTiming(`get_context_${i}`),
      });

      if (!context) {
        results.push({
          scene_id: sceneId,
          request_id: null,
          status: 'skipped',
          error: 'Prerequisites not met (need successful video)',
        });
        continue;
      }

      // Update status to processing
      await supabase
        .from('scenes')
        .update({ sfx_status: 'processing' })
        .eq('id', context.scene_id);

      // Build webhook URL
      const webhookParams = new URLSearchParams({
        step: 'GenerateSFX',
        scene_id: context.scene_id,
      });
      const webhookUrl = `${SUPABASE_URL}/functions/v1/webhook?${webhookParams.toString()}`;

      const falUrl = new URL('https://queue.fal.run/workflows/octupost/sfx');
      falUrl.searchParams.set('fal_webhook', webhookUrl);

      log.api('fal.ai', 'workflows/octupost/sfx', {
        scene_id: context.scene_id,
      });
      log.startTiming(`fal_sfx_request_${i}`);

      try {
        const falResponse = await fetch(falUrl.toString(), {
          method: 'POST',
          headers: {
            Authorization: `Key ${FAL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            video_url: context.video_url,
            ...(context.sfx_prompt ? { prompt: context.sfx_prompt } : {}),
          }),
        });

        if (!falResponse.ok) {
          const errorText = await falResponse.text();
          log.error('fal.ai SFX request failed', {
            status: falResponse.status,
            error: errorText,
            time_ms: log.endTiming(`fal_sfx_request_${i}`),
          });

          await supabase
            .from('scenes')
            .update({
              sfx_status: 'failed',
              sfx_error_message: 'request_error',
            })
            .eq('id', context.scene_id);

          results.push({
            scene_id: sceneId,
            request_id: null,
            status: 'failed',
            error: `fal.ai request failed: ${falResponse.status}`,
          });
          continue;
        }

        const falResult = await falResponse.json();
        log.success('fal.ai SFX request accepted', {
          request_id: falResult.request_id,
          time_ms: log.endTiming(`fal_sfx_request_${i}`),
        });

        // Store request_id
        await supabase
          .from('scenes')
          .update({ sfx_request_id: falResult.request_id })
          .eq('id', context.scene_id);

        results.push({
          scene_id: sceneId,
          request_id: falResult.request_id,
          status: 'queued',
        });

        log.success('SFX request queued', {
          scene_id: sceneId,
          request_id: falResult.request_id,
        });
      } catch (err) {
        log.error('fal.ai SFX request exception', {
          error: err instanceof Error ? err.message : String(err),
          time_ms: log.endTiming(`fal_sfx_request_${i}`),
        });

        await supabase
          .from('scenes')
          .update({
            sfx_status: 'failed',
            sfx_error_message: 'request_error',
          })
          .eq('id', context.scene_id);

        results.push({
          scene_id: sceneId,
          request_id: null,
          status: 'failed',
          error: 'Request exception',
        });
      }
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
