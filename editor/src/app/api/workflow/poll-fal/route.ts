import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

const FAL_API_KEY = process.env.FAL_KEY!;
const STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// fal.ai model endpoint for grid image generation
const FAL_GRID_IMAGE_ENDPOINT = 'workflows/octupost/generategridimage';
const DEFAULT_VIDEO_ENDPOINT =
  'fal-ai/bytedance/seedance/v1.5/pro/image-to-video';
const DEFAULT_IMAGE_EDIT_ENDPOINT = 'fal-ai/kling-image/o3/image-to-image';

const VIDEO_MODEL_ENDPOINTS: Record<string, string> = {
  'wan2.6': 'fal-ai/wan/v2.6/image-to-video',
  'bytedance1.5pro': 'fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
  grok: 'xai/grok-imagine-video/image-to-video',
  wan26flash: 'wan/v2.6/image-to-video/flash',
  klingo3: 'fal-ai/kling-video/o3/standard/reference-to-video',
  klingo3pro: 'fal-ai/kling-video/o3/pro/reference-to-video',
};

const IMAGE_EDIT_MODEL_ENDPOINTS: Record<string, string> = {
  kling: 'fal-ai/kling-image/o3/image-to-image',
  banana: 'fal-ai/nano-banana-2/edit',
  fibo: 'bria/fibo-edit/edit',
  grok: 'xai/grok-imagine-image/edit',
  'flux-pro': 'fal-ai/flux-2-pro/edit',
};

function resolveVideoEndpoint(videoModel: string | null): string | null {
  if (!videoModel) return DEFAULT_VIDEO_ENDPOINT;
  if (videoModel === 'skyreels') return null;

  if (videoModel.includes('/')) {
    return videoModel;
  }

  return VIDEO_MODEL_ENDPOINTS[videoModel] ?? DEFAULT_VIDEO_ENDPOINT;
}

function resolveImageEditEndpoint(imageEditModel: string | null): string {
  if (!imageEditModel) return DEFAULT_IMAGE_EDIT_ENDPOINT;

  if (imageEditModel.includes('/')) {
    return imageEditModel;
  }

  return (
    IMAGE_EDIT_MODEL_ENDPOINTS[imageEditModel] ?? DEFAULT_IMAGE_EDIT_ENDPOINT
  );
}

// ── Types ───────────────────────────────────────────────────────────

interface FalStatusResponse {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
}

interface FalResultResponse {
  images?: Array<{ url: string }>;
  video?: Array<{ url: string }> | { url: string };
  // biome-ignore lint/suspicious/noExplicitAny: fal.ai outputs vary by model
  outputs?: any;
  // biome-ignore lint/suspicious/noExplicitAny: fal.ai result shape varies
  [key: string]: any;
}

interface ItemSummary {
  processed: number;
  completed: number;
  failed: number;
  still_running: number;
  stale: number;
}

type FalJobStatus = 'completed' | 'failed' | 'running' | 'error';

function newSummary(): ItemSummary {
  return { processed: 0, completed: 0, failed: 0, still_running: 0, stale: 0 };
}

// ── fal.ai API Helpers ──────────────────────────────────────────────

async function fetchFalStatus(
  endpoint: string,
  requestId: string
): Promise<FalStatusResponse | null> {
  try {
    const url = `https://queue.fal.run/${endpoint}/requests/${requestId}/status`;
    const res = await fetch(url, {
      headers: { Authorization: `Key ${FAL_API_KEY}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchFalResult(
  endpoint: string,
  requestId: string
): Promise<FalResultResponse | null> {
  try {
    const url = `https://queue.fal.run/${endpoint}/requests/${requestId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Key ${FAL_API_KEY}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Check a single fal.ai job: fetch status, fetch result if completed.
 * Returns a normalized status + extracted URL (image or video).
 */
async function checkFalJob(
  endpoint: string,
  requestId: string,
  extractUrl: (result: FalResultResponse) => string | null
): Promise<{ status: FalJobStatus; url: string | null }> {
  const falStatus = await fetchFalStatus(endpoint, requestId);
  if (!falStatus) return { status: 'error', url: null };

  if (falStatus.status === 'FAILED') return { status: 'failed', url: null };
  if (falStatus.status !== 'COMPLETED') return { status: 'running', url: null };

  const result = await fetchFalResult(endpoint, requestId);
  if (!result) return { status: 'error', url: null };

  const url = extractUrl(result);
  return { status: 'completed', url };
}

// ── URL Extractors ──────────────────────────────────────────────────

function extractImageUrl(result: FalResultResponse): string | null {
  if (result.images?.[0]?.url) return result.images[0].url;

  const outputs = result.outputs;
  if (outputs && typeof outputs === 'object' && !Array.isArray(outputs)) {
    for (const nodeId of Object.keys(outputs)) {
      const node = outputs[nodeId];
      if (node?.images?.[0]?.url) return node.images[0].url;
    }
  }
  return null;
}

function extractVideoUrl(result: FalResultResponse): string | null {
  const video = result.video;
  if (video) {
    if (Array.isArray(video) && video[0]?.url) return video[0].url;
    if (!Array.isArray(video) && (video as { url: string }).url) {
      return (video as { url: string }).url;
    }
  }

  const outputs = result.outputs;
  if (outputs && typeof outputs === 'object' && !Array.isArray(outputs)) {
    for (const nodeId of Object.keys(outputs)) {
      const node = outputs[nodeId];
      if (node?.video) {
        if (Array.isArray(node.video) && node.video[0]?.url)
          return node.video[0].url;
        if (node.video.url) return node.video.url;
      }
    }
  }
  return null;
}

// ── Staleness Check ─────────────────────────────────────────────────

function isStale(updatedAt: string): boolean {
  return Date.now() - new Date(updatedAt).getTime() > STALE_TIMEOUT_MS;
}

// ── Poll Grid Images ────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: supabase client type
type SupabaseAdmin = any;

async function updateStoryboardPlanStatus(
  supabase: SupabaseAdmin,
  storyboardId: string,
  mode: string | null
): Promise<void> {
  if (mode === 'ref_to_video') {
    const { data: pendingOthers } = await supabase
      .from('grid_images')
      .select('id')
      .eq('storyboard_id', storyboardId)
      .in('status', ['pending', 'processing']);

    if (!pendingOthers || pendingOthers.length === 0) {
      const { data: failedGrids } = await supabase
        .from('grid_images')
        .select('id')
        .eq('storyboard_id', storyboardId)
        .eq('status', 'failed');

      const newStatus =
        failedGrids && failedGrids.length > 0 ? 'failed' : 'grid_ready';
      await supabase
        .from('storyboards')
        .update({ plan_status: newStatus })
        .eq('id', storyboardId)
        .eq('plan_status', 'generating');
    }
  } else {
    await supabase
      .from('storyboards')
      .update({ plan_status: 'grid_ready' })
      .eq('id', storyboardId)
      .eq('plan_status', 'generating');
  }
}

async function pollGridImages(
  supabase: SupabaseAdmin,
  storyboardId: string | null,
  log: ReturnType<typeof createLogger>
): Promise<ItemSummary> {
  const summary = newSummary();

  let query = supabase
    .from('grid_images')
    .select('id, storyboard_id, request_id, updated_at')
    .eq('status', 'processing')
    .not('request_id', 'is', null);

  if (storyboardId) query = query.eq('storyboard_id', storyboardId);

  const { data: items, error } = await query;
  if (error || !items) return summary;

  summary.processed = items.length;

  for (const grid of items) {
    if (isStale(grid.updated_at)) {
      await supabase
        .from('grid_images')
        .update({ status: 'failed', error_message: 'Timed out (30 min)' })
        .eq('id', grid.id)
        .eq('request_id', grid.request_id)
        .eq('status', 'processing');
      summary.stale++;
      continue;
    }

    const job = await checkFalJob(
      FAL_GRID_IMAGE_ENDPOINT,
      grid.request_id,
      extractImageUrl
    );

    if (job.status === 'completed' && job.url) {
      await supabase
        .from('grid_images')
        .update({ status: 'generated', url: job.url })
        .eq('id', grid.id)
        .eq('request_id', grid.request_id)
        .eq('status', 'processing');

      const { data: sb } = await supabase
        .from('storyboards')
        .select('mode')
        .eq('id', grid.storyboard_id)
        .single();
      await updateStoryboardPlanStatus(supabase, grid.storyboard_id, sb?.mode);

      summary.completed++;
      log.success('Grid image completed via poll', { grid_image_id: grid.id });
    } else if (job.status === 'failed') {
      await supabase
        .from('grid_images')
        .update({ status: 'failed', error_message: 'fal.ai job failed' })
        .eq('id', grid.id)
        .eq('request_id', grid.request_id)
        .eq('status', 'processing');
      summary.failed++;
    } else if (job.status === 'completed' && !job.url) {
      await supabase
        .from('grid_images')
        .update({ status: 'failed', error_message: 'No image in fal result' })
        .eq('id', grid.id)
        .eq('request_id', grid.request_id)
        .eq('status', 'processing');
      summary.failed++;
    } else {
      summary.still_running++;
    }
  }

  return summary;
}

// ── Poll Scene Videos ───────────────────────────────────────────────

async function pollSceneVideos(
  supabase: SupabaseAdmin,
  storyboardId: string | null,
  log: ReturnType<typeof createLogger>
): Promise<ItemSummary> {
  const summary = newSummary();

  let query = supabase
    .from('scenes')
    .select('id, video_request_id, video_model, updated_at')
    .eq('video_status', 'processing')
    .not('video_request_id', 'is', null);

  if (storyboardId) query = query.eq('storyboard_id', storyboardId);

  const { data: items, error } = await query;
  if (error || !items) return summary;

  summary.processed = items.length;

  for (const scene of items) {
    const endpoint = resolveVideoEndpoint(scene.video_model);

    // SkyReels has its own poll endpoint
    if (!endpoint) {
      summary.still_running++;
      continue;
    }

    if (isStale(scene.updated_at)) {
      await supabase
        .from('scenes')
        .update({
          video_status: 'failed',
          video_error_message: 'Timed out (30 min)',
        })
        .eq('id', scene.id)
        .eq('video_request_id', scene.video_request_id)
        .eq('video_status', 'processing');
      summary.stale++;
      continue;
    }

    const job = await checkFalJob(
      endpoint,
      scene.video_request_id,
      extractVideoUrl
    );

    if (job.status === 'completed' && job.url) {
      await supabase
        .from('scenes')
        .update({ video_status: 'success', video_url: job.url })
        .eq('id', scene.id)
        .eq('video_request_id', scene.video_request_id)
        .eq('video_status', 'processing');
      summary.completed++;
      log.success('Scene video completed via poll', { scene_id: scene.id });
    } else if (job.status === 'failed') {
      await supabase
        .from('scenes')
        .update({
          video_status: 'failed',
          video_error_message: 'fal.ai job failed',
        })
        .eq('id', scene.id)
        .eq('video_request_id', scene.video_request_id)
        .eq('video_status', 'processing');
      summary.failed++;
    } else if (job.status === 'completed' && !job.url) {
      await supabase
        .from('scenes')
        .update({
          video_status: 'failed',
          video_error_message: 'No video in fal result',
        })
        .eq('id', scene.id)
        .eq('video_request_id', scene.video_request_id)
        .eq('video_status', 'processing');
      summary.failed++;
    } else {
      summary.still_running++;
    }
  }

  return summary;
}

// ── Poll First Frames (Image Editing) ───────────────────────────────

const EDIT_STATUSES = ['enhancing', 'editing', 'processing'];

async function pollFirstFrames(
  supabase: SupabaseAdmin,
  storyboardId: string | null,
  log: ReturnType<typeof createLogger>
): Promise<ItemSummary> {
  const summary = newSummary();

  let query = supabase
    .from('first_frames')
    .select('id, scene_id, image_edit_request_id, image_edit_model, updated_at')
    .in('image_edit_status', EDIT_STATUSES)
    .not('image_edit_request_id', 'is', null);

  if (storyboardId) {
    const { data: sceneIds } = await supabase
      .from('scenes')
      .select('id')
      .eq('storyboard_id', storyboardId);
    if (!sceneIds || sceneIds.length === 0) return summary;
    query = query.in(
      'scene_id',
      sceneIds.map((s: { id: string }) => s.id)
    );
  }

  const { data: items, error } = await query;
  if (error || !items) return summary;

  summary.processed = items.length;

  for (const frame of items) {
    if (isStale(frame.updated_at)) {
      await supabase
        .from('first_frames')
        .update({
          image_edit_status: 'failed',
          image_edit_error_message: 'Timed out (30 min)',
        })
        .eq('id', frame.id)
        .eq('image_edit_request_id', frame.image_edit_request_id)
        .in('image_edit_status', EDIT_STATUSES);
      summary.stale++;
      continue;
    }

    const endpoint = resolveImageEditEndpoint(frame.image_edit_model);
    const job = await checkFalJob(
      endpoint,
      frame.image_edit_request_id,
      extractImageUrl
    );

    if (job.status === 'completed' && job.url) {
      await supabase
        .from('first_frames')
        .update({
          image_edit_status: 'success',
          image_edit_error_message: null,
          final_url: job.url,
        })
        .eq('id', frame.id)
        .eq('image_edit_request_id', frame.image_edit_request_id)
        .in('image_edit_status', EDIT_STATUSES);
      summary.completed++;
      log.success('First frame edit completed via poll', {
        first_frame_id: frame.id,
      });
    } else if (job.status === 'failed') {
      await supabase
        .from('first_frames')
        .update({
          image_edit_status: 'failed',
          image_edit_error_message: 'fal.ai job failed',
        })
        .eq('id', frame.id)
        .eq('image_edit_request_id', frame.image_edit_request_id)
        .in('image_edit_status', EDIT_STATUSES);
      summary.failed++;
    } else if (job.status === 'completed' && !job.url) {
      await supabase
        .from('first_frames')
        .update({
          image_edit_status: 'failed',
          image_edit_error_message: 'No image in fal result',
        })
        .eq('id', frame.id)
        .eq('image_edit_request_id', frame.image_edit_request_id)
        .in('image_edit_status', EDIT_STATUSES);
      summary.failed++;
    } else {
      summary.still_running++;
    }
  }

  return summary;
}

// ── Main Handler ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const log = createLogger();
  log.setContext({ step: 'PollFal' });

  try {
    const authClient = await createClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const storyboardId: string | null = body.storyboard_id || null;

    log.info('Poll request', { storyboard_id: storyboardId, user_id: user.id });

    const supabase = createServiceClient();

    const [gridResult, sceneResult, frameResult] = await Promise.all([
      pollGridImages(supabase, storyboardId, log),
      pollSceneVideos(supabase, storyboardId, log),
      pollFirstFrames(supabase, storyboardId, log),
    ]);

    const totalCompleted =
      gridResult.completed + sceneResult.completed + frameResult.completed;
    const totalStillRunning =
      gridResult.still_running +
      sceneResult.still_running +
      frameResult.still_running;

    log.summary('success', {
      grid_images: gridResult,
      scenes: sceneResult,
      first_frames: frameResult,
    });

    return NextResponse.json({
      success: true,
      has_processing: totalStillRunning > 0,
      total_completed: totalCompleted,
      total_still_running: totalStillRunning,
      grid_images: gridResult,
      scenes: sceneResult,
      first_frames: frameResult,
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
