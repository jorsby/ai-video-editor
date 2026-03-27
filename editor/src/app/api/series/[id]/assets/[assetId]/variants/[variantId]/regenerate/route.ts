import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import { queueKieImageTask } from '@/lib/kie-image';
import {
  isProviderRoutingError,
  resolveProvider,
} from '@/lib/provider-routing';
import { getSeries } from '@/lib/supabase/series-service';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';
import { type NextRequest, NextResponse } from 'next/server';

const DEFAULT_MODEL = 'nano-banana-2';

type RouteContext = {
  params: Promise<{ id: string; assetId: string; variantId: string }>;
};

/**
 * POST /api/series/{id}/assets/{assetId}/variants/{variantId}/regenerate
 *
 * Regenerate the image for a single variant. Uses the asset + variant
 * descriptions to build a prompt, or accepts a custom prompt override.
 *
 * Body: { prompt?: string, resolution?: string }
 * Returns: { request_id, model, prompt }
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

    // Get asset + variant
    const { data: asset } = await dbClient
      .from('series_assets')
      .select('name, type, description')
      .eq('id', assetId)
      .eq('series_id', seriesId)
      .single();

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

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
        { error: 'Variant is finalized and cannot be regenerated' },
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
            'Asset is already mapped to one or more episodes and cannot be regenerated',
        },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const providerResolution = await resolveProvider({
      service: 'image',
      req,
      body,
    });

    // Build prompt
    let prompt: string;
    if (body.prompt) {
      prompt = body.prompt;
    } else {
      const parts: string[] = [];

      if (asset.type === 'character') {
        parts.push(
          'Single character portrait, front-facing, well-lit, neutral background'
        );
      } else if (asset.type === 'location') {
        parts.push(
          'Wide establishing shot, cinematic composition, atmospheric lighting, no people'
        );
        if (series.genre) parts.push(`${series.genre} genre`);
        if (series.tone) parts.push(`${series.tone} tone`);
      } else {
        parts.push(
          'Clean product shot, centered, neutral background, studio lighting'
        );
      }

      const desc = [asset.description, variant.description]
        .filter(Boolean)
        .join('. ');
      if (desc) parts.push(desc);

      parts.push(
        'Absolutely no text, no words, no letters, no writing, no labels'
      );
      prompt = parts.join('. ');
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

    // Submit to KIE provider
    if (body.model && body.model !== DEFAULT_MODEL) {
      return NextResponse.json(
        {
          error: `Unsupported model "${body.model}". Only "${DEFAULT_MODEL}" is available on KIE for this endpoint.`,
        },
        { status: 400 }
      );
    }

    const res = body.resolution ?? '2K';
    const aspectRatio = asset.type === 'character' ? '3:4' : '16:9';
    let requestId: string | null = null;
    let modelForJob = DEFAULT_MODEL;
    let endpointForResponse = 'https://api.kie.ai/api/v1/jobs/createTask';

    try {
      const queued = await queueKieImageTask({
        prompt,
        callbackUrl: webhookUrl.toString(),
        aspectRatio,
        resolution: res,
        outputFormat: 'jpg',
      });
      requestId = queued.requestId;
      modelForJob = queued.model;
      endpointForResponse = queued.endpoint;
    } catch (error) {
      console.error('[Regenerate] kie.ai failed:', error);
      return NextResponse.json(
        { error: 'Image generation request failed' },
        { status: 500 }
      );
    }

    if (!requestId) {
      return NextResponse.json(
        { error: 'Image generation request failed' },
        { status: 500 }
      );
    }

    await dbClient.from('series_generation_jobs').insert({
      series_id: seriesId,
      request_id: requestId,
      type: 'single',
      prompt,
      model: modelForJob,
      config: {
        provider: providerResolution.provider,
        asset_id: assetId,
        variant_id: variantId,
        resolution: res,
        aspect_ratio: aspectRatio,
      },
    });

    return NextResponse.json({
      request_id: requestId,
      model: modelForJob,
      endpoint: endpointForResponse,
      provider: providerResolution.provider,
      variant_id: variantId,
      prompt,
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

    console.error('Regenerate variant error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
