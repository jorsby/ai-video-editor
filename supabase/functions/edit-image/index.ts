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

interface EditImageInput {
  scene_ids: string[];
  model?: 'banana' | 'fibo' | 'grok';
  action?: 'outpaint' | 'enhance' | 'custom_edit' | 'ref_to_image';
  prompt?: string;
  target_scene_id?: string;
  source?: 'first_frame' | 'background' | 'object';
  object_ids?: string[];
}

const EDIT_ENDPOINTS: Record<string, string> = {
  banana: 'workflows/octupost/edit-image-banana',
  fibo: 'workflows/octupost/edit-image-fibo',
  grok: 'workflows/octupost/edit-image-grok',
};

const EDIT_PROMPT =
  'Seamlessly extend the image into all masked areas. Fill every masked pixel completely. No borders, frames, panels, black bars, blank areas, transparent areas, or unfilled regions. No new subjects, text, watermarks, seams, or visible edges. Maintain the same scene, style, color palette, and perspective throughout.';

const ENHANCE_PROMPT =
  'Improve quality to 8k Do not change the image but fix the objects to make it more real';

interface FirstFrameContext {
  first_frame_id: string;
  scene_id: string;
  image_url: string;
}

interface BackgroundContext {
  background_id: string;
  scene_id: string;
  image_url: string;
}

interface ObjectContext {
  object_id: string;
  grid_image_id: string;
  grid_position: number;
  image_url: string;
}

type SupabaseClient = ReturnType<typeof createClient>;

async function getFirstFrameContext(
  supabase: SupabaseClient,
  sceneId: string,
  log: ReturnType<typeof createLogger>
): Promise<FirstFrameContext | null> {
  const { data: firstFrame, error: ffError } = await supabase
    .from('first_frames')
    .select('id, scene_id, out_padded_url, image_edit_status')
    .eq('scene_id', sceneId)
    .single();

  if (ffError || !firstFrame) {
    log.error('Failed to fetch first_frame', {
      scene_id: sceneId,
      error: ffError?.message,
    });
    return null;
  }

  if (!firstFrame.out_padded_url) {
    log.warn('No out_padded_url for first_frame', {
      first_frame_id: firstFrame.id,
    });
    return null;
  }

  if (firstFrame.image_edit_status === 'outpainting') {
    log.warn('Outpaint already processing, skipping', {
      first_frame_id: firstFrame.id,
    });
    return null;
  }

  return {
    first_frame_id: firstFrame.id,
    scene_id: sceneId,
    image_url: firstFrame.out_padded_url,
  };
}

async function sendEditRequest(
  context: FirstFrameContext | BackgroundContext | ObjectContext,
  endpoint: string,
  model: string,
  prompt: string,
  webhookStep: string,
  log: ReturnType<typeof createLogger>,
  referenceUrls?: string[]
): Promise<{ requestId: string | null; error: string | null }> {
  const isObject = 'object_id' in context;
  const isBackground = 'background_id' in context;
  const entityId = isObject
    ? context.object_id
    : isBackground
      ? context.background_id
      : context.first_frame_id;
  const entityKey = isObject
    ? 'object_id'
    : isBackground
      ? 'background_id'
      : 'first_frame_id';
  const webhookParams = new URLSearchParams({
    step: webhookStep,
    [entityKey]: entityId,
  });
  const webhookUrl = `${SUPABASE_URL}/functions/v1/webhook?${webhookParams.toString()}`;

  const falUrl = new URL(`https://queue.fal.run/${endpoint}`);
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  log.api('fal.ai', endpoint, {
    [entityKey]: entityId,
    has_image_url: !!context.image_url,
    reference_count: referenceUrls?.length ?? 0,
  });
  log.startTiming('fal_outpaint_request');

  // When referenceUrls are provided (ref_to_image), send all as image_urls array
  // Otherwise: fibo and grok use image_url (singular string), others use image_urls (array)
  let requestBody: Record<string, unknown>;
  if (referenceUrls && referenceUrls.length > 0) {
    requestBody = { image_urls: referenceUrls, prompt };
  } else if (model === 'fibo' || model === 'grok') {
    requestBody = { image_url: context.image_url, prompt };
  } else {
    requestBody = { image_urls: [context.image_url], prompt };
  }

  try {
    const falResponse = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      log.error('fal.ai outpaint request failed', {
        status: falResponse.status,
        error: errorText,
        time_ms: log.endTiming('fal_outpaint_request'),
      });
      return {
        requestId: null,
        error: `fal.ai request failed: ${falResponse.status}`,
      };
    }

    const falResult = await falResponse.json();
    log.success('fal.ai outpaint request accepted', {
      request_id: falResult.request_id,
      time_ms: log.endTiming('fal_outpaint_request'),
    });

    return { requestId: falResult.request_id, error: null };
  } catch (err) {
    log.error('fal.ai outpaint request exception', {
      error: err instanceof Error ? err.message : String(err),
      time_ms: log.endTiming('fal_outpaint_request'),
    });
    return { requestId: null, error: 'Request exception' };
  }
}

async function getFirstFrameContextForEnhance(
  supabase: SupabaseClient,
  sceneId: string,
  log: ReturnType<typeof createLogger>
): Promise<FirstFrameContext | null> {
  const { data: firstFrame, error: ffError } = await supabase
    .from('first_frames')
    .select('id, scene_id, final_url, image_edit_status')
    .eq('scene_id', sceneId)
    .single();

  if (ffError || !firstFrame) {
    log.error('Failed to fetch first_frame', {
      scene_id: sceneId,
      error: ffError?.message,
    });
    return null;
  }

  if (!firstFrame.final_url) {
    log.warn('No final_url for first_frame', {
      first_frame_id: firstFrame.id,
    });
    return null;
  }

  if (
    firstFrame.image_edit_status === 'enhancing' ||
    firstFrame.image_edit_status === 'editing'
  ) {
    log.warn('Enhance/edit already processing, skipping', {
      first_frame_id: firstFrame.id,
    });
    return null;
  }

  return {
    first_frame_id: firstFrame.id,
    scene_id: sceneId,
    image_url: firstFrame.final_url,
  };
}

async function getBackgroundContextForEnhance(
  supabase: SupabaseClient,
  sceneId: string,
  log: ReturnType<typeof createLogger>
): Promise<BackgroundContext | null> {
  const { data: bg, error: bgError } = await supabase
    .from('backgrounds')
    .select('id, scene_id, final_url, image_edit_status')
    .eq('scene_id', sceneId)
    .single();

  if (bgError || !bg) {
    log.error('Failed to fetch background', {
      scene_id: sceneId,
      error: bgError?.message,
    });
    return null;
  }

  if (!bg.final_url) {
    log.warn('No final_url for background', { background_id: bg.id });
    return null;
  }

  if (
    bg.image_edit_status === 'enhancing' ||
    bg.image_edit_status === 'editing'
  ) {
    log.warn('Enhance/edit already processing, skipping', {
      background_id: bg.id,
    });
    return null;
  }

  return {
    background_id: bg.id,
    scene_id: sceneId,
    image_url: bg.final_url,
  };
}

async function getObjectContextForEnhance(
  supabase: SupabaseClient,
  objectId: string,
  log: ReturnType<typeof createLogger>
): Promise<ObjectContext | null> {
  const { data: obj, error: objError } = await supabase
    .from('objects')
    .select('id, grid_image_id, grid_position, final_url, image_edit_status')
    .eq('id', objectId)
    .single();

  if (objError || !obj) {
    log.error('Failed to fetch object', {
      object_id: objectId,
      error: objError?.message,
    });
    return null;
  }

  if (!obj.final_url) {
    log.warn('No final_url for object', { object_id: obj.id });
    return null;
  }

  if (
    obj.image_edit_status === 'enhancing' ||
    obj.image_edit_status === 'editing'
  ) {
    log.warn('Enhance/edit already processing, skipping', {
      object_id: obj.id,
    });
    return null;
  }

  return {
    object_id: obj.id,
    grid_image_id: obj.grid_image_id,
    grid_position: obj.grid_position,
    image_url: obj.final_url,
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
  log.setContext({ step: 'OutpaintImage' });

  try {
    log.info('Request received', { method: req.method });

    const input: EditImageInput = await req.json();
    const { scene_ids, model = 'banana', action = 'outpaint' } = input;

    if (!scene_ids || !Array.isArray(scene_ids) || scene_ids.length === 0) {
      log.error('Invalid input', { scene_ids });
      return errorResponse('scene_ids must be a non-empty array', 400);
    }

    if (action === 'custom_edit' && !input.prompt) {
      log.error('Missing prompt for custom_edit');
      return errorResponse('prompt is required for custom_edit action', 400);
    }

    if (action === 'ref_to_image') {
      if (!input.prompt) {
        return errorResponse('prompt is required for ref_to_image action', 400);
      }
      if (!input.target_scene_id) {
        return errorResponse(
          'target_scene_id is required for ref_to_image action',
          400
        );
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const endpoint = EDIT_ENDPOINTS[model] ?? EDIT_ENDPOINTS.banana;

    // --- ref_to_image: single request with multiple reference images ---
    if (action === 'ref_to_image') {
      log.setContext({ step: 'EnhanceImage' });
      log.info('Processing ref_to_image request', {
        reference_count: scene_ids.length,
        target_scene_id: input.target_scene_id,
        model,
        endpoint,
      });

      // Collect reference image URLs from all scene_ids
      const referenceUrls: string[] = [];
      for (const sceneId of scene_ids) {
        const ctx = await getFirstFrameContextForEnhance(
          supabase,
          sceneId,
          log
        );
        if (ctx) {
          referenceUrls.push(ctx.image_url);
        }
      }

      if (referenceUrls.length === 0) {
        return errorResponse('No valid reference images found', 400);
      }

      // Get target first_frame context
      const targetContext = await getFirstFrameContextForEnhance(
        supabase,
        input.target_scene_id!,
        log
      );
      if (!targetContext) {
        return errorResponse(
          'Target scene not found or already processing',
          400
        );
      }

      // Set target status to editing
      await supabase
        .from('first_frames')
        .update({ image_edit_status: 'editing' })
        .eq('id', targetContext.first_frame_id);

      // Send single request with all reference URLs
      const { requestId, error: reqError } = await sendEditRequest(
        targetContext,
        endpoint,
        model,
        input.prompt!,
        'EnhanceImage',
        log,
        referenceUrls
      );

      if (reqError || !requestId) {
        await supabase
          .from('first_frames')
          .update({
            image_edit_status: 'failed',
            image_edit_error_message: 'request_error',
          })
          .eq('id', targetContext.first_frame_id);

        log.summary('error', { reason: 'fal_request_failed' });
        return jsonResponse({
          success: false,
          error: reqError || 'Unknown error',
          target_scene_id: input.target_scene_id,
        });
      }

      await supabase
        .from('first_frames')
        .update({ image_edit_request_id: requestId })
        .eq('id', targetContext.first_frame_id);

      log.success('ref_to_image request queued', {
        target_scene_id: input.target_scene_id,
        first_frame_id: targetContext.first_frame_id,
        request_id: requestId,
        reference_count: referenceUrls.length,
      });

      log.summary('success', { total: 1, queued: 1, skipped: 0, failed: 0 });
      return jsonResponse({
        success: true,
        target_scene_id: input.target_scene_id,
        first_frame_id: targetContext.first_frame_id,
        request_id: requestId,
        reference_count: referenceUrls.length,
        summary: { total: 1, queued: 1, skipped: 0, failed: 0 },
      });
    }

    // --- Object actions: enhance / custom_edit for objects ---
    if (
      input.source === 'object' &&
      input.object_ids &&
      input.object_ids.length > 0
    ) {
      const isCustomEditObj = action === 'custom_edit';
      const objPrompt = isCustomEditObj ? input.prompt! : ENHANCE_PROMPT;
      const objStatusLabel = isCustomEditObj ? 'editing' : 'enhancing';

      log.setContext({ step: 'EnhanceImage' });
      log.info(`Processing object ${action} requests`, {
        object_count: input.object_ids.length,
        model,
        endpoint,
        action,
      });

      const results: Array<{
        object_id: string;
        request_id: string | null;
        status: 'queued' | 'skipped' | 'failed';
        error?: string;
      }> = [];

      for (let i = 0; i < input.object_ids.length; i++) {
        const objectId = input.object_ids[i];

        if (i > 0) {
          log.info('Waiting before next request', { delay_ms: 1000, index: i });
          await delay(1000);
        }

        const context = await getObjectContextForEnhance(
          supabase,
          objectId,
          log
        );
        if (!context) {
          results.push({
            object_id: objectId,
            request_id: null,
            status: 'skipped',
            error: 'Object not found or already processing',
          });
          continue;
        }

        // Update status on ALL siblings (same grid_image_id + grid_position)
        await supabase
          .from('objects')
          .update({ image_edit_status: objStatusLabel })
          .eq('grid_image_id', context.grid_image_id)
          .eq('grid_position', context.grid_position);

        const { requestId, error } = await sendEditRequest(
          context,
          endpoint,
          model,
          objPrompt,
          'EnhanceImage',
          log
        );

        if (error || !requestId) {
          await supabase
            .from('objects')
            .update({
              image_edit_status: 'failed',
              image_edit_error_message: 'request_error',
            })
            .eq('grid_image_id', context.grid_image_id)
            .eq('grid_position', context.grid_position);

          results.push({
            object_id: objectId,
            request_id: null,
            status: 'failed',
            error: error || 'Unknown error',
          });
          continue;
        }

        // Store request_id on ALL siblings
        await supabase
          .from('objects')
          .update({ image_edit_request_id: requestId })
          .eq('grid_image_id', context.grid_image_id)
          .eq('grid_position', context.grid_position);

        results.push({
          object_id: objectId,
          request_id: requestId,
          status: 'queued',
        });

        log.success(`Object ${action} request queued`, {
          object_id: objectId,
          request_id: requestId,
        });
      }

      const queuedCount = results.filter((r) => r.status === 'queued').length;
      const skippedCount = results.filter((r) => r.status === 'skipped').length;
      const failedCount = results.filter((r) => r.status === 'failed').length;

      log.summary('success', {
        total: input.object_ids.length,
        queued: queuedCount,
        skipped: skippedCount,
        failed: failedCount,
      });

      return jsonResponse({
        success: true,
        results,
        summary: {
          total: input.object_ids.length,
          queued: queuedCount,
          skipped: skippedCount,
          failed: failedCount,
        },
      });
    }

    // --- Standard actions: outpaint / enhance / custom_edit ---
    const isEnhance = action === 'enhance';
    const isCustomEdit = action === 'custom_edit';
    const isBackground = input.source === 'background';
    const useFinalUrl = isEnhance || isCustomEdit;
    const prompt = isCustomEdit
      ? input.prompt!
      : isEnhance
        ? ENHANCE_PROMPT
        : EDIT_PROMPT;
    const webhookStep = useFinalUrl ? 'EnhanceImage' : 'OutpaintImage';
    const statusLabel = isCustomEdit
      ? 'editing'
      : isEnhance
        ? 'enhancing'
        : 'outpainting';
    const tableName = isBackground ? 'backgrounds' : 'first_frames';

    log.setContext({ step: webhookStep });
    log.info(`Processing ${action} requests`, {
      scene_count: scene_ids.length,
      model,
      endpoint,
      action,
      source: input.source ?? 'first_frame',
    });

    const results: Array<{
      scene_id: string;
      entity_id: string | null;
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

      // Get context (first_frame or background)
      log.startTiming(`get_context_${i}`);
      const context = isBackground
        ? await getBackgroundContextForEnhance(supabase, sceneId, log)
        : useFinalUrl
          ? await getFirstFrameContextForEnhance(supabase, sceneId, log)
          : await getFirstFrameContext(supabase, sceneId, log);
      log.info('Context fetched', {
        scene_id: sceneId,
        source: tableName,
        has_context: !!context,
        time_ms: log.endTiming(`get_context_${i}`),
      });

      if (!context) {
        results.push({
          scene_id: sceneId,
          entity_id: null,
          request_id: null,
          status: 'skipped',
          error: `${tableName} not found or already processing`,
        });
        continue;
      }

      const entityId =
        'background_id' in context
          ? context.background_id
          : context.first_frame_id;

      // Update status to processing
      await supabase
        .from(tableName)
        .update({ image_edit_status: statusLabel })
        .eq('id', entityId);

      // Send edit request
      const { requestId, error } = await sendEditRequest(
        context,
        endpoint,
        model,
        prompt,
        webhookStep,
        log
      );

      if (error || !requestId) {
        // Mark as failed with request_error
        await supabase
          .from(tableName)
          .update({
            image_edit_status: 'failed',
            image_edit_error_message: 'request_error',
          })
          .eq('id', entityId);

        results.push({
          scene_id: sceneId,
          entity_id: entityId,
          request_id: null,
          status: 'failed',
          error: error || 'Unknown error',
        });
        continue;
      }

      // Store request_id
      await supabase
        .from(tableName)
        .update({ image_edit_request_id: requestId })
        .eq('id', entityId);

      results.push({
        scene_id: sceneId,
        entity_id: entityId,
        request_id: requestId,
        status: 'queued',
      });

      log.success(`${action} request queued`, {
        scene_id: sceneId,
        entity_id: entityId,
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
