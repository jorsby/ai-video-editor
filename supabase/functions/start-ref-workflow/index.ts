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

interface RefWorkflowInput {
  storyboard_id: string;
  project_id: string;

  // Objects grid
  objects_rows: number;
  objects_cols: number;
  objects_grid_prompt: string;
  object_names: string[];

  // Backgrounds grid
  bg_rows: number;
  bg_cols: number;
  backgrounds_grid_prompt: string;
  background_names: string[];

  // Scene data
  scene_prompts: string[];
  scene_bg_indices: number[];
  scene_object_indices: number[][];
  voiceover_list: { en: string[]; tr: string[]; ar: string[] };

  width: number;
  height: number;
  voiceover: string;
  aspect_ratio: string;
}

function validateInput(input: RefWorkflowInput): string | null {
  const {
    storyboard_id,
    project_id,
    objects_rows,
    objects_cols,
    objects_grid_prompt,
    object_names,
    bg_rows,
    bg_cols,
    backgrounds_grid_prompt,
    background_names,
    scene_prompts,
    scene_bg_indices,
    scene_object_indices,
    voiceover_list,
    voiceover,
    aspect_ratio,
  } = input;

  if (
    !storyboard_id ||
    !project_id ||
    !objects_grid_prompt ||
    !backgrounds_grid_prompt ||
    !voiceover ||
    !aspect_ratio
  ) {
    return 'Missing required fields';
  }

  // Validate objects grid
  if (
    !objects_rows ||
    !objects_cols ||
    objects_rows < 2 ||
    objects_rows > 6 ||
    objects_cols < 2 ||
    objects_cols > 6
  ) {
    return 'objects_rows and objects_cols must be integers between 2 and 6';
  }

  const expectedObjects = objects_rows * objects_cols;
  if (!object_names || object_names.length !== expectedObjects) {
    return `object_names length (${object_names?.length}) must equal objects_rows*objects_cols (${expectedObjects})`;
  }

  // Validate backgrounds grid
  if (
    !bg_rows ||
    !bg_cols ||
    bg_rows < 2 ||
    bg_rows > 6 ||
    bg_cols < 2 ||
    bg_cols > 6
  ) {
    return 'bg_rows and bg_cols must be integers between 2 and 6';
  }

  const expectedBgs = bg_rows * bg_cols;
  if (!background_names || background_names.length !== expectedBgs) {
    return `background_names length (${background_names?.length}) must equal bg_rows*bg_cols (${expectedBgs})`;
  }

  // Validate scene data
  if (!scene_prompts || !scene_bg_indices || !scene_object_indices) {
    return 'Missing scene data';
  }

  const sceneCount = scene_prompts.length;
  if (
    scene_bg_indices.length !== sceneCount ||
    scene_object_indices.length !== sceneCount
  ) {
    return 'scene_prompts, scene_bg_indices, scene_object_indices must have same length';
  }

  // Validate voiceover_list
  const languages = ['en', 'tr', 'ar'] as const;
  for (const lang of languages) {
    if (!voiceover_list[lang] || voiceover_list[lang].length !== sceneCount) {
      return `voiceover_list.${lang} length (${voiceover_list[lang]?.length}) must equal scene count (${sceneCount})`;
    }
  }

  return null;
}

interface FalRequestResult {
  requestId: string | null;
  error: string | null;
}

async function sendFalGridRequest(
  prompt: string,
  webhookUrl: string,
  log: ReturnType<typeof createLogger>
): Promise<FalRequestResult> {
  const falUrl = new URL(
    'https://queue.fal.run/workflows/octupost/generategridimage'
  );
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  log.api('fal.ai', 'octupost/generategridimage', {
    prompt_length: prompt.length,
  });
  log.startTiming('fal_request');

  const falResponse = await fetch(falUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt }),
  });

  if (!falResponse.ok) {
    const errorText = await falResponse.text();
    log.error('fal.ai request failed', {
      status: falResponse.status,
      error: errorText,
      time_ms: log.endTiming('fal_request'),
    });
    return {
      requestId: null,
      error: `fal.ai request failed: ${falResponse.status}`,
    };
  }

  const falResult = await falResponse.json();
  log.success('fal.ai request accepted', {
    request_id: falResult.request_id,
    time_ms: log.endTiming('fal_request'),
  });
  return { requestId: falResult.request_id, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const log = createLogger();
  log.setContext({ step: 'StartRefWorkflow' });

  try {
    log.info('Request received', { method: req.method });

    const input: RefWorkflowInput = await req.json();
    const {
      storyboard_id,
      objects_rows,
      objects_cols,
      objects_grid_prompt,
      bg_rows,
      bg_cols,
      backgrounds_grid_prompt,
      width,
      height,
    } = input;

    const validationError = validateInput(input);
    if (validationError) {
      return errorResponse(validationError, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    log.info('Using existing storyboard', { id: storyboard_id });

    // Create objects grid_images record
    const { data: objectsGrid, error: objGridError } = await supabase
      .from('grid_images')
      .insert({
        storyboard_id,
        prompt: objects_grid_prompt,
        status: 'pending',
        type: 'objects',
        detected_rows: objects_rows,
        detected_cols: objects_cols,
        dimension_detection_status: 'success',
      })
      .select()
      .single();

    if (objGridError || !objectsGrid) {
      log.error('Failed to insert objects grid_images', {
        error: objGridError?.message,
      });
      return errorResponse('Failed to create objects grid image record');
    }
    log.success('Objects grid_images created', { id: objectsGrid.id });

    // Create backgrounds grid_images record
    const { data: bgGrid, error: bgGridError } = await supabase
      .from('grid_images')
      .insert({
        storyboard_id,
        prompt: backgrounds_grid_prompt,
        status: 'pending',
        type: 'backgrounds',
        detected_rows: bg_rows,
        detected_cols: bg_cols,
        dimension_detection_status: 'success',
      })
      .select()
      .single();

    if (bgGridError || !bgGrid) {
      log.error('Failed to insert backgrounds grid_images', {
        error: bgGridError?.message,
      });
      return errorResponse('Failed to create backgrounds grid image record');
    }
    log.success('Backgrounds grid_images created', { id: bgGrid.id });

    // Update storyboard to 'generating'
    await supabase
      .from('storyboards')
      .update({ plan_status: 'generating' })
      .eq('id', storyboard_id);

    // Build webhook URLs and send fal.ai requests for both grids
    const objectsWebhookParams = new URLSearchParams({
      step: 'GenGridImage',
      grid_image_id: objectsGrid.id,
      storyboard_id,
      rows: objects_rows.toString(),
      cols: objects_cols.toString(),
      width: width.toString(),
      height: height.toString(),
    });
    const objectsWebhookUrl = `${SUPABASE_URL}/functions/v1/webhook?${objectsWebhookParams.toString()}`;

    const bgWebhookParams = new URLSearchParams({
      step: 'GenGridImage',
      grid_image_id: bgGrid.id,
      storyboard_id,
      rows: bg_rows.toString(),
      cols: bg_cols.toString(),
      width: width.toString(),
      height: height.toString(),
    });
    const bgWebhookUrl = `${SUPABASE_URL}/functions/v1/webhook?${bgWebhookParams.toString()}`;

    // Send both fal.ai requests
    const [objectsResult, bgResult] = await Promise.all([
      sendFalGridRequest(objects_grid_prompt, objectsWebhookUrl, log),
      sendFalGridRequest(backgrounds_grid_prompt, bgWebhookUrl, log),
    ]);

    // Handle failures
    if (objectsResult.error) {
      await supabase
        .from('grid_images')
        .update({ status: 'failed', error_message: 'request_error' })
        .eq('id', objectsGrid.id);
    } else {
      await supabase
        .from('grid_images')
        .update({ status: 'processing', request_id: objectsResult.requestId })
        .eq('id', objectsGrid.id);
    }

    if (bgResult.error) {
      await supabase
        .from('grid_images')
        .update({ status: 'failed', error_message: 'request_error' })
        .eq('id', bgGrid.id);
    } else {
      await supabase
        .from('grid_images')
        .update({ status: 'processing', request_id: bgResult.requestId })
        .eq('id', bgGrid.id);
    }

    // If both failed, set storyboard to failed
    if (objectsResult.error && bgResult.error) {
      await supabase
        .from('storyboards')
        .update({ plan_status: 'failed' })
        .eq('id', storyboard_id);

      log.summary('error', {
        storyboard_id,
        reason: 'both_fal_requests_failed',
      });
      return jsonResponse(
        {
          success: false,
          error: 'Failed to send both generation requests',
          objects_grid_id: objectsGrid.id,
          bg_grid_id: bgGrid.id,
        },
        500
      );
    }

    log.summary('success', {
      storyboard_id,
      objects_grid_id: objectsGrid.id,
      objects_request_id: objectsResult.requestId,
      bg_grid_id: bgGrid.id,
      bg_request_id: bgResult.requestId,
    });

    return jsonResponse({
      success: true,
      storyboard_id,
      objects_grid_id: objectsGrid.id,
      objects_request_id: objectsResult.requestId,
      bg_grid_id: bgGrid.id,
      bg_request_id: bgResult.requestId,
    });
  } catch (error) {
    log.error('Unexpected error', {
      error: error instanceof Error ? error.message : String(error),
    });
    log.summary('error', { reason: 'unexpected_exception' });
    return errorResponse('Internal server error');
  }
});
