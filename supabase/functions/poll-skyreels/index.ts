import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createLogger } from '../_shared/logger.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SKYREELS_API_URL = 'https://apis.skyreels.ai/api/v1/video/multiobject';

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const log = createLogger();
  log.setContext({ step: 'PollSkyReels' });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Mark stale tasks as failed (processing > 30 minutes)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: staleScenes } = await supabase
      .from('scenes')
      .update({
        video_status: 'failed',
        video_error_message: 'SkyReels task timed out (30 min)',
      })
      .eq('video_status', 'processing')
      .eq('video_provider', 'skyreels')
      .lt('updated_at', thirtyMinAgo)
      .select('id');

    if (staleScenes && staleScenes.length > 0) {
      log.info('Marked stale SkyReels tasks as failed', {
        count: staleScenes.length,
      });
    }

    // Fetch scenes that are processing via SkyReels
    const { data: pendingScenes, error: fetchError } = await supabase
      .from('scenes')
      .select('id, video_request_id')
      .eq('video_status', 'processing')
      .eq('video_provider', 'skyreels')
      .not('video_request_id', 'is', null);

    if (fetchError) {
      log.error('Failed to fetch pending scenes', {
        error: fetchError.message,
      });
      return new Response(
        JSON.stringify({ success: false, error: fetchError.message }),
        { status: 500, headers: JSON_HEADERS }
      );
    }

    if (!pendingScenes || pendingScenes.length === 0) {
      return new Response(JSON.stringify({ success: true, processed: 0 }), {
        headers: JSON_HEADERS,
      });
    }

    log.info('Polling SkyReels tasks', { count: pendingScenes.length });

    let successCount = 0;
    let failedCount = 0;
    let stillRunning = 0;

    for (const scene of pendingScenes) {
      try {
        const response = await fetch(
          `${SKYREELS_API_URL}/task/${scene.video_request_id}`,
          { method: 'GET' }
        );

        if (!response.ok) {
          log.error('SkyReels poll request failed', {
            scene_id: scene.id,
            task_id: scene.video_request_id,
            status: response.status,
          });
          continue;
        }

        const result = await response.json();

        if (result.status === 'success') {
          await supabase
            .from('scenes')
            .update({
              video_status: 'success',
              video_url: result.data?.video_url,
            })
            .eq('id', scene.id);

          successCount++;
          log.success('SkyReels task completed', {
            scene_id: scene.id,
            task_id: scene.video_request_id,
          });
        } else if (result.status === 'failed') {
          await supabase
            .from('scenes')
            .update({
              video_status: 'failed',
              video_error_message: result.msg || 'SkyReels task failed',
            })
            .eq('id', scene.id);

          failedCount++;
          log.error('SkyReels task failed', {
            scene_id: scene.id,
            task_id: scene.video_request_id,
            msg: result.msg,
          });
        } else {
          // Still running (submitted, pending, running)
          stillRunning++;
        }
      } catch (err) {
        log.error('Error polling SkyReels task', {
          scene_id: scene.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log.summary('success', {
      total: pendingScenes.length,
      success: successCount,
      failed: failedCount,
      still_running: stillRunning,
      stale_timed_out: staleScenes?.length ?? 0,
    });

    return new Response(
      JSON.stringify({
        success: true,
        processed: pendingScenes.length,
        success_count: successCount,
        failed_count: failedCount,
        still_running: stillRunning,
      }),
      { headers: JSON_HEADERS }
    );
  } catch (error) {
    log.error('Unexpected error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
});
