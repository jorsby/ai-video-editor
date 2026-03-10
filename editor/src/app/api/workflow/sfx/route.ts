import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

const FAL_API_KEY = process.env.FAL_KEY!;
const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL!;

interface GenerateSfxInput {
  scene_ids: string[];
}

async function getSfxContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sceneId: string,
  log: ReturnType<typeof createLogger>
): Promise<{
  scene_id: string;
  video_url: string;
  sfx_prompt: string | null;
} | null> {
  const { data: scene, error: sceneError } = await supabase
    .from('scenes')
    .select(`id, video_url, video_status, sfx_status, sfx_prompt`)
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
    log.warn('SFX already processing, skipping', { scene_id: sceneId });
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

export async function POST(req: NextRequest) {
  const log = createLogger();
  log.setContext({ step: 'GenerateSFX' });

  try {
    const authClient = await createClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    log.info('Request received');

    const input: GenerateSfxInput = await req.json();
    const { scene_ids } = input;

    if (!scene_ids || !Array.isArray(scene_ids) || scene_ids.length === 0) {
      log.error('Invalid input', { scene_ids });
      return NextResponse.json(
        { success: false, error: 'scene_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    log.info('Processing SFX requests', { scene_count: scene_ids.length });

    const supabase = createServiceClient();

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

      await supabase
        .from('scenes')
        .update({ sfx_status: 'processing' })
        .eq('id', context.scene_id);

      const webhookParams = new URLSearchParams({
        step: 'GenerateSFX',
        scene_id: context.scene_id,
      });
      const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/fal?${webhookParams.toString()}`;

      const falUrl = new URL(
        'https://queue.fal.run/mirelo-ai/sfx-v1.5/video-to-video'
      );
      falUrl.searchParams.set('fal_webhook', webhookUrl);

      log.api('fal.ai', 'mirelo-ai/sfx-v1.5/video-to-video', {
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
            ...(context.sfx_prompt ? { text_prompt: context.sfx_prompt } : {}),
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
          .update({ sfx_status: 'failed', sfx_error_message: 'request_error' })
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
