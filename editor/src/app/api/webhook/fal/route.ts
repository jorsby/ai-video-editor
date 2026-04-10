import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { probeMediaDuration } from '@/lib/media-probe';
import { transcribeSceneVideo } from '@/lib/transcribe/transcribe-url';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function ok(body: Record<string, unknown>) {
  return NextResponse.json(body, { status: 200, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/webhook/fal?step=GenerateSceneVideo&scene_id=xxx
 *
 * fal.ai sends the completed result here.
 * Payload shape: { status: "COMPLETED", payload: { video: { url, duration, ... } }, request_id: "..." }
 * or { status: "FAILED", error: "...", request_id: "..." }
 */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const step = url.searchParams.get('step');
    const sceneId = url.searchParams.get('scene_id');

    if (step !== 'GenerateSceneVideo' || !sceneId) {
      return ok({ success: false, error: 'Missing step or scene_id' });
    }

    const body = await req.json().catch(() => ({}));

    console.log('[webhook/fal] Received:', JSON.stringify(body).slice(0, 500));

    const supabase = createServiceClient('studio');

    // fal.ai webhook payload
    const status = body.status as string | undefined;
    const requestId = body.request_id as string | undefined;

    // ── Failed ─────────────────────────────────────────────────
    if (status === 'FAILED' || status === 'ERROR') {
      console.error('[webhook/fal] Job failed:', body.error ?? body);
      await supabase
        .from('scenes')
        .update({ video_status: 'failed', video_task_id: null })
        .eq('id', sceneId);

      return ok({ success: true, failed: true, scene_id: sceneId });
    }

    // ── In progress ────────────────────────────────────────────
    if (
      status === 'IN_PROGRESS' ||
      status === 'IN_QUEUE' ||
      status === 'PENDING'
    ) {
      return ok({ success: true, pending: true });
    }

    // ── Completed ──────────────────────────────────────────────
    // fal.ai sends { status: "COMPLETED", payload: { video: { url, ... } } }
    // or just { video: { url, ... } } in some cases
    const payload = body.payload ?? body;
    const videoUrl = payload?.video?.url ?? payload?.output?.video?.url ?? null;

    if (!videoUrl) {
      console.error(
        '[webhook/fal] No video URL in payload:',
        JSON.stringify(body).slice(0, 500)
      );
      await supabase
        .from('scenes')
        .update({ video_status: 'failed', video_task_id: null })
        .eq('id', sceneId);

      return ok({ success: true, failed: true, error: 'no_video_url' });
    }

    // Probe actual duration
    const videoDuration = await probeMediaDuration(videoUrl);

    await supabase
      .from('scenes')
      .update({
        video_url: videoUrl,
        ...(videoDuration != null ? { video_duration: videoDuration } : {}),
        video_status: 'done',
        video_task_id: null,
      })
      .eq('id', sceneId);

    // Fire-and-forget: transcribe the video
    void transcribeSceneVideo(supabase, sceneId, videoUrl).catch((err) =>
      console.error('[webhook/fal] Transcription failed (non-fatal):', err)
    );

    return ok({
      success: true,
      scene_id: sceneId,
      video_url: videoUrl,
      video_duration: videoDuration,
      provider: 'fal',
    });
  } catch (error) {
    console.error('[webhook/fal] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
