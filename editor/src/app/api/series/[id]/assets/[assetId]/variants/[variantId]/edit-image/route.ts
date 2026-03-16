import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import { getSeries } from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

const FAL_KEY = process.env.FAL_KEY!;

// Models that support image editing on fal.ai
const EDIT_MODELS: Record<string, string> = {
  banana: 'fal-ai/nano-banana-2/edit',
  kling: 'fal-ai/kling-image/o3/image-to-image',
  fibo: 'bria/fibo-edit/edit',
  grok: 'xai/grok-imagine-image/edit',
  'flux-pro': 'fal-ai/flux-2-pro/edit',
};

type RouteContext = {
  params: Promise<{ id: string; assetId: string; variantId: string }>;
};

/**
 * POST /api/series/{id}/assets/{assetId}/variants/{variantId}/edit-image
 *
 * Edit/inpaint an existing variant image using img2img models.
 * For props that need specific details (text on key card, wax seal on envelope).
 *
 * Body: {
 *   prompt: string,           // edit instruction
 *   model?: string,           // "banana" (default), "kling", "fibo", "grok", "flux-pro"
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
      .from('episode_asset_variants')
      .select('*', { count: 'exact', head: true })
      .eq('variant_id', variantId);

    if ((usageCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'Variant is already used in one or more episodes and cannot be edited',
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

    if (!prompt) {
      return NextResponse.json(
        { error: 'prompt is required' },
        { status: 400 }
      );
    }

    const endpoint = EDIT_MODELS[model];
    if (!endpoint) {
      return NextResponse.json(
        {
          error: `model must be one of: ${Object.keys(EDIT_MODELS).join(', ')}`,
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

    // Build webhook URL
    const webhookUrl = new URL(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/fal`
    );
    webhookUrl.searchParams.set('step', 'SeriesAssetImage');
    webhookUrl.searchParams.set('variant_id', variantId);

    // Submit to fal.ai edit endpoint
    const falUrl = new URL(`https://queue.fal.run/${endpoint}`);
    falUrl.searchParams.set('fal_webhook', webhookUrl.toString());

    const falRes = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        image_urls: [sourceUrl],
        resolution,
        output_format: 'jpeg',
        safety_tolerance: '6',
      }),
    });

    if (!falRes.ok) {
      const errText = await falRes.text();
      console.error('[EditImage] fal.ai failed:', falRes.status, errText);
      return NextResponse.json(
        { error: 'Edit request failed' },
        { status: 500 }
      );
    }

    const falData = await falRes.json();
    const requestId = falData.request_id;

    console.log('[EditImage] Submitted', {
      request_id: requestId,
      model,
      endpoint,
      variant_id: variantId,
      resolution,
    });

    await dbClient.from('series_generation_jobs').insert({
      series_id: seriesId,
      request_id: requestId,
      type: 'edit',
      prompt,
      model,
      config: {
        asset_id: assetId,
        variant_id: variantId,
        resolution,
        source_url: sourceUrl,
      },
    });

    // Background poll fallback at 60s
    const pollUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/series/${seriesId}/poll-images`;
    const authHeader = req.headers.get('authorization') ?? '';

    setTimeout(async () => {
      try {
        await fetch(pollUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify({
            jobs: [
              {
                request_id: requestId,
                model: endpoint,
                type: 'single',
                variant_ids: [variantId],
              },
            ],
          }),
        });
      } catch {
        // Fire and forget
      }
    }, 60_000);

    return NextResponse.json({
      request_id: requestId,
      model,
      endpoint,
      variant_id: variantId,
      source_url: sourceUrl,
      prompt,
      poll_fallback: '60s automatic',
    });
  } catch (error) {
    console.error('Edit image error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
