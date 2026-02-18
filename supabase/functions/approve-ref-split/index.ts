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

interface ApproveRefSplitInput {
  storyboard_id: string;
  objects_grid_image_id: string;
  objects_grid_image_url: string;
  objects_rows: number;
  objects_cols: number;
  bg_grid_image_id: string;
  bg_grid_image_url: string;
  bg_rows: number;
  bg_cols: number;
  // Object metadata from plan
  object_names: string[];
  object_descriptions?: string[]; // Kling O3 only
  background_names: string[];
  // Scene data from plan
  scene_prompts: (string | string[])[];
  scene_bg_indices: number[];
  scene_object_indices: number[][];
  scene_multi_shots?: boolean[];
  voiceover_list: { en: string[]; tr: string[]; ar: string[] };
  width: number;
  height: number;
}

async function sendSplitRequest(
  gridImageUrl: string,
  gridImageId: string,
  storyboardId: string,
  rows: number,
  cols: number,
  width: number,
  height: number,
  log: ReturnType<typeof createLogger>
): Promise<{ requestId: string | null; error: string | null }> {
  const splitWebhookParams = new URLSearchParams({
    step: 'SplitGridImage',
    grid_image_id: gridImageId,
    storyboard_id: storyboardId,
  });
  const splitWebhookUrl = `${SUPABASE_URL}/functions/v1/webhook?${splitWebhookParams.toString()}`;

  const falUrl = new URL('https://queue.fal.run/comfy/octupost/splitgridimage');
  falUrl.searchParams.set('fal_webhook', splitWebhookUrl);

  log.api('ComfyUI', 'splitgridimage', {
    grid_image_id: gridImageId,
    rows,
    cols,
    width,
    height,
  });

  const splitResponse = await fetch(falUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      loadimage_1: gridImageUrl,
      rows,
      cols,
      width,
      height,
    }),
  });

  if (!splitResponse.ok) {
    const errorText = await splitResponse.text();
    log.error('Split request failed', {
      grid_image_id: gridImageId,
      status: splitResponse.status,
      error: errorText,
    });
    return {
      requestId: null,
      error: `Split request failed: ${splitResponse.status}`,
    };
  }

  const splitResult = await splitResponse.json();
  log.success('Split request sent', {
    grid_image_id: gridImageId,
    request_id: splitResult.request_id,
  });
  return { requestId: splitResult.request_id, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const log = createLogger();
  log.setContext({ step: 'ApproveRefSplit' });

  try {
    log.info('Request received', { method: req.method });

    const input: ApproveRefSplitInput = await req.json();
    const {
      storyboard_id,
      objects_grid_image_id,
      objects_grid_image_url,
      objects_rows,
      objects_cols,
      bg_grid_image_id,
      bg_grid_image_url,
      bg_rows,
      bg_cols,
      object_names,
      object_descriptions,
      background_names,
      scene_prompts,
      scene_bg_indices,
      scene_object_indices,
      scene_multi_shots,
      voiceover_list,
      width,
      height,
    } = input;

    // Validate required fields
    if (
      !storyboard_id ||
      !objects_grid_image_id ||
      !objects_grid_image_url ||
      !bg_grid_image_id ||
      !bg_grid_image_url
    ) {
      return errorResponse('Missing required fields', 400);
    }

    const expectedObjects = objects_rows * objects_cols;
    const expectedBgs = bg_rows * bg_cols;
    const sceneCount = scene_prompts.length;

    if (object_names.length !== expectedObjects) {
      return errorResponse(
        `object_names length (${object_names.length}) must equal objects_rows*objects_cols (${expectedObjects})`,
        400
      );
    }

    if (background_names.length !== expectedBgs) {
      return errorResponse(
        `background_names length (${background_names.length}) must equal bg_rows*bg_cols (${expectedBgs})`,
        400
      );
    }

    const languages = ['en', 'tr', 'ar'] as const;
    for (const lang of languages) {
      if (voiceover_list[lang].length !== sceneCount) {
        return errorResponse(
          `voiceover_list.${lang} length (${voiceover_list[lang].length}) must equal scene count (${sceneCount})`,
          400
        );
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 0: Set plan_status to 'splitting'
    await supabase
      .from('storyboards')
      .update({ plan_status: 'splitting' })
      .eq('id', storyboard_id);

    // Step 1: Create scenes with prompts and voiceovers
    log.info('Creating scenes', { count: sceneCount });
    log.startTiming('create_scenes');

    const sceneIds: string[] = [];
    for (let i = 0; i < sceneCount; i++) {
      const { data: scene, error: sceneError } = await supabase
        .from('scenes')
        .insert({
          storyboard_id,
          order: i,
          prompt: Array.isArray(scene_prompts[i]) ? null : scene_prompts[i],
          multi_prompt: Array.isArray(scene_prompts[i])
            ? scene_prompts[i]
            : null,
          multi_shots: scene_multi_shots?.[i] ?? null,
        })
        .select()
        .single();

      if (sceneError || !scene) {
        log.warn('Failed to insert scene', {
          index: i,
          error: sceneError?.message,
        });
        continue;
      }

      sceneIds.push(scene.id);

      // Create voiceovers for each language
      for (const lang of languages) {
        await supabase.from('voiceovers').insert({
          scene_id: scene.id,
          text: voiceover_list[lang][i],
          language: lang,
          status: 'success',
        });
      }
    }

    log.success('Scenes created', {
      count: sceneIds.length,
      time_ms: log.endTiming('create_scenes'),
    });

    // Step 2: Pre-create objects rows (per-scene, duplicated across scenes)
    log.startTiming('create_objects');
    let objectsCreated = 0;
    for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
      const objectIndices = scene_object_indices[sceneIdx] || [];
      for (let pos = 0; pos < objectIndices.length; pos++) {
        const gridPos = objectIndices[pos];
        await supabase.from('objects').insert({
          grid_image_id: objects_grid_image_id,
          scene_id: sceneIds[sceneIdx],
          scene_order: pos,
          grid_position: gridPos,
          name: object_names[gridPos],
          description: object_descriptions?.[gridPos] ?? null,
          status: 'processing',
        });
        objectsCreated++;
      }
    }
    log.success('Objects created', {
      count: objectsCreated,
      time_ms: log.endTiming('create_objects'),
    });

    // Step 3: Pre-create backgrounds rows (per-scene, duplicated across scenes)
    log.startTiming('create_backgrounds');
    let backgroundsCreated = 0;
    for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
      const bgIndex = scene_bg_indices[sceneIdx];
      await supabase.from('backgrounds').insert({
        grid_image_id: bg_grid_image_id,
        scene_id: sceneIds[sceneIdx],
        grid_position: bgIndex,
        name: background_names[bgIndex],
        status: 'processing',
      });
      backgroundsCreated++;
    }
    log.success('Backgrounds created', {
      count: backgroundsCreated,
      time_ms: log.endTiming('create_backgrounds'),
    });

    // Step 5: Send split requests for both grids
    log.startTiming('split_requests');

    const [objectsSplit, bgSplit] = await Promise.all([
      sendSplitRequest(
        objects_grid_image_url,
        objects_grid_image_id,
        storyboard_id,
        objects_rows,
        objects_cols,
        width,
        height,
        log
      ),
      sendSplitRequest(
        bg_grid_image_url,
        bg_grid_image_id,
        storyboard_id,
        bg_rows,
        bg_cols,
        width,
        height,
        log
      ),
    ]);

    log.info('Split requests sent', {
      objects_request_id: objectsSplit.requestId,
      bg_request_id: bgSplit.requestId,
      objects_error: objectsSplit.error,
      bg_error: bgSplit.error,
      time_ms: log.endTiming('split_requests'),
    });

    // Save split_request_ids
    if (objectsSplit.requestId) {
      await supabase
        .from('grid_images')
        .update({ split_request_id: objectsSplit.requestId })
        .eq('id', objects_grid_image_id);
    }
    if (bgSplit.requestId) {
      await supabase
        .from('grid_images')
        .update({ split_request_id: bgSplit.requestId })
        .eq('id', bg_grid_image_id);
    }

    // If both failed, mark objects/backgrounds as failed
    if (objectsSplit.error && bgSplit.error) {
      await supabase
        .from('objects')
        .update({ status: 'failed' })
        .eq('grid_image_id', objects_grid_image_id);
      await supabase
        .from('backgrounds')
        .update({ status: 'failed' })
        .eq('grid_image_id', bg_grid_image_id);
      await supabase
        .from('storyboards')
        .update({ plan_status: 'failed' })
        .eq('id', storyboard_id);

      log.summary('error', { reason: 'both_split_requests_failed' });
      return errorResponse('Failed to send both split requests');
    }

    log.summary('success', {
      storyboard_id,
      scenes_created: sceneIds.length,
      objects_created: objectsCreated,
      backgrounds_created: backgroundsCreated,
      objects_split_request_id: objectsSplit.requestId,
      bg_split_request_id: bgSplit.requestId,
    });

    return jsonResponse({
      success: true,
      storyboard_id,
      scenes_created: sceneIds.length,
      objects_split_request_id: objectsSplit.requestId,
      bg_split_request_id: bgSplit.requestId,
    });
  } catch (error) {
    log.error('Unexpected error', {
      error: error instanceof Error ? error.message : String(error),
    });
    log.summary('error', { reason: 'unexpected_exception' });
    return errorResponse('Internal server error');
  }
});
