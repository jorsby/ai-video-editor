import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import { createTask, uploadFile } from '@/lib/kieai';
import {
  isProviderRoutingError,
  resolveProvider,
} from '@/lib/provider-routing';
import { getSeries } from '@/lib/supabase/series-service';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';
import { type NextRequest, NextResponse } from 'next/server';

const KIE_IMAGE_MODEL = 'nano-banana-2';

type RouteContext = {
  params: Promise<{ id: string; assetId: string; variantId: string }>;
};

function inferUploadFileName(sourceUrl: string, fallback: string): string {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const candidate = pathname.split('/').pop()?.trim();
    if (candidate && candidate.length > 0) {
      return candidate;
    }
  } catch {
    // Ignore parse errors and use fallback.
  }

  return fallback;
}

/**
 * POST /api/series/{id}/assets/{assetId}/variants/{variantId}/edit-image
 *
 * Edit/inpaint an existing variant image using img2img models.
 * For props that need specific details (text on key card, wax seal on envelope).
 *
 * Body: {
 *   prompt: string,           // edit instruction
 *   model?: string,           // "banana" (default)
 *   image_url?: string,       // source image URL (defaults to current variant image)
 *   resolution?: string,      // "1K" | "2K" (default "1K" for edits)
 * }
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: seriesId, assetId, variantId } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    const apiKeyResult = !sessionUser ? validateApiKey(req) : { valid: false };
    const user =
      sessionUser ??
      (apiKeyResult.valid && apiKeyResult.userId
        ? { id: apiKeyResult.userId }
        : null);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');

    const series = await getSeries(dbClient, seriesId, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const { data: asset } = await dbClient
      .from('series_assets')
      .select('id, type')
      .eq('id', assetId)
      .eq('series_id', seriesId)
      .single();

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // Get current variant image as default source
    const { data: variant } = await dbClient
      .from('series_asset_variants')
      .select('*')
      .eq('id', variantId)
      .eq('asset_id', assetId)
      .single();

    if (!variant) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    }

    if (variant.is_finalized) {
      return NextResponse.json(
        { error: 'Variant is finalized and cannot be edited' },
        { status: 409 }
      );
    }

    const { count: usageCount } = await dbClient
      .from('episode_assets')
      .select('*', { count: 'exact', head: true })
      .eq('asset_id', assetId);

    if ((usageCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'Asset is already mapped to one or more episodes and cannot be edited',
        },
        { status: 409 }
      );
    }

    const body = await req.json();
    const {
      prompt,
      model = 'banana',
      image_url,
      resolution = '1K',
    } = body as {
      prompt: string;
      model?: string;
      image_url?: string;
      resolution?: string;
    };
    const providerResolution = await resolveProvider({
      service: 'image',
      req,
      body,
    });

    if (!prompt) {
      return NextResponse.json(
        { error: 'prompt is required' },
        { status: 400 }
      );
    }

    if (model !== 'banana') {
      return NextResponse.json(
        {
          error:
            'Image editing currently supports only the "banana" model on KIE for this endpoint.',
        },
        { status: 400 }
      );
    }

    // Get source image: explicit URL or current variant image
    let sourceUrl = image_url;
    if (!sourceUrl) {
      const { data: images } = await dbClient
        .from('series_asset_variant_images')
        .select('url')
        .eq('variant_id', variantId)
        .order('created_at', { ascending: false })
        .limit(1);

      sourceUrl = images?.[0]?.url;
    }

    if (!sourceUrl) {
      return NextResponse.json(
        {
          error:
            'No source image found. Generate an image first or provide image_url.',
        },
        { status: 400 }
      );
    }

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    // Build webhook URL
    const callbackPath = '/api/webhook/kieai';
    const webhookUrl = new URL(`${webhookBase}${callbackPath}`);
    webhookUrl.searchParams.set('step', 'SeriesAssetImage');
    webhookUrl.searchParams.set('variant_id', variantId);

    const forcedAspectRatio = asset.type === 'location' ? '9:16' : '1:1';

    let requestId: string | null = null;
    const modelForJob = KIE_IMAGE_MODEL;
    const endpointForResponse = 'https://api.kie.ai/api/v1/jobs/createTask';

    try {
      const uploadedSource = await uploadFile(
        sourceUrl,
        inferUploadFileName(sourceUrl, `${variantId}-source.jpg`)
      );

      const queued = await createTask({
        model: KIE_IMAGE_MODEL,
        callbackUrl: webhookUrl.toString(),
        input: {
          prompt,
          image_input: [uploadedSource.fileUrl],
          aspect_ratio: forcedAspectRatio,
          resolution: resolution.toUpperCase(),
          output_format: 'jpg',
        },
      });

      requestId = queued.taskId;
    } catch (error) {
      console.error('[EditImage] kie.ai failed:', error);
      return NextResponse.json(
        { error: 'Edit request failed' },
        { status: 500 }
      );
    }

    if (!requestId) {
      return NextResponse.json(
        { error: 'Edit request failed' },
        { status: 500 }
      );
    }

    console.log('[EditImage] Submitted', {
      request_id: requestId,
      model: modelForJob,
      endpoint_for_provider: endpointForResponse,
      variant_id: variantId,
      resolution,
      aspect_ratio: forcedAspectRatio,
      provider: providerResolution.provider,
    });

    await dbClient.from('series_generation_jobs').insert({
      series_id: seriesId,
      request_id: requestId,
      type: 'edit',
      prompt,
      model: modelForJob,
      config: {
        provider: providerResolution.provider,
        asset_id: assetId,
        variant_id: variantId,
        resolution,
        aspect_ratio: forcedAspectRatio,
        source_url: sourceUrl,
      },
    });

    return NextResponse.json({
      request_id: requestId,
      model: modelForJob,
      endpoint: endpointForResponse,
      provider: providerResolution.provider,
      variant_id: variantId,
      source_url: sourceUrl,
      prompt,
      resolution,
      aspect_ratio: forcedAspectRatio,
      mode: 'webhook-only',
    });
  } catch (error) {
    if (isProviderRoutingError(error)) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          source: error.source,
          field: error.field,
          service: error.service,
          value: error.value,
        },
        { status: error.statusCode }
      );
    }

    console.error('Edit image error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
