import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

const FAL_API_KEY = process.env.FAL_KEY!;
const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL!;

interface EditImageInput {
  scene_ids: string[];
  model?: 'kling' | 'banana' | 'fibo' | 'grok' | 'flux-pro';
  action?: 'outpaint' | 'enhance' | 'custom_edit' | 'ref_to_image';
  prompt?: string;
  target_scene_id?: string;
  source?: 'first_frame' | 'background' | 'object';
  object_ids?: string[];
}

const EDIT_ENDPOINTS: Record<string, string> = {
  kling: 'fal-ai/kling-image/o3/image-to-image',
  banana: 'fal-ai/nano-banana-2/edit',
  fibo: 'bria/fibo-edit/edit',
  grok: 'xai/grok-imagine-image/edit',
  'flux-pro': 'fal-ai/flux-2-pro/edit',
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

async function getFirstFrameContext(
  supabase: any,
  sceneId: string,
  log: ReturnType<typeof createLogger>
): Promise<FirstFrameContext | null> {
  const { data: ff, error } = await supabase
    .from('first_frames')
    .select('id, scene_id, out_padded_url, image_edit_status')
    .eq('scene_id', sceneId)
    .single();
  if (error || !ff) {
    log.error('Failed to fetch first_frame', {
      scene_id: sceneId,
      error: error?.message,
    });
    return null;
  }
  if (!ff.out_padded_url) {
    log.warn('No out_padded_url for first_frame', { first_frame_id: ff.id });
    return null;
  }
  if (ff.image_edit_status === 'outpainting') {
    log.warn('Outpaint already processing, skipping', {
      first_frame_id: ff.id,
    });
    return null;
  }
  return {
    first_frame_id: ff.id,
    scene_id: sceneId,
    image_url: ff.out_padded_url,
  };
}

async function getFirstFrameContextForEnhance(
  supabase: any,
  sceneId: string,
  log: ReturnType<typeof createLogger>
): Promise<FirstFrameContext | null> {
  const { data: ff, error } = await supabase
    .from('first_frames')
    .select('id, scene_id, final_url, image_edit_status')
    .eq('scene_id', sceneId)
    .single();
  if (error || !ff) {
    log.error('Failed to fetch first_frame', {
      scene_id: sceneId,
      error: error?.message,
    });
    return null;
  }
  if (!ff.final_url) {
    log.warn('No final_url for first_frame', { first_frame_id: ff.id });
    return null;
  }
  if (
    ff.image_edit_status === 'enhancing' ||
    ff.image_edit_status === 'editing'
  ) {
    log.warn('Already processing, skipping', { first_frame_id: ff.id });
    return null;
  }
  return { first_frame_id: ff.id, scene_id: sceneId, image_url: ff.final_url };
}

async function getBackgroundContextForEnhance(
  supabase: any,
  sceneId: string,
  log: ReturnType<typeof createLogger>
): Promise<BackgroundContext | null> {
  const { data: bg, error } = await supabase
    .from('backgrounds')
    .select('id, scene_id, final_url, image_edit_status')
    .eq('scene_id', sceneId)
    .single();
  if (error || !bg) {
    log.error('Failed to fetch background', {
      scene_id: sceneId,
      error: error?.message,
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
    log.warn('Already processing, skipping', { background_id: bg.id });
    return null;
  }
  return { background_id: bg.id, scene_id: sceneId, image_url: bg.final_url };
}

async function getObjectContextForEnhance(
  supabase: any,
  objectId: string,
  log: ReturnType<typeof createLogger>
): Promise<ObjectContext | null> {
  const { data: obj, error } = await supabase
    .from('objects')
    .select('id, grid_image_id, grid_position, final_url, image_edit_status')
    .eq('id', objectId)
    .single();
  if (error || !obj) {
    log.error('Failed to fetch object', {
      object_id: objectId,
      error: error?.message,
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
    log.warn('Already processing, skipping', { object_id: obj.id });
    return null;
  }
  return {
    object_id: obj.id,
    grid_image_id: obj.grid_image_id,
    grid_position: obj.grid_position,
    image_url: obj.final_url,
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
  const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/fal?${webhookParams.toString()}`;

  const falUrl = new URL(`https://queue.fal.run/${endpoint}`);
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  log.api('fal.ai', endpoint, {
    [entityKey]: entityId,
    has_image_url: !!context.image_url,
    reference_count: referenceUrls?.length ?? 0,
  });
  log.startTiming('fal_outpaint_request');

  let requestBody: Record<string, unknown>;
  if (referenceUrls && referenceUrls.length > 0) {
    if (model === 'fibo') {
      requestBody = { image_url: referenceUrls[0], instruction: prompt };
    } else {
      requestBody = { image_urls: referenceUrls, prompt };
    }
  } else if (model === 'fibo') {
    requestBody = { image_url: context.image_url, instruction: prompt };
  } else {
    requestBody = { image_urls: [context.image_url], prompt };
  }

  // Disable safety checkers where supported
  if (model === 'flux-pro') {
    requestBody.enable_safety_checker = false;
    requestBody.safety_tolerance = '5';
  } else if (model === 'banana') {
    requestBody.safety_tolerance = '6';
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  const log = createLogger();
  log.setContext({ step: 'OutpaintImage' });

  try {
    const authClient = await createClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    log.info('Request received');
    const input: EditImageInput = await req.json();
    const { scene_ids, model = 'kling', action = 'outpaint' } = input;

    if (!scene_ids || !Array.isArray(scene_ids) || scene_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'scene_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    if (action === 'custom_edit' && !input.prompt) {
      return NextResponse.json(
        { success: false, error: 'prompt is required for custom_edit action' },
        { status: 400 }
      );
    }

    if (action === 'ref_to_image') {
      if (!input.prompt)
        return NextResponse.json(
          {
            success: false,
            error: 'prompt is required for ref_to_image action',
          },
          { status: 400 }
        );
      if (!input.target_scene_id)
        return NextResponse.json(
          {
            success: false,
            error: 'target_scene_id is required for ref_to_image action',
          },
          { status: 400 }
        );
    }

    const supabase = createServiceClient();
    const endpoint = EDIT_ENDPOINTS[model] ?? EDIT_ENDPOINTS.kling;

    // --- ref_to_image: single request with multiple reference images ---
    if (action === 'ref_to_image') {
      log.setContext({ step: 'EnhanceImage' });
      const referenceUrls: string[] = [];
      for (const sceneId of scene_ids) {
        const ctx = await getFirstFrameContextForEnhance(
          supabase,
          sceneId,
          log
        );
        if (ctx) referenceUrls.push(ctx.image_url);
      }
      if (referenceUrls.length === 0)
        return NextResponse.json(
          { success: false, error: 'No valid reference images found' },
          { status: 400 }
        );

      const targetContext = await getFirstFrameContextForEnhance(
        supabase,
        input.target_scene_id!,
        log
      );
      if (!targetContext)
        return NextResponse.json(
          {
            success: false,
            error: 'Target scene not found or already processing',
          },
          { status: 400 }
        );

      await supabase
        .from('first_frames')
        .update({ image_edit_status: 'editing' })
        .eq('id', targetContext.first_frame_id);
      const { requestId, error: reqError } = await sendEditRequest(
        targetContext,
        endpoint,
        model,
        input.prompt as string,
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
        return NextResponse.json({
          success: false,
          error: reqError || 'Unknown error',
          target_scene_id: input.target_scene_id,
        });
      }

      await supabase
        .from('first_frames')
        .update({ image_edit_request_id: requestId })
        .eq('id', targetContext.first_frame_id);
      return NextResponse.json({
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
      const objPrompt = isCustomEditObj
        ? (input.prompt as string)
        : ENHANCE_PROMPT;
      const objStatusLabel = isCustomEditObj ? 'editing' : 'enhancing';

      log.setContext({ step: 'EnhanceImage' });
      const results: Array<{
        object_id: string;
        request_id: string | null;
        status: 'queued' | 'skipped' | 'failed';
        error?: string;
      }> = [];

      for (let i = 0; i < input.object_ids.length; i++) {
        const objectId = input.object_ids[i];
        if (i > 0) {
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
      }

      const queuedCount = results.filter((r) => r.status === 'queued').length;
      const skippedCount = results.filter((r) => r.status === 'skipped').length;
      const failedCount = results.filter((r) => r.status === 'failed').length;

      return NextResponse.json({
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
      ? (input.prompt as string)
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

    const results: Array<{
      scene_id: string;
      entity_id: string | null;
      request_id: string | null;
      status: 'queued' | 'skipped' | 'failed';
      error?: string;
    }> = [];

    for (let i = 0; i < scene_ids.length; i++) {
      const sceneId = scene_ids[i];
      if (i > 0) {
        await delay(1000);
      }

      const context = isBackground
        ? await getBackgroundContextForEnhance(supabase, sceneId, log)
        : useFinalUrl
          ? await getFirstFrameContextForEnhance(supabase, sceneId, log)
          : await getFirstFrameContext(supabase, sceneId, log);

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

      await supabase
        .from(tableName)
        .update({ image_edit_status: statusLabel })
        .eq('id', entityId);
      const { requestId, error } = await sendEditRequest(
        context,
        endpoint,
        model,
        prompt,
        webhookStep,
        log
      );

      if (error || !requestId) {
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
    }

    const queuedCount = results.filter((r) => r.status === 'queued').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

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
