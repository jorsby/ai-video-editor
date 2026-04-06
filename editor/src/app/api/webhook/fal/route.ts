import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

/**
 * FAL webhook response shape (from @fal-ai/client WebHookResponse type).
 *
 * Success: { status: "OK", request_id, payload: { images: [{ url, ... }] } }
 * Error:   { status: "ERROR", request_id, error: "...", payload: ... }
 */
interface FalWebhookPayload {
  status: 'OK' | 'ERROR';
  request_id: string;
  error?: string;
  payload?: {
    images?: Array<{ url?: string; content_type?: string; file_name?: string }>;
    description?: string;
    [key: string]: unknown;
  };
}

function okResponse(payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function extractImageUrl(payload: FalWebhookPayload): string | null {
  const images = payload.payload?.images;
  if (!Array.isArray(images) || images.length === 0) return null;

  const first = images[0];
  if (typeof first?.url === 'string' && first.url.length > 0) {
    return first.url;
  }

  return null;
}

/**
 * POST /api/webhook/fal
 *
 * Handles fal.ai queue webhook callbacks for image generation.
 * Query params determine routing:
 *   ?step=VideoAssetImage&variant_id=<uuid>
 */
export async function POST(req: NextRequest) {
  const log = createLogger('webhook/fal');

  try {
    const body = (await req.json()) as FalWebhookPayload;
    const requestId = body.request_id ?? 'unknown';

    const step = req.nextUrl.searchParams.get('step');
    const variantId = req.nextUrl.searchParams.get('variant_id');

    log.info('FAL webhook received', {
      step,
      request_id: requestId,
      status: body.status,
    });

    if (step === 'VideoAssetImage' && variantId) {
      return handleVideoAssetImage({ body, variantId, requestId, log });
    }

    log.warn('Unknown FAL webhook step', { step, request_id: requestId });
    return okResponse({ success: true, ignored: true, reason: 'unknown_step' });
  } catch (error) {
    log.error('FAL webhook error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}

async function handleVideoAssetImage(params: {
  body: FalWebhookPayload;
  variantId: string;
  requestId: string;
  log: ReturnType<typeof createLogger>;
}): Promise<Response> {
  const { body, variantId, requestId, log } = params;
  const supabase = createServiceClient('studio');

  // Error case
  if (body.status === 'ERROR') {
    log.warn('FAL image generation failed', {
      variant_id: variantId,
      request_id: requestId,
      error: body.error,
    });

    await supabase
      .from('project_asset_variants')
      .update({ image_gen_status: 'failed', image_task_id: null })
      .eq('id', variantId);

    return okResponse({
      success: true,
      step: 'VideoAssetImage',
      failed: true,
      reason: body.error ?? 'fal_error',
    });
  }

  // Extract image URL
  const imageUrl = extractImageUrl(body);

  if (!imageUrl) {
    log.warn('FAL image generation completed without image URL', {
      variant_id: variantId,
      request_id: requestId,
    });

    await supabase
      .from('project_asset_variants')
      .update({ image_gen_status: 'failed', image_task_id: null })
      .eq('id', variantId);

    return okResponse({
      success: true,
      step: 'VideoAssetImage',
      failed: true,
      reason: 'missing_image_url',
    });
  }

  // Success — save image URL
  await supabase
    .from('project_asset_variants')
    .update({
      image_url: imageUrl,
      image_gen_status: 'done',
      image_task_id: null,
    })
    .eq('id', variantId);

  log.info('FAL project asset image saved', {
    variant_id: variantId,
    request_id: requestId,
    image_url: imageUrl,
  });

  return okResponse({
    success: true,
    step: 'VideoAssetImage',
    variant_id: variantId,
    url: imageUrl,
  });
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}
