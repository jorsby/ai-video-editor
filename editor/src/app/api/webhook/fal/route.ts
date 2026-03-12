import type { NextRequest } from 'next/server';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger, type Logger } from '@/lib/logger';
import { config } from '@/lib/config';
import { R2StorageService } from '@/lib/r2';
import {
  getGridOutputDimensions,
  isGridAspectRatio,
  isGridResolution,
  type GridAspectRatio,
  type GridResolution,
} from '@/lib/grid-generation-settings';
import * as musicMetadata from 'music-metadata';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, x-client-info, apikey',
};

function createR2() {
  return new R2StorageService({
    bucketName: config.r2.bucket,
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
    accountId: config.r2.accountId,
    cdn: config.r2.cdn,
  });
}

async function normalizeAndUploadFirstFrame(
  sourceUrl: string,
  firstFrameId: string,
  aspectRatio: GridAspectRatio,
  resolution: GridResolution,
  log: Logger
): Promise<string> {
  const dimensions = getGridOutputDimensions(aspectRatio, resolution);
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch source image: ${response.status}`);
  }

  const sourceBuffer = Buffer.from(await response.arrayBuffer());
  const normalizedBuffer = await sharp(sourceBuffer)
    .resize(dimensions.width, dimensions.height, {
      fit: 'cover',
      position: 'centre',
    })
    .png()
    .toBuffer();

  const r2 = createR2();
  const key = `first-frames/normalized/${firstFrameId}_${aspectRatio.replace(':', 'x')}_${resolution}.png`;
  const url = await r2.uploadData(key, normalizedBuffer, 'image/png');

  log.info('First frame normalized and uploaded', {
    first_frame_id: firstFrameId,
    aspect_ratio: aspectRatio,
    resolution,
    width: dimensions.width,
    height: dimensions.height,
    normalized_url: url,
  });

  return url;
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

interface FalAudioOutput {
  url: string;
  content_type?: string;
  file_name?: string;
  file_size?: number;
}

interface FalWebhookPayload {
  status: 'OK' | 'ERROR';
  request_id?: string;
  error?: string;
  images?: Array<{ url: string }>;
  audio?: FalAudioOutput;
  video?: Array<{ url: string }> | { url: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputs?: any;
  payload?: {
    images?: Array<{ url: string }>;
    audio?: FalAudioOutput;
    video?: Array<{ url: string }> | { url: string };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outputs?: any;
    prompt?: string;
  };
}

// Helper to get images from various possible locations
function getImages(
  payload: FalWebhookPayload
): Array<{ url: string }> | undefined {
  const candidates = [
    payload.payload?.images,
    payload.images,
    payload.payload?.outputs?.images,
    payload.outputs?.images,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0 && candidate[0]?.url) {
      return candidate;
    }
  }

  // Check ComfyUI node outputs (keyed by node ID like "11", "12", etc.)
  const outputs = payload.payload?.outputs || payload.outputs;
  if (outputs && typeof outputs === 'object' && !Array.isArray(outputs)) {
    for (const nodeId of Object.keys(outputs)) {
      const nodeOutput = outputs[nodeId];
      if (
        nodeOutput?.images &&
        Array.isArray(nodeOutput.images) &&
        nodeOutput.images[0]?.url
      ) {
        return nodeOutput.images;
      }
    }
  }

  return undefined;
}

// Helper to get images from a specific ComfyUI node ID
function getImagesFromNode(
  payload: FalWebhookPayload,
  nodeId: string
): Array<{ url: string }> | undefined {
  const outputs = payload.payload?.outputs || payload.outputs;
  if (outputs && typeof outputs === 'object' && !Array.isArray(outputs)) {
    const nodeOutput = outputs[nodeId];
    if (
      nodeOutput?.images &&
      Array.isArray(nodeOutput.images) &&
      nodeOutput.images[0]?.url
    ) {
      return nodeOutput.images;
    }
  }
  return undefined;
}

// Helper to get videos from various possible locations
function getVideos(
  payload: FalWebhookPayload
): Array<{ url: string }> | undefined {
  const candidates = [
    payload.payload?.video,
    payload.video,
    payload.payload?.outputs?.video,
    payload.outputs?.video,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0 && candidate[0]?.url) {
      return candidate;
    }
    if (
      candidate &&
      !Array.isArray(candidate) &&
      (candidate as { url: string }).url
    ) {
      return [candidate as { url: string }];
    }
  }

  // Check ComfyUI node outputs
  const outputs = payload.payload?.outputs || payload.outputs;
  if (outputs && typeof outputs === 'object' && !Array.isArray(outputs)) {
    for (const nodeId of Object.keys(outputs)) {
      const nodeOutput = outputs[nodeId];
      if (nodeOutput?.video) {
        if (Array.isArray(nodeOutput.video) && nodeOutput.video[0]?.url) {
          return nodeOutput.video;
        }
        if (nodeOutput.video.url) {
          return [nodeOutput.video];
        }
      }
    }
  }

  return undefined;
}

// Helper to get audio from various possible locations
function getAudio(payload: FalWebhookPayload): FalAudioOutput | undefined {
  const candidates = [payload.payload?.audio, payload.audio];

  for (const candidate of candidates) {
    if (candidate?.url) {
      return candidate;
    }
  }

  return undefined;
}

function getIncomingRequestId(payload: FalWebhookPayload): string | null {
  const requestId = payload.request_id;
  if (typeof requestId !== 'string') return null;
  const trimmed = requestId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function staleWebhookResponse(
  reason: string,
  step: string,
  entityKey: string,
  entityId: string,
  log: Logger
): Response {
  log.warn('Ignoring stale webhook', {
    reason,
    step,
    [entityKey]: entityId,
  });

  return new Response(
    JSON.stringify({ success: true, ignored: true, reason }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

async function guardWebhookRequest(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  table: string;
  idColumn: string;
  id: string;
  statusColumn: string;
  requestIdColumn: string;
  allowedStatuses: string[];
  incomingRequestId: string | null;
  step: string;
  log: Logger;
}): Promise<
  { ok: true; requestId: string | null } | { ok: false; response: Response }
> {
  const {
    supabase,
    table,
    idColumn,
    id,
    statusColumn,
    requestIdColumn,
    allowedStatuses,
    incomingRequestId,
    step,
    log,
  } = params;

  const { data: row } = await supabase
    .from(table)
    .select(`${statusColumn}, ${requestIdColumn}`)
    .eq(idColumn, id)
    .maybeSingle();

  if (!row) {
    return {
      ok: false,
      response: staleWebhookResponse('row_missing', step, idColumn, id, log),
    };
  }

  const currentStatus =
    (row as Record<string, string | null | undefined>)[statusColumn] ?? null;
  const currentRequestId =
    (row as Record<string, string | null | undefined>)[requestIdColumn] ?? null;

  if (!allowedStatuses.includes(currentStatus ?? '')) {
    return {
      ok: false,
      response: staleWebhookResponse(
        'status_mismatch',
        step,
        idColumn,
        id,
        log
      ),
    };
  }

  if (
    incomingRequestId &&
    currentRequestId &&
    incomingRequestId !== currentRequestId
  ) {
    return {
      ok: false,
      response: staleWebhookResponse(
        'request_id_mismatch',
        step,
        idColumn,
        id,
        log
      ),
    };
  }

  if (!incomingRequestId && currentRequestId) {
    return {
      ok: false,
      response: staleWebhookResponse(
        'missing_request_id',
        step,
        idColumn,
        id,
        log
      ),
    };
  }

  return {
    ok: true,
    requestId: incomingRequestId ?? currentRequestId,
  };
}

// ── Step Handlers ─────────────────────────────────────────────────────

async function handleGenGridImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const grid_image_id = params.get('grid_image_id')!;
  const storyboard_id = params.get('storyboard_id')!;
  const rows = parseInt(params.get('rows') || '0', 10);
  const cols = parseInt(params.get('cols') || '0', 10);

  const incomingRequestId = getIncomingRequestId(falPayload);
  const guard = await guardWebhookRequest({
    supabase,
    table: 'grid_images',
    idColumn: 'id',
    id: grid_image_id,
    statusColumn: 'status',
    requestIdColumn: 'request_id',
    allowedStatuses: ['processing'],
    incomingRequestId,
    step: 'GenGridImage',
    log,
  });

  if (!guard.ok) {
    return guard.response;
  }

  log.info('Processing GenGridImage', {
    grid_image_id,
    fal_status: falPayload.status,
    request_id: guard.requestId,
  });

  // Fetch storyboard mode early
  const { data: storyboard } = await supabase
    .from('storyboards')
    .select('mode')
    .eq('id', storyboard_id)
    .single();

  log.startTiming('extract_images');
  const images = getImages(falPayload);
  const extractTime = log.endTiming('extract_images');

  const imageSource = images
    ? falPayload.payload?.images
      ? 'payload.images'
      : falPayload.images
        ? 'root.images'
        : 'outputs'
    : 'none';

  log.info('Image extraction', {
    source: imageSource,
    count: images?.length || 0,
    time_ms: extractTime,
  });

  if (falPayload.status === 'ERROR' || !images?.[0]?.url) {
    log.error('Grid image generation failed', {
      fal_error: falPayload.error,
      has_images: !!images,
    });

    log.startTiming('db_update_failed');
    let failUpdate = supabase
      .from('grid_images')
      .update({ status: 'failed', error_message: 'generation_error' })
      .eq('id', grid_image_id)
      .eq('status', 'processing');

    if (guard.requestId) {
      failUpdate = failUpdate.eq('request_id', guard.requestId);
    }

    const { data: failedRows } = await failUpdate.select('id');

    if (!failedRows || failedRows.length === 0) {
      return staleWebhookResponse(
        'state_changed_before_update',
        'GenGridImage',
        'grid_image_id',
        grid_image_id,
        log
      );
    }

    log.db('UPDATE', 'grid_images', {
      id: grid_image_id,
      status: 'failed',
      time_ms: log.endTiming('db_update_failed'),
    });

    if (storyboard?.mode === 'ref_to_video') {
      const { data: pendingGrids } = await supabase
        .from('grid_images')
        .select('id')
        .eq('storyboard_id', storyboard_id)
        .in('status', ['pending', 'processing']);

      if (!pendingGrids || pendingGrids.length === 0) {
        await supabase
          .from('storyboards')
          .update({ plan_status: 'failed' })
          .eq('id', storyboard_id)
          .eq('plan_status', 'generating');
      }
    }

    log.summary('error', { grid_image_id, reason: 'generation_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'Generation failed' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const gridImageUrl = images[0].url;
  const prompt = falPayload.payload?.prompt;

  log.success('Grid image generated', {
    url: gridImageUrl,
    has_prompt: !!prompt,
  });

  const isRefGrid = storyboard?.mode === 'ref_to_video';
  const dimensionsInvalid = isRefGrid
    ? rows < 2 || cols < 2 || rows > 6 || cols > 6
    : rows < 2 || cols < 2 || (rows !== cols && rows !== cols + 1);

  if (dimensionsInvalid) {
    log.error('Invalid grid dimensions from params', { rows, cols, isRefGrid });

    let invalidUpdate = supabase
      .from('grid_images')
      .update({
        status: 'failed',
        url: gridImageUrl,
        error_message: `Invalid grid dimensions: ${rows}x${cols}`,
      })
      .eq('id', grid_image_id)
      .eq('status', 'processing');

    if (guard.requestId) {
      invalidUpdate = invalidUpdate.eq('request_id', guard.requestId);
    }

    const { data: invalidRows } = await invalidUpdate.select('id');

    if (!invalidRows || invalidRows.length === 0) {
      return staleWebhookResponse(
        'state_changed_before_update',
        'GenGridImage',
        'grid_image_id',
        grid_image_id,
        log
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Invalid grid dimensions' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  log.info('Grid dimensions from plan', { rows, cols });

  log.startTiming('db_update_generated');
  let generatedUpdate = supabase
    .from('grid_images')
    .update({ status: 'generated', url: gridImageUrl })
    .eq('id', grid_image_id)
    .eq('status', 'processing');

  if (guard.requestId) {
    generatedUpdate = generatedUpdate.eq('request_id', guard.requestId);
  }

  const { data: generatedRows } = await generatedUpdate.select('id');

  if (!generatedRows || generatedRows.length === 0) {
    return staleWebhookResponse(
      'state_changed_before_update',
      'GenGridImage',
      'grid_image_id',
      grid_image_id,
      log
    );
  }

  log.db('UPDATE', 'grid_images', {
    id: grid_image_id,
    status: 'generated',
    rows,
    cols,
    time_ms: log.endTiming('db_update_generated'),
  });

  log.startTiming('db_update_plan_status');

  if (storyboard?.mode === 'ref_to_video') {
    const { data: pendingGrids } = await supabase
      .from('grid_images')
      .select('id')
      .eq('storyboard_id', storyboard_id)
      .in('status', ['pending', 'processing']);

    if (!pendingGrids || pendingGrids.length === 0) {
      const { data: failedGrids } = await supabase
        .from('grid_images')
        .select('id')
        .eq('storyboard_id', storyboard_id)
        .eq('status', 'failed');

      if (failedGrids && failedGrids.length > 0) {
        await supabase
          .from('storyboards')
          .update({ plan_status: 'failed' })
          .eq('id', storyboard_id)
          .eq('plan_status', 'generating');
        log.db('UPDATE', 'storyboards', {
          id: storyboard_id,
          plan_status: 'failed',
          reason: 'some_grids_failed',
          time_ms: log.endTiming('db_update_plan_status'),
        });
      } else {
        await supabase
          .from('storyboards')
          .update({ plan_status: 'grid_ready' })
          .eq('id', storyboard_id)
          .eq('plan_status', 'generating');
        log.db('UPDATE', 'storyboards', {
          id: storyboard_id,
          plan_status: 'grid_ready',
          time_ms: log.endTiming('db_update_plan_status'),
        });
      }
    } else {
      log.info('Waiting for other grids', {
        pending_count: pendingGrids.length,
        time_ms: log.endTiming('db_update_plan_status'),
      });
    }
  } else {
    await supabase
      .from('storyboards')
      .update({ plan_status: 'grid_ready' })
      .eq('id', storyboard_id);
    log.db('UPDATE', 'storyboards', {
      id: storyboard_id,
      plan_status: 'grid_ready',
      time_ms: log.endTiming('db_update_plan_status'),
    });
  }

  log.summary('success', { grid_image_id, next_step: 'AwaitingUserReview' });
  return new Response(JSON.stringify({ success: true, step: 'GenGridImage' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleSplitGridImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const grid_image_id = params.get('grid_image_id')!;
  const storyboard_id = params.get('storyboard_id')!;

  const incomingRequestId = getIncomingRequestId(falPayload);
  const guard = await guardWebhookRequest({
    supabase,
    table: 'grid_images',
    idColumn: 'id',
    id: grid_image_id,
    statusColumn: 'status',
    requestIdColumn: 'request_id',
    allowedStatuses: ['processing'],
    incomingRequestId,
    step: 'SplitGridImage',
    log,
  });

  if (!guard.ok) {
    return guard.response;
  }

  log.info('Processing SplitGridImage', {
    grid_image_id,
    storyboard_id,
    fal_status: falPayload.status,
    request_id: guard.requestId,
  });

  const { data: gridImage } = await supabase
    .from('grid_images')
    .select('type')
    .eq('id', grid_image_id)
    .single();

  const gridType = gridImage?.type || 'scene';
  log.info('Grid type', { type: gridType });

  log.startTiming('extract_node_images');
  const urlImages = getImagesFromNode(falPayload, '30');
  const outPaddedImages = getImagesFromNode(falPayload, '11');

  log.info('Node images extracted', {
    node_30_count: urlImages?.length || 0,
    node_11_count: outPaddedImages?.length || 0,
    time_ms: log.endTiming('extract_node_images'),
  });

  if (falPayload.status === 'ERROR' || (!urlImages && !outPaddedImages)) {
    log.error('Grid split failed', {
      fal_error: falPayload.error,
      has_node_30: !!urlImages,
      has_node_11: !!outPaddedImages,
    });

    if (gridType === 'objects') {
      await supabase
        .from('objects')
        .update({ status: 'failed' })
        .eq('grid_image_id', grid_image_id);
    } else if (gridType === 'backgrounds') {
      await supabase
        .from('backgrounds')
        .update({ status: 'failed' })
        .eq('grid_image_id', grid_image_id);
    } else {
      const { data: scenes } = await supabase
        .from('scenes')
        .select('id')
        .eq('storyboard_id', storyboard_id);
      if (scenes) {
        for (const scene of scenes) {
          await supabase
            .from('first_frames')
            .update({ status: 'failed', error_message: 'split_error' })
            .eq('scene_id', scene.id);
        }
      }
    }

    log.summary('error', { grid_image_id, gridType, reason: 'split_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'Split failed' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (gridType === 'objects') {
    return await handleObjectsSplit(
      supabase,
      grid_image_id,
      storyboard_id,
      urlImages!,
      log
    );
  } else if (gridType === 'backgrounds') {
    return await handleBackgroundsSplit(
      supabase,
      grid_image_id,
      storyboard_id,
      urlImages!,
      log
    );
  } else {
    return await handleSceneSplit(
      supabase,
      grid_image_id,
      storyboard_id,
      urlImages,
      outPaddedImages,
      log
    );
  }
}

async function handleSceneSplit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  grid_image_id: string,
  storyboard_id: string,
  urlImages: Array<{ url: string }> | undefined,
  outPaddedImages: Array<{ url: string }> | undefined,
  log: Logger
): Promise<Response> {
  log.startTiming('fetch_scenes');
  const { data: scenes, error: scenesError } = await supabase
    .from('scenes')
    .select(`id, order, first_frames (id)`)
    .eq('storyboard_id', storyboard_id)
    .order('order', { ascending: true });

  log.db('SELECT', 'scenes', {
    storyboard_id,
    count: scenes?.length || 0,
    time_ms: log.endTiming('fetch_scenes'),
  });

  if (scenesError || !scenes) {
    log.error('Failed to fetch scenes', { error: scenesError?.message });
    log.summary('error', { grid_image_id, reason: 'scenes_fetch_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to fetch scenes' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  log.info('Updating first_frames', {
    scenes_count: scenes.length,
    url_images: urlImages?.length || 0,
    padded_images: outPaddedImages?.length || 0,
  });

  log.startTiming('update_first_frames');
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const firstFrame = (
      scene.first_frames as unknown as Array<{ id: string }>
    )?.[0];

    if (!firstFrame) {
      log.warn('No first_frame for scene', {
        scene_id: scene.id,
        order: scene.order,
      });
      failCount++;
      continue;
    }

    const imageUrl = urlImages?.[i]?.url || null;
    const outPaddedUrl = outPaddedImages?.[i]?.url || null;
    const status = imageUrl || outPaddedUrl ? 'success' : 'failed';

    await supabase
      .from('first_frames')
      .update({
        url: imageUrl,
        out_padded_url: outPaddedUrl,
        grid_image_id,
        status,
        error_message: status === 'failed' ? 'split_error' : null,
      })
      .eq('id', firstFrame.id);

    if (status === 'success') successCount++;
    else failCount++;
  }

  log.success('first_frames updated', {
    success: successCount,
    failed: failCount,
    time_ms: log.endTiming('update_first_frames'),
  });

  log.summary('success', {
    grid_image_id,
    scenes_updated: scenes.length,
    success_count: successCount,
    fail_count: failCount,
  });

  return new Response(
    JSON.stringify({
      success: true,
      step: 'SplitGridImage',
      scenes_updated: scenes.length,
    }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

async function handleObjectsSplit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  grid_image_id: string,
  storyboard_id: string,
  urlImages: Array<{ url: string }>,
  log: Logger
): Promise<Response> {
  log.startTiming('update_objects');
  let successCount = 0;

  for (let i = 0; i < urlImages.length; i++) {
    const imageUrl = urlImages[i]?.url || null;
    const status = imageUrl ? 'success' : 'failed';

    const { count } = await supabase
      .from('objects')
      .update({ url: imageUrl, final_url: imageUrl, status })
      .eq('grid_image_id', grid_image_id)
      .eq('grid_position', i);

    if (status === 'success') successCount++;
    log.info('Objects updated for grid position', {
      grid_position: i,
      status,
      rows_updated: count,
    });
  }

  log.success('Objects updated', {
    grid_positions: urlImages.length,
    success: successCount,
    time_ms: log.endTiming('update_objects'),
  });

  await tryCompleteSplitting(supabase, storyboard_id, log);

  return new Response(
    JSON.stringify({ success: true, step: 'SplitGridImage', type: 'objects' }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

async function handleBackgroundsSplit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  grid_image_id: string,
  storyboard_id: string,
  urlImages: Array<{ url: string }>,
  log: Logger
): Promise<Response> {
  log.startTiming('update_backgrounds');
  let successCount = 0;

  for (let i = 0; i < urlImages.length; i++) {
    const imageUrl = urlImages[i]?.url || null;
    const status = imageUrl ? 'success' : 'failed';

    const { count } = await supabase
      .from('backgrounds')
      .update({ url: imageUrl, final_url: imageUrl, status })
      .eq('grid_image_id', grid_image_id)
      .eq('grid_position', i);

    if (status === 'success') successCount++;
    log.info('Backgrounds updated for grid position', {
      grid_position: i,
      status,
      rows_updated: count,
    });
  }

  log.success('Backgrounds updated', {
    grid_positions: urlImages.length,
    success: successCount,
    time_ms: log.endTiming('update_backgrounds'),
  });

  await tryCompleteSplitting(supabase, storyboard_id, log);

  return new Response(
    JSON.stringify({
      success: true,
      step: 'SplitGridImage',
      type: 'backgrounds',
    }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

// Race-condition-safe: check if all splits are done and mark approved
async function tryCompleteSplitting(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  storyboard_id: string,
  log: Logger
): Promise<void> {
  const { data: gridImages } = await supabase
    .from('grid_images')
    .select('id, type')
    .eq('storyboard_id', storyboard_id)
    .in('type', ['objects', 'backgrounds']);

  const objectsGridId = gridImages?.find(
    (g: { id: string; type: string }) => g.type === 'objects'
  )?.id;
  const backgroundsGridId = gridImages?.find(
    (g: { id: string; type: string }) => g.type === 'backgrounds'
  )?.id;

  if (!objectsGridId || !backgroundsGridId) {
    log.info('Grid images not found yet, skipping', {
      objects_grid: objectsGridId,
      backgrounds_grid: backgroundsGridId,
    });
    return;
  }

  const { data: pendingObjects } = await supabase
    .from('objects')
    .select('id')
    .eq('grid_image_id', objectsGridId)
    .neq('status', 'success');

  const { data: pendingBackgrounds } = await supabase
    .from('backgrounds')
    .select('id')
    .eq('grid_image_id', backgroundsGridId)
    .neq('status', 'success');

  if (
    (pendingObjects && pendingObjects.length > 0) ||
    (pendingBackgrounds && pendingBackgrounds.length > 0)
  ) {
    log.info('Splits not complete yet', {
      pending_objects: pendingObjects?.length || 0,
      pending_backgrounds: pendingBackgrounds?.length || 0,
    });
    return;
  }

  // Atomic gate: claim splitting -> approved (only one webhook wins)
  const { data: claimed, error: claimError } = await supabase
    .from('storyboards')
    .update({ plan_status: 'approved' })
    .eq('id', storyboard_id)
    .eq('plan_status', 'splitting')
    .select('id');

  if (claimError || !claimed || claimed.length === 0) {
    log.info(
      'Another webhook already completed splitting or not in splitting state'
    );
    return;
  }

  log.success('All splits complete, storyboard approved', { storyboard_id });
}

async function handleOutpaintImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const first_frame_id = params.get('first_frame_id');
  const background_id = params.get('background_id');
  const object_id = params.get('object_id');

  const isObject = !!object_id;
  const isBackground = !!background_id;
  const entityId = (
    isObject ? object_id : isBackground ? background_id : first_frame_id
  )!;

  if (!entityId) {
    return new Response(
      JSON.stringify({ success: false, error: 'Missing target id' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const tableName = isObject
    ? 'objects'
    : isBackground
      ? 'backgrounds'
      : 'first_frames';
  const entityKey = isObject
    ? 'object_id'
    : isBackground
      ? 'background_id'
      : 'first_frame_id';
  const allowedEditStatuses = ['outpainting', 'processing'];

  const incomingRequestId = getIncomingRequestId(falPayload);
  const guard = await guardWebhookRequest({
    supabase,
    table: tableName,
    idColumn: 'id',
    id: entityId,
    statusColumn: 'image_edit_status',
    requestIdColumn: 'image_edit_request_id',
    allowedStatuses: allowedEditStatuses,
    incomingRequestId,
    step: 'OutpaintImage',
    log,
  });

  if (!guard.ok) {
    return guard.response;
  }

  log.info('Processing OutpaintImage', {
    [entityKey]: entityId,
    source: tableName,
    fal_status: falPayload.status,
    request_id: guard.requestId,
  });

  log.startTiming('extract_images');
  const images = getImages(falPayload);
  log.endTiming('extract_images');

  if (falPayload.status === 'ERROR' || !images?.[0]?.url) {
    log.error('Image outpaint failed', { fal_error: falPayload.error });

    let failedUpdate = supabase
      .from(tableName)
      .update({
        image_edit_status: 'failed',
        image_edit_error_message: 'generation_error',
      })
      .eq('id', entityId)
      .in('image_edit_status', allowedEditStatuses);

    if (guard.requestId) {
      failedUpdate = failedUpdate.eq('image_edit_request_id', guard.requestId);
    }

    const { data: failedRows } = await failedUpdate.select('id');

    if (!failedRows || failedRows.length === 0) {
      return staleWebhookResponse(
        'state_changed_before_update',
        'OutpaintImage',
        entityKey,
        entityId,
        log
      );
    }

    log.summary('error', { [entityKey]: entityId, reason: 'outpaint_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'Outpaint failed' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const finalUrl = images[0].url;
  log.success('Image outpainted', { final_url: finalUrl });

  const successPayload =
    tableName === 'first_frames'
      ? {
          image_edit_status: 'success',
          image_edit_error_message: null,
          outpainted_url: finalUrl,
          final_url: finalUrl,
        }
      : {
          image_edit_status: 'success',
          image_edit_error_message: null,
          final_url: finalUrl,
        };

  let successUpdate = supabase
    .from(tableName)
    .update(successPayload)
    .eq('id', entityId)
    .in('image_edit_status', allowedEditStatuses);

  if (guard.requestId) {
    successUpdate = successUpdate.eq('image_edit_request_id', guard.requestId);
  }

  const { data: successRows } = await successUpdate.select('id');

  if (!successRows || successRows.length === 0) {
    return staleWebhookResponse(
      'state_changed_before_update',
      'OutpaintImage',
      entityKey,
      entityId,
      log
    );
  }

  log.summary('success', { [entityKey]: entityId, final_url: finalUrl });
  return new Response(
    JSON.stringify({
      success: true,
      step: 'OutpaintImage',
      [entityKey]: entityId,
      final_url: finalUrl,
    }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

async function handleEnhanceImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const first_frame_id = params.get('first_frame_id');
  const background_id = params.get('background_id');
  const object_id = params.get('object_id');
  const rawAspectRatio = params.get('aspect_ratio');
  const rawResolution = params.get('resolution');
  const targetAspectRatio = isGridAspectRatio(rawAspectRatio)
    ? rawAspectRatio
    : null;
  const targetResolution = isGridResolution(rawResolution)
    ? rawResolution
    : null;

  const isObject = !!object_id;
  const isBackground = !!background_id;
  const entityId = (
    isObject ? object_id : isBackground ? background_id : first_frame_id
  )!;
  const entityKey = isObject
    ? 'object_id'
    : isBackground
      ? 'background_id'
      : 'first_frame_id';
  const incomingRequestId = getIncomingRequestId(falPayload);
  const allowedEditStatuses = ['enhancing', 'editing', 'processing'];

  log.info('Processing EnhanceImage', {
    [entityKey]: entityId,
    source: isObject
      ? 'objects'
      : isBackground
        ? 'backgrounds'
        : 'first_frames',
    fal_status: falPayload.status,
    request_id: incomingRequestId,
    target_aspect_ratio: targetAspectRatio,
    target_resolution: targetResolution,
  });

  log.startTiming('extract_images');
  const images = getImages(falPayload);
  log.endTiming('extract_images');

  // --- Object path: update all siblings by grid_image_id + grid_position ---
  if (isObject) {
    const { data: obj, error: objError } = await supabase
      .from('objects')
      .select(
        'id, grid_image_id, grid_position, image_edit_status, image_edit_request_id'
      )
      .eq('id', object_id!)
      .single();

    if (objError || !obj) {
      log.error('Failed to fetch object for sibling update', {
        object_id,
        error: objError?.message,
      });
      return new Response(
        JSON.stringify({ success: false, error: 'Object not found' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const objectStatus = obj.image_edit_status as string | null;
    const objectRequestId = obj.image_edit_request_id as string | null;

    if (!allowedEditStatuses.includes(objectStatus || '')) {
      return staleWebhookResponse(
        'status_mismatch',
        'EnhanceImage',
        'object_id',
        object_id!,
        log
      );
    }

    if (
      incomingRequestId &&
      objectRequestId &&
      incomingRequestId !== objectRequestId
    ) {
      return staleWebhookResponse(
        'request_id_mismatch',
        'EnhanceImage',
        'object_id',
        object_id!,
        log
      );
    }

    if (!incomingRequestId && objectRequestId) {
      return staleWebhookResponse(
        'missing_request_id',
        'EnhanceImage',
        'object_id',
        object_id!,
        log
      );
    }

    const requestIdForFilter = incomingRequestId ?? objectRequestId ?? null;

    const siblingFilter = {
      grid_image_id: obj.grid_image_id,
      grid_position: obj.grid_position,
    };

    if (falPayload.status === 'ERROR' || !images?.[0]?.url) {
      log.error('Object enhance failed', { fal_error: falPayload.error });

      let failedUpdate = supabase
        .from('objects')
        .update({
          image_edit_status: 'failed',
          image_edit_error_message: 'generation_error',
        })
        .eq('grid_image_id', siblingFilter.grid_image_id)
        .eq('grid_position', siblingFilter.grid_position)
        .in('image_edit_status', allowedEditStatuses);

      if (requestIdForFilter) {
        failedUpdate = failedUpdate.eq(
          'image_edit_request_id',
          requestIdForFilter
        );
      }

      const { data: failedRows } = await failedUpdate.select('id');

      if (!failedRows || failedRows.length === 0) {
        return staleWebhookResponse(
          'state_changed_before_update',
          'EnhanceImage',
          'object_id',
          object_id!,
          log
        );
      }

      log.summary('error', { object_id, reason: 'enhance_failed' });
      return new Response(
        JSON.stringify({ success: false, error: 'Object enhance failed' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const finalUrl = images[0].url;
    log.success('Object enhanced', { final_url: finalUrl });

    let successUpdate = supabase
      .from('objects')
      .update({
        image_edit_status: 'success',
        image_edit_error_message: null,
        final_url: finalUrl,
      })
      .eq('grid_image_id', siblingFilter.grid_image_id)
      .eq('grid_position', siblingFilter.grid_position)
      .in('image_edit_status', allowedEditStatuses);

    if (requestIdForFilter) {
      successUpdate = successUpdate.eq(
        'image_edit_request_id',
        requestIdForFilter
      );
    }

    const { data: successRows } = await successUpdate.select('id');

    if (!successRows || successRows.length === 0) {
      return staleWebhookResponse(
        'state_changed_before_update',
        'EnhanceImage',
        'object_id',
        object_id!,
        log
      );
    }

    log.summary('success', { object_id, final_url: finalUrl });
    return new Response(
      JSON.stringify({
        success: true,
        step: 'EnhanceImage',
        object_id,
        final_url: finalUrl,
      }),
      { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  // --- Background / first_frame path ---
  const tableName = isBackground ? 'backgrounds' : 'first_frames';

  const guard = await guardWebhookRequest({
    supabase,
    table: tableName,
    idColumn: 'id',
    id: entityId,
    statusColumn: 'image_edit_status',
    requestIdColumn: 'image_edit_request_id',
    allowedStatuses: allowedEditStatuses,
    incomingRequestId,
    step: 'EnhanceImage',
    log,
  });

  if (!guard.ok) {
    return guard.response;
  }

  if (falPayload.status === 'ERROR' || !images?.[0]?.url) {
    log.error('Image enhance failed', { fal_error: falPayload.error });

    let failedUpdate = supabase
      .from(tableName)
      .update({
        image_edit_status: 'failed',
        image_edit_error_message: 'generation_error',
      })
      .eq('id', entityId)
      .in('image_edit_status', allowedEditStatuses);

    if (guard.requestId) {
      failedUpdate = failedUpdate.eq('image_edit_request_id', guard.requestId);
    }

    const { data: failedRows } = await failedUpdate.select('id');

    if (!failedRows || failedRows.length === 0) {
      return staleWebhookResponse(
        'state_changed_before_update',
        'EnhanceImage',
        entityKey,
        entityId,
        log
      );
    }

    log.summary('error', { [entityKey]: entityId, reason: 'enhance_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'Enhance failed' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const sourceFinalUrl = images[0].url;
  let finalUrl = sourceFinalUrl;

  if (
    tableName === 'first_frames' &&
    targetAspectRatio &&
    targetResolution &&
    first_frame_id
  ) {
    try {
      finalUrl = await normalizeAndUploadFirstFrame(
        sourceFinalUrl,
        first_frame_id,
        targetAspectRatio,
        targetResolution,
        log
      );
    } catch (normalizeError) {
      log.warn('First frame normalization failed, using source image', {
        first_frame_id,
        error:
          normalizeError instanceof Error
            ? normalizeError.message
            : String(normalizeError),
      });
      finalUrl = sourceFinalUrl;
    }
  }

  log.success('Image enhanced', {
    final_url: finalUrl,
    source_final_url: sourceFinalUrl,
  });

  let successUpdate = supabase
    .from(tableName)
    .update({
      image_edit_status: 'success',
      image_edit_error_message: null,
      final_url: finalUrl,
    })
    .eq('id', entityId)
    .in('image_edit_status', allowedEditStatuses);

  if (guard.requestId) {
    successUpdate = successUpdate.eq('image_edit_request_id', guard.requestId);
  }

  const { data: successRows } = await successUpdate.select('id');

  if (!successRows || successRows.length === 0) {
    return staleWebhookResponse(
      'state_changed_before_update',
      'EnhanceImage',
      entityKey,
      entityId,
      log
    );
  }

  log.summary('success', { [entityKey]: entityId, final_url: finalUrl });
  return new Response(
    JSON.stringify({
      success: true,
      step: 'EnhanceImage',
      [entityKey]: entityId,
      final_url: finalUrl,
    }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

async function handleGenerateTTS(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const voiceover_id = params.get('voiceover_id')!;
  const incomingRequestId = getIncomingRequestId(falPayload);
  const guard = await guardWebhookRequest({
    supabase,
    table: 'voiceovers',
    idColumn: 'id',
    id: voiceover_id,
    statusColumn: 'status',
    requestIdColumn: 'request_id',
    allowedStatuses: ['processing'],
    incomingRequestId,
    step: 'GenerateTTS',
    log,
  });

  if (!guard.ok) {
    return guard.response;
  }

  log.info('Processing GenerateTTS', {
    voiceover_id,
    fal_status: falPayload.status,
    request_id: guard.requestId,
  });

  log.startTiming('extract_audio');
  const audio = getAudio(falPayload);
  log.endTiming('extract_audio');

  if (falPayload.status === 'ERROR' || !audio?.url) {
    log.error('TTS generation failed', { fal_error: falPayload.error });

    let failedUpdate = supabase
      .from('voiceovers')
      .update({ status: 'failed', error_message: 'generation_error' })
      .eq('id', voiceover_id)
      .eq('status', 'processing');

    if (guard.requestId) {
      failedUpdate = failedUpdate.eq('request_id', guard.requestId);
    }

    const { data: failedRows } = await failedUpdate.select('id');

    if (!failedRows || failedRows.length === 0) {
      return staleWebhookResponse(
        'state_changed_before_update',
        'GenerateTTS',
        'voiceover_id',
        voiceover_id,
        log
      );
    }

    log.summary('error', { voiceover_id, reason: 'generation_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'TTS generation failed' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const audioUrl = audio.url;
  log.success('TTS audio generated', {
    url: audioUrl,
    content_type: audio.content_type,
    file_size: audio.file_size,
  });

  // Fetch and decode audio to get duration
  let duration: number | null = null;
  try {
    log.startTiming('calculate_duration');
    const audioResponse = await fetch(audioUrl);
    const arrayBuffer = await audioResponse.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const metadata = await musicMetadata.parseBuffer(uint8Array);
    duration = metadata.format.duration ?? null;
    log.info('Audio duration calculated', {
      duration,
      format: metadata.format.codec,
      time_ms: log.endTiming('calculate_duration'),
    });
  } catch (err) {
    log.error('Failed to calculate audio duration', {
      error: err instanceof Error ? err.message : String(err),
      time_ms: log.endTiming('calculate_duration'),
    });

    let durationFailedUpdate = supabase
      .from('voiceovers')
      .update({ status: 'failed', error_message: 'duration_error' })
      .eq('id', voiceover_id)
      .eq('status', 'processing');

    if (guard.requestId) {
      durationFailedUpdate = durationFailedUpdate.eq(
        'request_id',
        guard.requestId
      );
    }

    await durationFailedUpdate;

    log.summary('error', {
      voiceover_id,
      reason: 'duration_calculation_failed',
    });
    return new Response(
      JSON.stringify({ success: false, error: 'Duration calculation failed' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let successUpdate = supabase
    .from('voiceovers')
    .update({ status: 'success', audio_url: audioUrl, duration })
    .eq('id', voiceover_id)
    .eq('status', 'processing');

  if (guard.requestId) {
    successUpdate = successUpdate.eq('request_id', guard.requestId);
  }

  const { data: successRows } = await successUpdate.select('id');

  if (!successRows || successRows.length === 0) {
    return staleWebhookResponse(
      'state_changed_before_update',
      'GenerateTTS',
      'voiceover_id',
      voiceover_id,
      log
    );
  }

  log.summary('success', { voiceover_id, audio_url: audioUrl, duration });
  return new Response(
    JSON.stringify({
      success: true,
      step: 'GenerateTTS',
      voiceover_id,
      duration,
    }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

async function handleGenerateVideo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const scene_id = params.get('scene_id')!;
  const incomingRequestId = getIncomingRequestId(falPayload);
  const guard = await guardWebhookRequest({
    supabase,
    table: 'scenes',
    idColumn: 'id',
    id: scene_id,
    statusColumn: 'video_status',
    requestIdColumn: 'video_request_id',
    allowedStatuses: ['processing'],
    incomingRequestId,
    step: 'GenerateVideo',
    log,
  });

  if (!guard.ok) {
    return guard.response;
  }

  log.info('Processing GenerateVideo', {
    scene_id,
    fal_status: falPayload.status,
    request_id: guard.requestId,
  });

  log.startTiming('extract_videos');
  const videos = getVideos(falPayload);
  log.endTiming('extract_videos');

  if (falPayload.status === 'ERROR' || !videos?.[0]?.url) {
    log.error('Video generation failed', { fal_error: falPayload.error });

    let failedUpdate = supabase
      .from('scenes')
      .update({
        video_status: 'failed',
        video_error_message: 'generation_error',
      })
      .eq('id', scene_id)
      .eq('video_status', 'processing');

    if (guard.requestId) {
      failedUpdate = failedUpdate.eq('video_request_id', guard.requestId);
    }

    const { data: failedRows } = await failedUpdate.select('id');

    if (!failedRows || failedRows.length === 0) {
      return staleWebhookResponse(
        'state_changed_before_update',
        'GenerateVideo',
        'scene_id',
        scene_id,
        log
      );
    }

    log.summary('error', { scene_id, reason: 'generation_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'Video generation failed' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const videoUrl = videos[0].url;
  log.success('Video generated', { video_url: videoUrl });

  let successUpdate = supabase
    .from('scenes')
    .update({ video_status: 'success', video_url: videoUrl })
    .eq('id', scene_id)
    .eq('video_status', 'processing');

  if (guard.requestId) {
    successUpdate = successUpdate.eq('video_request_id', guard.requestId);
  }

  const { data: successRows } = await successUpdate.select('id');

  if (!successRows || successRows.length === 0) {
    return staleWebhookResponse(
      'state_changed_before_update',
      'GenerateVideo',
      'scene_id',
      scene_id,
      log
    );
  }

  log.summary('success', { scene_id, video_url: videoUrl });
  return new Response(
    JSON.stringify({
      success: true,
      step: 'GenerateVideo',
      scene_id,
      video_url: videoUrl,
    }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

async function handleGenerateSFX(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const scene_id = params.get('scene_id')!;
  const incomingRequestId = getIncomingRequestId(falPayload);
  const guard = await guardWebhookRequest({
    supabase,
    table: 'scenes',
    idColumn: 'id',
    id: scene_id,
    statusColumn: 'sfx_status',
    requestIdColumn: 'sfx_request_id',
    allowedStatuses: ['processing'],
    incomingRequestId,
    step: 'GenerateSFX',
    log,
  });

  if (!guard.ok) {
    return guard.response;
  }

  log.info('Processing GenerateSFX', {
    scene_id,
    fal_status: falPayload.status,
    request_id: guard.requestId,
  });

  log.startTiming('extract_videos');
  const videos = getVideos(falPayload);
  log.endTiming('extract_videos');

  if (falPayload.status === 'ERROR' || !videos?.[0]?.url) {
    log.error('SFX generation failed', { fal_error: falPayload.error });

    let failedUpdate = supabase
      .from('scenes')
      .update({ sfx_status: 'failed', sfx_error_message: 'generation_error' })
      .eq('id', scene_id)
      .eq('sfx_status', 'processing');

    if (guard.requestId) {
      failedUpdate = failedUpdate.eq('sfx_request_id', guard.requestId);
    }

    const { data: failedRows } = await failedUpdate.select('id');

    if (!failedRows || failedRows.length === 0) {
      return staleWebhookResponse(
        'state_changed_before_update',
        'GenerateSFX',
        'scene_id',
        scene_id,
        log
      );
    }

    log.summary('error', { scene_id, reason: 'sfx_generation_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'SFX generation failed' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const videoUrl = videos[0].url;
  log.success('SFX generated', { video_url: videoUrl });

  let successUpdate = supabase
    .from('scenes')
    .update({ sfx_status: 'success', video_url: videoUrl })
    .eq('id', scene_id)
    .eq('sfx_status', 'processing');

  if (guard.requestId) {
    successUpdate = successUpdate.eq('sfx_request_id', guard.requestId);
  }

  const { data: successRows } = await successUpdate.select('id');

  if (!successRows || successRows.length === 0) {
    return staleWebhookResponse(
      'state_changed_before_update',
      'GenerateSFX',
      'scene_id',
      scene_id,
      log
    );
  }

  log.summary('success', { scene_id, video_url: videoUrl });
  return new Response(
    JSON.stringify({
      success: true,
      step: 'GenerateSFX',
      scene_id,
      video_url: videoUrl,
    }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

// ── Main Handler ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const log = createLogger();

  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    const step = params.get('step');

    log.setContext({ step: step || 'Unknown' });

    log.info('Webhook received', {
      step,
      params: Object.fromEntries(params),
    });

    if (!step) {
      log.error('Missing step parameter');
      return new Response(
        JSON.stringify({ success: false, error: 'Missing step parameter' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        }
      );
    }

    log.startTiming('parse_payload');
    const falPayload = await req.json();
    log.info('Payload parsed', {
      fal_status: falPayload.status,
      has_images: !!falPayload.images || !!falPayload.payload?.images,
      request_id: falPayload.request_id,
      time_ms: log.endTiming('parse_payload'),
    });

    const supabase = createServiceClient();

    // Store raw payload for debugging
    log.startTiming('debug_log_insert');
    await supabase.from('debug_logs').insert({ step, payload: falPayload });
    log.info('Debug payload stored', {
      time_ms: log.endTiming('debug_log_insert'),
    });

    switch (step) {
      case 'GenGridImage':
        return await handleGenGridImage(supabase, falPayload, params, log);
      case 'SplitGridImage':
        return await handleSplitGridImage(supabase, falPayload, params, log);
      case 'GenerateTTS':
        return await handleGenerateTTS(supabase, falPayload, params, log);
      case 'OutpaintImage':
        return await handleOutpaintImage(supabase, falPayload, params, log);
      case 'EnhanceImage':
        return await handleEnhanceImage(supabase, falPayload, params, log);
      case 'GenerateVideo':
        return await handleGenerateVideo(supabase, falPayload, params, log);
      case 'GenerateSFX':
        return await handleGenerateSFX(supabase, falPayload, params, log);
      default:
        log.error('Unknown step', { step });
        return new Response(
          JSON.stringify({ success: false, error: `Unknown step: ${step}` }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          }
        );
    }
  } catch (error) {
    log.error('Unhandled exception', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      }
    );
  }
}
