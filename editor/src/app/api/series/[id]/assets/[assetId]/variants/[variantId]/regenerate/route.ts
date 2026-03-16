import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import { getSeries } from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

const FAL_KEY = process.env.FAL_KEY!;
const FAL_MODEL = 'fal-ai/nano-banana-2';

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
      .select('label, description')
      .eq('id', variantId)
      .eq('asset_id', assetId)
      .single();

    if (!variant) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));

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

    // Build webhook URL
    const webhookUrl = new URL(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/fal`
    );
    webhookUrl.searchParams.set('step', 'SeriesAssetImage');
    webhookUrl.searchParams.set('variant_id', variantId);

    // Submit to fal.ai
    const falUrl = new URL(`https://queue.fal.run/${FAL_MODEL}`);
    falUrl.searchParams.set('fal_webhook', webhookUrl.toString());

    const falRes = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        num_images: 1,
        resolution: body.resolution ?? '2K',
        aspect_ratio: asset.type === 'character' ? '3:4' : '16:9',
        output_format: 'jpeg',
        safety_tolerance: '6',
      }),
    });

    if (!falRes.ok) {
      const errText = await falRes.text();
      console.error('[Regenerate] fal.ai failed:', falRes.status, errText);
      return NextResponse.json(
        { error: 'Image generation request failed' },
        { status: 500 }
      );
    }

    const falData = await falRes.json();

    return NextResponse.json({
      request_id: falData.request_id,
      model: FAL_MODEL,
      variant_id: variantId,
      prompt,
    });
  } catch (error) {
    console.error('Regenerate variant error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
