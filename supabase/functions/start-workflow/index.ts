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

interface WorkflowInput {
  storyboard_id: string;
  project_id: string;
  rows: number;
  cols: number;
  grid_image_prompt: string;
  voiceover_list: Record<string, string[]>;
  visual_prompt_list: string[];
  sfx_prompt_list?: string[];
  width: number;
  height: number;
  voiceover: string;
  aspect_ratio: string;
}

function validateInput(input: WorkflowInput): string | null {
  const {
    storyboard_id,
    project_id,
    rows,
    cols,
    grid_image_prompt,
    voiceover_list,
    visual_prompt_list,
    voiceover,
    aspect_ratio,
  } = input;

  if (
    !storyboard_id ||
    !project_id ||
    !grid_image_prompt ||
    !voiceover_list ||
    !visual_prompt_list ||
    !voiceover ||
    !aspect_ratio
  ) {
    return 'Missing required fields';
  }

  // Validate rows/cols
  if (!rows || !cols || rows < 2 || rows > 8 || cols < 2 || cols > 8) {
    return 'rows and cols must be integers between 2 and 8';
  }
  if (rows !== cols && rows !== cols + 1) {
    return 'rows must equal cols or cols + 1';
  }

  // voiceover_list and visual_prompt_list must match grid dimensions
  const expectedScenes = rows * cols;
  const languages = Object.keys(voiceover_list);
  if (languages.length === 0)
    return 'voiceover_list must have at least one language';
  for (const lang of languages) {
    if (voiceover_list[lang].length !== expectedScenes) {
      return `voiceover_list.${lang} length must equal rows*cols (${expectedScenes})`;
    }
  }
  if (visual_prompt_list.length !== expectedScenes) {
    return `visual_prompt_list length (${visual_prompt_list.length}) must equal rows*cols (${expectedScenes})`;
  }

  return null;
}

interface FalRequestResult {
  requestId: string | null;
  error: string | null;
}

async function sendFalRequest(
  falUrl: URL,
  prompt: string,
  log: ReturnType<typeof createLogger>
): Promise<FalRequestResult> {
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
    body: JSON.stringify({
      prompt,
    }),
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
  log.setContext({ step: 'StartWorkflow' });

  try {
    log.info('Request received', { method: req.method });

    const input: WorkflowInput = await req.json();
    const { storyboard_id, rows, cols, grid_image_prompt, width, height } =
      input;

    const validationError = validateInput(input);
    if (validationError) {
      return errorResponse(validationError, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    log.info('Using existing storyboard', { id: storyboard_id });

    // Create grid_images record with rows/cols from plan
    const { data: gridImage, error: gridInsertError } = await supabase
      .from('grid_images')
      .insert({
        storyboard_id,
        prompt: grid_image_prompt,
        status: 'pending',
        detected_rows: rows,
        detected_cols: cols,
        dimension_detection_status: 'success',
      })
      .select()
      .single();

    if (gridInsertError || !gridImage) {
      log.error('Failed to insert grid_images', {
        error: gridInsertError?.message,
      });
      return errorResponse('Failed to create grid image record');
    }

    const grid_image_id = gridImage.id;
    log.success('grid_images created', { id: grid_image_id });

    // Build webhook URL and send fal.ai request
    const webhookParams = new URLSearchParams({
      step: 'GenGridImage',
      grid_image_id,
      storyboard_id,
      rows: rows.toString(),
      cols: cols.toString(),
      width: width.toString(),
      height: height.toString(),
    });
    const webhookUrl = `${SUPABASE_URL}/functions/v1/webhook?${webhookParams.toString()}`;
    const falUrl = new URL(
      'https://queue.fal.run/workflows/octupost/generategridimage'
    );
    falUrl.searchParams.set('fal_webhook', webhookUrl);

    const falResult = await sendFalRequest(falUrl, grid_image_prompt, log);
    if (falResult.error) {
      await supabase
        .from('grid_images')
        .update({ status: 'failed', error_message: 'request_error' })
        .eq('id', grid_image_id);
      log.summary('error', { grid_image_id, reason: 'fal_request_failed' });
      return jsonResponse(
        {
          success: false,
          error: 'Failed to send generation request',
          grid_image_id,
        },
        500
      );
    }

    const requestId = falResult.requestId;
    await supabase
      .from('grid_images')
      .update({ status: 'processing', request_id: requestId })
      .eq('id', grid_image_id);

    // Scenes will be created in webhook after grid dimension detection

    log.summary('success', {
      storyboard_id,
      grid_image_id,
      request_id: requestId,
    });

    return jsonResponse({
      success: true,
      storyboard_id,
      grid_image_id,
      request_id: requestId,
    });
  } catch (error) {
    log.error('Unexpected error', {
      error: error instanceof Error ? error.message : String(error),
    });
    log.summary('error', { reason: 'unexpected_exception' });
    return errorResponse('Internal server error');
  }
});
