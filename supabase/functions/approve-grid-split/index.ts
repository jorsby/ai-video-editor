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

interface ApproveGridInput {
  storyboard_id: string;
  grid_image_id: string;
  grid_image_url: string;
  rows: number;
  cols: number;
  width: number;
  height: number;
  voiceover_list: Record<string, string[]>;
  visual_prompt_list: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return corsResponse();
  }

  const log = createLogger();
  log.setContext({ step: 'ApproveGridSplit' });

  try {
    log.info('Request received', { method: req.method });

    const input: ApproveGridInput = await req.json();
    const {
      storyboard_id,
      grid_image_id,
      grid_image_url,
      rows,
      cols,
      width,
      height,
      voiceover_list,
      visual_prompt_list,
    } = input;

    // Validate required fields
    if (!storyboard_id || !grid_image_id || !grid_image_url) {
      return errorResponse('Missing required fields', 400);
    }

    if (!rows || !cols || rows < 2 || rows > 8 || cols < 2 || cols > 8) {
      return errorResponse(
        'rows and cols must be integers between 2 and 8',
        400
      );
    }

    const expectedScenes = rows * cols;
    const languages = Object.keys(voiceover_list);
    if (languages.length === 0) {
      return errorResponse('voiceover_list must have at least one language', 400);
    }
    for (const lang of languages) {
      if (voiceover_list[lang].length !== expectedScenes) {
        return errorResponse(
          `voiceover_list.${lang} length (${voiceover_list[lang].length}) must equal rows*cols (${expectedScenes})`,
          400
        );
      }
    }
    if (visual_prompt_list.length !== expectedScenes) {
      return errorResponse(
        `visual_prompt_list length (${visual_prompt_list.length}) must equal rows*cols (${expectedScenes})`,
        400
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Create scenes with first_frames and voiceovers
    log.info('Creating scenes', { count: expectedScenes });
    log.startTiming('create_scenes');

    for (let i = 0; i < expectedScenes; i++) {
      const { data: scene, error: sceneError } = await supabase
        .from('scenes')
        .insert({ storyboard_id, order: i })
        .select()
        .single();

      if (sceneError || !scene) {
        log.warn('Failed to insert scene', {
          index: i,
          error: sceneError?.message,
        });
        continue;
      }

      await supabase.from('first_frames').insert({
        scene_id: scene.id,
        grid_image_id,
        visual_prompt: visual_prompt_list[i],
        status: 'processing',
      });

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
      count: expectedScenes,
      time_ms: log.endTiming('create_scenes'),
    });

    // Send split request to ComfyUI
    const splitWebhookParams = new URLSearchParams({
      step: 'SplitGridImage',
      grid_image_id: grid_image_id,
      storyboard_id: storyboard_id,
    });
    const splitWebhookUrl = `${SUPABASE_URL}/functions/v1/webhook?${splitWebhookParams.toString()}`;

    const falUrl = new URL(
      'https://queue.fal.run/comfy/octupost/splitgridimage'
    );
    falUrl.searchParams.set('fal_webhook', splitWebhookUrl);

    try {
      log.api('ComfyUI', 'splitgridimage', { rows, cols, width, height });
      log.startTiming('split_request');

      const splitResponse = await fetch(falUrl.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Key ${FAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          loadimage_1: grid_image_url,
          rows,
          cols,
          width,
          height,
        }),
      });

      if (!splitResponse.ok) {
        const errorText = await splitResponse.text();
        log.error('Split request failed', {
          status: splitResponse.status,
          error: errorText,
          time_ms: log.endTiming('split_request'),
        });
        throw new Error(`Split request failed: ${splitResponse.status}`);
      }

      const splitResult = await splitResponse.json();
      log.success('Split request sent', {
        request_id: splitResult.request_id,
        time_ms: log.endTiming('split_request'),
      });

      // Save split_request_id to grid_images for tracking
      await supabase
        .from('grid_images')
        .update({ split_request_id: splitResult.request_id })
        .eq('id', grid_image_id);

      log.summary('success', {
        storyboard_id,
        grid_image_id,
        scenes_created: expectedScenes,
        split_request_id: splitResult.request_id,
      });

      return jsonResponse({
        success: true,
        storyboard_id,
        grid_image_id,
        scenes_created: expectedScenes,
        request_id: splitResult.request_id,
      });
    } catch (splitError) {
      log.error('Failed to send split request', {
        error:
          splitError instanceof Error ? splitError.message : String(splitError),
      });

      // Mark all first_frames as failed
      log.startTiming('mark_frames_failed');
      const { data: scenes } = await supabase
        .from('scenes')
        .select('id')
        .eq('storyboard_id', storyboard_id);

      if (scenes) {
        for (const scene of scenes) {
          await supabase
            .from('first_frames')
            .update({ status: 'failed', error_message: 'internal_error' })
            .eq('scene_id', scene.id);
        }
        log.warn('Marked first_frames as failed', {
          scenes_affected: scenes.length,
          time_ms: log.endTiming('mark_frames_failed'),
        });
      }

      log.summary('error', { grid_image_id, reason: 'split_request_failed' });
      return errorResponse('Failed to send split request');
    }
  } catch (error) {
    log.error('Unexpected error', {
      error: error instanceof Error ? error.message : String(error),
    });
    log.summary('error', { reason: 'unexpected_exception' });
    return errorResponse('Internal server error');
  }
});
