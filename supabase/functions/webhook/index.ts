import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createLogger, type Logger } from '../_shared/logger.ts';
import * as musicMetadata from 'npm:music-metadata@10';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
  // deno-lint-ignore no-explicit-any
  outputs?: any;
  payload?: {
    images?: Array<{ url: string }>;
    audio?: FalAudioOutput;
    video?: Array<{ url: string }> | { url: string };
    // deno-lint-ignore no-explicit-any
    outputs?: any;
    prompt?: string;
  };
}

// Helper to get images from various possible locations
function getImages(
  payload: FalWebhookPayload
): Array<{ url: string }> | undefined {
  // Check all possible locations where fal.ai might put images
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

async function handleGenGridImage(
  supabase: ReturnType<typeof createClient>,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const grid_image_id = params.get('grid_image_id')!;
  const storyboard_id = params.get('storyboard_id')!;
  const rows = parseInt(params.get('rows') || '0', 10);
  const cols = parseInt(params.get('cols') || '0', 10);
  const width = parseInt(params.get('width') || '1920', 10);
  const height = parseInt(params.get('height') || '1080', 10);

  log.info('Processing GenGridImage', {
    grid_image_id,
    dimensions: `${width}x${height}`,
    fal_status: falPayload.status,
  });

  // Fetch storyboard mode early (needed for dimension validation and status logic)
  const { data: storyboard } = await supabase
    .from('storyboards')
    .select('mode')
    .eq('id', storyboard_id)
    .single();

  log.startTiming('extract_images');
  const images = getImages(falPayload);
  const extractTime = log.endTiming('extract_images');

  // Determine where images were found
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

  // Check if generation failed
  if (falPayload.status === 'ERROR' || !images?.[0]?.url) {
    log.error('Grid image generation failed', {
      fal_error: falPayload.error,
      has_images: !!images,
    });

    log.startTiming('db_update_failed');
    await supabase
      .from('grid_images')
      .update({ status: 'failed', error_message: 'generation_error' })
      .eq('id', grid_image_id);
    log.db('UPDATE', 'grid_images', {
      id: grid_image_id,
      status: 'failed',
      time_ms: log.endTiming('db_update_failed'),
    });

    // For ref_to_video: check if all siblings are done and fail storyboard if needed
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
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const gridImageUrl = images[0].url;
  const prompt = falPayload.payload?.prompt;

  log.success('Grid image generated', {
    url: gridImageUrl,
    has_prompt: !!prompt,
  });

  // Step 1: Validate grid dimensions from params
  // For ref_to_video grids (objects/backgrounds), dimensions are 1-4 with no square constraint
  // For image_to_video grids, dimensions are 2-8 and rows must equal cols or cols + 1
  const isRefGrid = storyboard?.mode === 'ref_to_video';
  const dimensionsInvalid = isRefGrid
    ? rows < 2 || cols < 2 || rows > 6 || cols > 6
    : rows < 2 || cols < 2 || (rows !== cols && rows !== cols + 1);

  if (dimensionsInvalid) {
    log.error('Invalid grid dimensions from params', { rows, cols, isRefGrid });

    await supabase
      .from('grid_images')
      .update({
        status: 'failed',
        url: gridImageUrl,
        error_message: `Invalid grid dimensions: ${rows}x${cols}`,
      })
      .eq('id', grid_image_id);

    return new Response(
      JSON.stringify({ success: false, error: 'Invalid grid dimensions' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  log.info('Grid dimensions from plan', { rows, cols });

  // Step 2: Update grid_images with 'generated' status (awaiting user review)
  log.startTiming('db_update_generated');
  await supabase
    .from('grid_images')
    .update({
      status: 'generated',
      url: gridImageUrl,
    })
    .eq('id', grid_image_id);
  log.db('UPDATE', 'grid_images', {
    id: grid_image_id,
    status: 'generated',
    rows,
    cols,
    time_ms: log.endTiming('db_update_generated'),
  });

  // Step 3: Update storyboard plan_status to 'grid_ready' for user review
  // For ref_to_video mode, only set grid_ready when ALL grids are generated
  log.startTiming('db_update_plan_status');

  if (storyboard?.mode === 'ref_to_video') {
    // Check if any sibling grids are still pending/processing
    const { data: pendingGrids } = await supabase
      .from('grid_images')
      .select('id')
      .eq('storyboard_id', storyboard_id)
      .in('status', ['pending', 'processing']);

    if (!pendingGrids || pendingGrids.length === 0) {
      // All grids done — check if any failed
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
    // image_to_video: immediate grid_ready (existing behavior)
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

  // Scene creation and split request are now triggered by user approval
  // via the approve-grid-split edge function

  log.summary('success', { grid_image_id, next_step: 'AwaitingUserReview' });
  return new Response(JSON.stringify({ success: true, step: 'GenGridImage' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleSplitGridImage(
  supabase: ReturnType<typeof createClient>,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const grid_image_id = params.get('grid_image_id')!;
  const storyboard_id = params.get('storyboard_id')!;

  log.info('Processing SplitGridImage', {
    grid_image_id,
    storyboard_id,
    fal_status: falPayload.status,
  });

  // Determine grid type to route appropriately
  const { data: gridImage } = await supabase
    .from('grid_images')
    .select('type')
    .eq('id', grid_image_id)
    .single();

  const gridType = gridImage?.type || 'scene';
  log.info('Grid type', { type: gridType });

  // Get images from specific ComfyUI nodes
  // Node 30 = url (split images), Node 11 = out_padded_url (padded images)
  log.startTiming('extract_node_images');
  const urlImages = getImagesFromNode(falPayload, '30');
  const outPaddedImages = getImagesFromNode(falPayload, '11');

  log.info('Node images extracted', {
    node_30_count: urlImages?.length || 0,
    node_11_count: outPaddedImages?.length || 0,
    time_ms: log.endTiming('extract_node_images'),
  });

  // Check if split failed (need at least one set of images)
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
      // scene type (image_to_video)
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

  // Route split results based on grid type
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
    // scene type (image_to_video) — existing behavior
    return await handleSceneSplit(
      supabase,
      falPayload,
      grid_image_id,
      storyboard_id,
      urlImages,
      outPaddedImages,
      log
    );
  }
}

async function handleSceneSplit(
  supabase: ReturnType<typeof createClient>,
  _falPayload: FalWebhookPayload,
  grid_image_id: string,
  storyboard_id: string,
  urlImages: Array<{ url: string }> | undefined,
  outPaddedImages: Array<{ url: string }> | undefined,
  log: Logger
): Promise<Response> {
  // Fetch scenes in order
  log.startTiming('fetch_scenes');
  const { data: scenes, error: scenesError } = await supabase
    .from('scenes')
    .select(`
      id,
      order,
      first_frames (id)
    `)
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

  // Update first_frames for each scene
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
    const firstFrame = scene.first_frames?.[0];

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
    { headers: { 'Content-Type': 'application/json' } }
  );
}

async function handleObjectsSplit(
  supabase: ReturnType<typeof createClient>,
  grid_image_id: string,
  storyboard_id: string,
  urlImages: Array<{ url: string }>,
  log: Logger
): Promise<Response> {
  log.startTiming('update_objects');
  let successCount = 0;

  // Update all object rows by (grid_image_id, order=i) — catches duplicates across scenes
  for (let i = 0; i < urlImages.length; i++) {
    const imageUrl = urlImages[i]?.url || null;
    const status = imageUrl ? 'success' : 'failed';

    const { count } = await supabase
      .from('objects')
      .update({
        url: imageUrl,
        final_url: imageUrl,
        status,
      })
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

  // Try to complete splitting if both splits are done
  await tryCompleteSplitting(supabase, storyboard_id, log);

  return new Response(
    JSON.stringify({ success: true, step: 'SplitGridImage', type: 'objects' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

async function handleBackgroundsSplit(
  supabase: ReturnType<typeof createClient>,
  grid_image_id: string,
  storyboard_id: string,
  urlImages: Array<{ url: string }>,
  log: Logger
): Promise<Response> {
  log.startTiming('update_backgrounds');
  let successCount = 0;

  // Update all background rows by (grid_image_id, order=i) — catches duplicates across scenes
  for (let i = 0; i < urlImages.length; i++) {
    const imageUrl = urlImages[i]?.url || null;
    const status = imageUrl ? 'success' : 'failed';

    const { count } = await supabase
      .from('backgrounds')
      .update({
        url: imageUrl,
        final_url: imageUrl,
        status,
      })
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

  // Try to complete splitting if both splits are done
  await tryCompleteSplitting(supabase, storyboard_id, log);

  return new Response(
    JSON.stringify({
      success: true,
      step: 'SplitGridImage',
      type: 'backgrounds',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

// Race-condition-safe: check if all splits are done and mark approved
async function tryCompleteSplitting(
  supabase: ReturnType<typeof createClient>,
  storyboard_id: string,
  log: Logger
): Promise<void> {
  // Fetch grid_image IDs for the storyboard
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

  // Check if all objects and backgrounds are done
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

  // Atomic gate: claim splitting → approved (only one webhook wins)
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

  log.success('All splits complete, storyboard approved', {
    storyboard_id,
  });
}

// Helper to get videos from various possible locations
function getVideos(
  payload: FalWebhookPayload
): Array<{ url: string }> | undefined {
  // Check all possible locations where fal.ai might put videos
  const candidates = [
    payload.payload?.video,
    payload.video,
    payload.payload?.outputs?.video,
    payload.outputs?.video,
  ];

  for (const candidate of candidates) {
    // Handle both array and single object formats
    if (Array.isArray(candidate) && candidate.length > 0 && candidate[0]?.url) {
      return candidate;
    }
    if (candidate && !Array.isArray(candidate) && candidate.url) {
      return [candidate];
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
  // Check all possible locations where fal.ai might put audio
  const candidates = [payload.payload?.audio, payload.audio];

  for (const candidate of candidates) {
    if (candidate?.url) {
      return candidate;
    }
  }

  return undefined;
}

async function handleOutpaintImage(
  supabase: ReturnType<typeof createClient>,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const first_frame_id = params.get('first_frame_id')!;

  log.info('Processing OutpaintImage', {
    first_frame_id,
    fal_status: falPayload.status,
  });

  log.startTiming('extract_images');
  const images = getImages(falPayload);
  const extractTime = log.endTiming('extract_images');

  log.info('Image extraction', {
    count: images?.length || 0,
    has_url: !!images?.[0]?.url,
    time_ms: extractTime,
  });

  // Check if outpaint failed
  if (falPayload.status === 'ERROR' || !images?.[0]?.url) {
    log.error('Image outpaint failed', {
      fal_error: falPayload.error,
      has_images: !!images,
    });

    log.startTiming('db_update_failed');
    await supabase
      .from('first_frames')
      .update({
        image_edit_status: 'failed',
        image_edit_error_message: 'generation_error',
      })
      .eq('id', first_frame_id);
    log.db('UPDATE', 'first_frames', {
      id: first_frame_id,
      image_edit_status: 'failed',
      time_ms: log.endTiming('db_update_failed'),
    });

    log.summary('error', { first_frame_id, reason: 'outpaint_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'Outpaint failed' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const finalUrl = images[0].url;

  log.success('Image outpainted', {
    final_url: finalUrl,
  });

  // Update first_frame with success and final_url
  log.startTiming('db_update_success');
  await supabase
    .from('first_frames')
    .update({
      image_edit_status: 'success',
      image_edit_error_message: null,
      outpainted_url: finalUrl,
      final_url: finalUrl,
    })
    .eq('id', first_frame_id);
  log.db('UPDATE', 'first_frames', {
    id: first_frame_id,
    image_edit_status: 'success',
    time_ms: log.endTiming('db_update_success'),
  });

  log.summary('success', { first_frame_id, final_url: finalUrl });
  return new Response(
    JSON.stringify({
      success: true,
      step: 'OutpaintImage',
      first_frame_id,
      final_url: finalUrl,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

async function handleEnhanceImage(
  supabase: ReturnType<typeof createClient>,
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
  const entityKey = isObject
    ? 'object_id'
    : isBackground
      ? 'background_id'
      : 'first_frame_id';

  log.info('Processing EnhanceImage', {
    [entityKey]: entityId,
    source: isObject
      ? 'objects'
      : isBackground
        ? 'backgrounds'
        : 'first_frames',
    fal_status: falPayload.status,
  });

  log.startTiming('extract_images');
  const images = getImages(falPayload);
  const extractTime = log.endTiming('extract_images');

  log.info('Image extraction', {
    count: images?.length || 0,
    has_url: !!images?.[0]?.url,
    time_ms: extractTime,
  });

  // --- Object path: update all siblings by grid_image_id + grid_position ---
  if (isObject) {
    // Fetch the object to get grid_image_id and grid_position
    const { data: obj, error: objError } = await supabase
      .from('objects')
      .select('id, grid_image_id, grid_position')
      .eq('id', object_id)
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

    const siblingFilter = {
      grid_image_id: obj.grid_image_id,
      grid_position: obj.grid_position,
    };

    if (falPayload.status === 'ERROR' || !images?.[0]?.url) {
      log.error('Object enhance failed', { fal_error: falPayload.error });

      log.startTiming('db_update_failed');
      await supabase
        .from('objects')
        .update({
          image_edit_status: 'failed',
          image_edit_error_message: 'generation_error',
        })
        .eq('grid_image_id', siblingFilter.grid_image_id)
        .eq('grid_position', siblingFilter.grid_position);
      log.db('UPDATE', 'objects (siblings)', {
        ...siblingFilter,
        image_edit_status: 'failed',
        time_ms: log.endTiming('db_update_failed'),
      });

      log.summary('error', { object_id, reason: 'enhance_failed' });
      return new Response(
        JSON.stringify({ success: false, error: 'Object enhance failed' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const finalUrl = images[0].url;
    log.success('Object enhanced', { final_url: finalUrl });

    log.startTiming('db_update_success');
    await supabase
      .from('objects')
      .update({
        image_edit_status: 'success',
        image_edit_error_message: null,
        final_url: finalUrl,
      })
      .eq('grid_image_id', siblingFilter.grid_image_id)
      .eq('grid_position', siblingFilter.grid_position);
    log.db('UPDATE', 'objects (siblings)', {
      ...siblingFilter,
      image_edit_status: 'success',
      time_ms: log.endTiming('db_update_success'),
    });

    log.summary('success', { object_id, final_url: finalUrl });
    return new Response(
      JSON.stringify({
        success: true,
        step: 'EnhanceImage',
        object_id,
        final_url: finalUrl,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  // --- Background / first_frame path ---
  const tableName = isBackground ? 'backgrounds' : 'first_frames';

  // Check if enhance failed
  if (falPayload.status === 'ERROR' || !images?.[0]?.url) {
    log.error('Image enhance failed', {
      fal_error: falPayload.error,
      has_images: !!images,
    });

    log.startTiming('db_update_failed');
    await supabase
      .from(tableName)
      .update({
        image_edit_status: 'failed',
        image_edit_error_message: 'generation_error',
      })
      .eq('id', entityId);
    log.db('UPDATE', tableName, {
      id: entityId,
      image_edit_status: 'failed',
      time_ms: log.endTiming('db_update_failed'),
    });

    log.summary('error', { [entityKey]: entityId, reason: 'enhance_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'Enhance failed' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const finalUrl = images[0].url;

  log.success('Image enhanced', {
    final_url: finalUrl,
  });

  // Update with success — only update final_url
  log.startTiming('db_update_success');
  await supabase
    .from(tableName)
    .update({
      image_edit_status: 'success',
      image_edit_error_message: null,
      final_url: finalUrl,
    })
    .eq('id', entityId);
  log.db('UPDATE', tableName, {
    id: entityId,
    image_edit_status: 'success',
    time_ms: log.endTiming('db_update_success'),
  });

  log.summary('success', { [entityKey]: entityId, final_url: finalUrl });
  return new Response(
    JSON.stringify({
      success: true,
      step: 'EnhanceImage',
      [entityKey]: entityId,
      final_url: finalUrl,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

async function handleGenerateTTS(
  supabase: ReturnType<typeof createClient>,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const voiceover_id = params.get('voiceover_id')!;

  log.info('Processing GenerateTTS', {
    voiceover_id,
    fal_status: falPayload.status,
  });

  log.startTiming('extract_audio');
  const audio = getAudio(falPayload);
  const extractTime = log.endTiming('extract_audio');

  // Determine where audio was found
  const audioSource = audio
    ? falPayload.payload?.audio
      ? 'payload.audio'
      : falPayload.audio
        ? 'root.audio'
        : 'none'
    : 'none';

  log.info('Audio extraction', {
    source: audioSource,
    has_url: !!audio?.url,
    time_ms: extractTime,
  });

  // Check if generation failed
  if (falPayload.status === 'ERROR' || !audio?.url) {
    log.error('TTS generation failed', {
      fal_error: falPayload.error,
      has_audio: !!audio,
    });

    log.startTiming('db_update_failed');
    await supabase
      .from('voiceovers')
      .update({ status: 'failed', error_message: 'generation_error' })
      .eq('id', voiceover_id);
    log.db('UPDATE', 'voiceovers', {
      id: voiceover_id,
      status: 'failed',
      time_ms: log.endTiming('db_update_failed'),
    });

    log.summary('error', { voiceover_id, reason: 'generation_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'TTS generation failed' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
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

    // Mark as failed - duration is required
    await supabase
      .from('voiceovers')
      .update({
        status: 'failed',
        error_message: 'duration_error',
      })
      .eq('id', voiceover_id);

    log.summary('error', {
      voiceover_id,
      reason: 'duration_calculation_failed',
    });
    return new Response(
      JSON.stringify({ success: false, error: 'Duration calculation failed' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Update voiceover with success, audio URL, and duration
  log.startTiming('db_update_success');
  await supabase
    .from('voiceovers')
    .update({
      status: 'success',
      audio_url: audioUrl,
      duration: duration,
    })
    .eq('id', voiceover_id);
  log.db('UPDATE', 'voiceovers', {
    id: voiceover_id,
    status: 'success',
    duration,
    time_ms: log.endTiming('db_update_success'),
  });

  log.summary('success', { voiceover_id, audio_url: audioUrl, duration });
  return new Response(
    JSON.stringify({
      success: true,
      step: 'GenerateTTS',
      voiceover_id,
      duration,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

async function handleGenerateVideo(
  supabase: ReturnType<typeof createClient>,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const scene_id = params.get('scene_id')!;

  log.info('Processing GenerateVideo', {
    scene_id,
    fal_status: falPayload.status,
  });

  log.startTiming('extract_videos');
  const videos = getVideos(falPayload);
  const extractTime = log.endTiming('extract_videos');

  // Determine where video was found
  const videoSource = videos
    ? falPayload.payload?.video
      ? 'payload.video'
      : falPayload.video
        ? 'root.video'
        : 'outputs'
    : 'none';

  log.info('Video extraction', {
    source: videoSource,
    count: videos?.length || 0,
    has_url: !!videos?.[0]?.url,
    time_ms: extractTime,
  });

  // Check if generation failed
  if (falPayload.status === 'ERROR' || !videos?.[0]?.url) {
    log.error('Video generation failed', {
      fal_error: falPayload.error,
      has_videos: !!videos,
    });

    log.startTiming('db_update_failed');
    await supabase
      .from('scenes')
      .update({
        video_status: 'failed',
        video_error_message: 'generation_error',
      })
      .eq('id', scene_id);
    log.db('UPDATE', 'scenes', {
      id: scene_id,
      video_status: 'failed',
      time_ms: log.endTiming('db_update_failed'),
    });

    log.summary('error', { scene_id, reason: 'generation_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'Video generation failed' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Get first video URL only
  const videoUrl = videos[0].url;

  log.success('Video generated', {
    video_url: videoUrl,
  });

  // Update scene with success and video_url
  log.startTiming('db_update_success');
  await supabase
    .from('scenes')
    .update({
      video_status: 'success',
      video_url: videoUrl,
    })
    .eq('id', scene_id);
  log.db('UPDATE', 'scenes', {
    id: scene_id,
    video_status: 'success',
    time_ms: log.endTiming('db_update_success'),
  });

  log.summary('success', { scene_id, video_url: videoUrl });
  return new Response(
    JSON.stringify({
      success: true,
      step: 'GenerateVideo',
      scene_id,
      video_url: videoUrl,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

async function handleGenerateSFX(
  supabase: ReturnType<typeof createClient>,
  falPayload: FalWebhookPayload,
  params: URLSearchParams,
  log: Logger
): Promise<Response> {
  const scene_id = params.get('scene_id')!;

  log.info('Processing GenerateSFX', {
    scene_id,
    fal_status: falPayload.status,
  });

  log.startTiming('extract_videos');
  const videos = getVideos(falPayload);
  const extractTime = log.endTiming('extract_videos');

  log.info('Video extraction (SFX)', {
    count: videos?.length || 0,
    has_url: !!videos?.[0]?.url,
    time_ms: extractTime,
  });

  // Check if generation failed
  if (falPayload.status === 'ERROR' || !videos?.[0]?.url) {
    log.error('SFX generation failed', {
      fal_error: falPayload.error,
      has_videos: !!videos,
    });

    log.startTiming('db_update_failed');
    await supabase
      .from('scenes')
      .update({
        sfx_status: 'failed',
        sfx_error_message: 'generation_error',
      })
      .eq('id', scene_id);
    log.db('UPDATE', 'scenes', {
      id: scene_id,
      sfx_status: 'failed',
      time_ms: log.endTiming('db_update_failed'),
    });

    log.summary('error', { scene_id, reason: 'sfx_generation_failed' });
    return new Response(
      JSON.stringify({ success: false, error: 'SFX generation failed' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Get first video URL only (SFX result overwrites video_url)
  const videoUrl = videos[0].url;

  log.success('SFX generated', {
    video_url: videoUrl,
  });

  // Update scene with success and overwrite video_url
  log.startTiming('db_update_success');
  await supabase
    .from('scenes')
    .update({
      sfx_status: 'success',
      video_url: videoUrl,
    })
    .eq('id', scene_id);
  log.db('UPDATE', 'scenes', {
    id: scene_id,
    sfx_status: 'success',
    time_ms: log.endTiming('db_update_success'),
  });

  log.summary('success', { scene_id, video_url: videoUrl });
  return new Response(
    JSON.stringify({
      success: true,
      step: 'GenerateSFX',
      scene_id,
      video_url: videoUrl,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers':
          'authorization, content-type, x-client-info, apikey',
      },
    });
  }

  const log = createLogger();

  try {
    // Get step and other params from URL query parameters
    const url = new URL(req.url);
    const params = url.searchParams;
    const step = params.get('step');
    const gridImageId = params.get('grid_image_id');

    log.setContext({ step: step || 'Unknown' });

    log.info('Webhook received', {
      step,
      grid_image_id: gridImageId,
      params: Object.fromEntries(params),
    });

    if (!step) {
      log.error('Missing step parameter');
      return new Response(
        JSON.stringify({ success: false, error: 'Missing step parameter' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Parse the fal.ai payload from body
    log.startTiming('parse_payload');
    const falPayload = await req.json();
    log.info('Payload parsed', {
      fal_status: falPayload.status,
      has_images: !!falPayload.images || !!falPayload.payload?.images,
      request_id: falPayload.request_id,
      time_ms: log.endTiming('parse_payload'),
    });

    // Initialize Supabase client with service role
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Store raw payload for debugging
    log.startTiming('debug_log_insert');
    await supabase.from('debug_logs').insert({
      step: step,
      payload: falPayload,
    });
    log.info('Debug payload stored', {
      time_ms: log.endTiming('debug_log_insert'),
    });

    // Route to appropriate handler
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
            status: 400,
            headers: { 'Content-Type': 'application/json' },
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
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
