import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { createLogger } from '@/lib/logger';

const SKYREELS_API_URL = 'https://apis.skyreels.ai/api/v1/video/multiobject';

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  // Allow signed-in users to trigger polling manually from the app.
  try {
    const authClient = await createClient('studio');
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (user) return true;
  } catch {
    // Ignore auth check errors and fall through to cronSecret rule below.
  }

  // If no cron secret is configured, allow local/dev polling.
  return !cronSecret;
}

async function runPoll(trigger: 'GET' | 'POST') {
  const log = createLogger();
  log.setContext({ step: 'PollSkyReels', trigger });

  try {
    const supabase = createServiceClient();

    // Find storyboards using skyreels model
    const { data: skyreelsStoryboards } = await supabase
      .from('storyboards')
      .select('id')
      .eq('model', 'skyreels');

    const skyreelsStoryboardIds = (skyreelsStoryboards ?? []).map(
      (s: { id: string }) => s.id
    );

    if (skyreelsStoryboardIds.length === 0) {
      return NextResponse.json({ success: true, processed: 0 });
    }

    // Mark stale tasks as failed (processing > 30 minutes)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: staleScenes } = await supabase
      .from('scenes')
      .update({
        video_status: 'failed',
        video_error_message: 'SkyReels task timed out (30 min)',
      })
      .eq('video_status', 'processing')
      .in('storyboard_id', skyreelsStoryboardIds)
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
      .in('storyboard_id', skyreelsStoryboardIds)
      .not('video_request_id', 'is', null);

    if (fetchError) {
      log.error('Failed to fetch pending scenes', {
        error: fetchError.message,
      });
      return NextResponse.json(
        { success: false, error: fetchError.message },
        { status: 500 }
      );
    }

    if (!pendingScenes || pendingScenes.length === 0) {
      return NextResponse.json({ success: true, processed: 0 });
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

    return NextResponse.json({
      success: true,
      processed: pendingScenes.length,
      success_count: successCount,
      failed_count: failedCount,
      still_running: stillRunning,
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

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runPoll('GET');
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runPoll('POST');
}
