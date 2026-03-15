import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';

type RouteContext = { params: Promise<{ id: string }> };

const ASSET_IMAGE_CONFIG = {
  character: {
    width: 1024,
    height: 1024,
    suffix:
      'Full body, front-facing, neutral solid background, character reference sheet, high detail, consistent design',
  },
  location: {
    width: 1024,
    height: 1024,
    suffix:
      'Wide establishing shot, cinematic composition, atmospheric lighting',
  },
  prop: {
    width: 512,
    height: 512,
    suffix:
      'Product shot, clean white background, high detail, studio lighting',
  },
} as const;

// fal.ai image generation endpoint
const FAL_IMAGE_ENDPOINT = 'fal-ai/flux-pro/v1.1';

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
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

    const body = await req.json();
    const { asset_id, variant_id } = body;

    if (!asset_id || !variant_id) {
      return NextResponse.json(
        { error: 'asset_id and variant_id are required' },
        { status: 400 }
      );
    }

    // Load series (verify ownership)
    const { data: series, error: seriesError } = await dbClient
      .from('series')
      .select('id, name, genre, tone, plan_draft')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (seriesError || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    // Load asset
    const { data: asset, error: assetError } = await dbClient
      .from('series_assets')
      .select('id, type, name, description, tags')
      .eq('id', asset_id)
      .eq('series_id', id)
      .single();

    if (assetError || !asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // Load variant
    const { data: variant, error: variantError } = await dbClient
      .from('series_asset_variants')
      .select('id, label, description')
      .eq('id', variant_id)
      .eq('asset_id', asset_id)
      .single();

    if (variantError || !variant) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    }

    const assetType = asset.type as 'character' | 'location' | 'prop';
    const config =
      ASSET_IMAGE_CONFIG[assetType] ?? ASSET_IMAGE_CONFIG.character;

    // Build prompt from series context + asset info
    const promptParts: string[] = [];

    // Series style context
    if (series.genre) promptParts.push(`${series.genre} genre`);
    if (series.tone) promptParts.push(`${series.tone} tone`);

    // Extract visual style from plan_draft if available
    const planDraft = series.plan_draft as Record<string, unknown> | null;
    if (planDraft?.bible && typeof planDraft.bible === 'string') {
      const biblePreview = planDraft.bible.substring(0, 100);
      if (biblePreview) promptParts.push(`visual style: ${biblePreview}`);
    }

    // Asset-specific info
    promptParts.push(asset.name);
    if (asset.description) promptParts.push(asset.description);
    if (variant.description) promptParts.push(variant.description);

    // Technical requirements
    promptParts.push(config.suffix);

    const prompt = promptParts.filter(Boolean).join(', ');

    // Build webhook URL
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/fal?step=SeriesAssetImage&variant_id=${variant_id}`;

    // Submit to fal.ai queue
    const falUrl = new URL(`https://queue.fal.run/${FAL_IMAGE_ENDPOINT}`);
    falUrl.searchParams.set('fal_webhook', webhookUrl);

    const falRes = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        width: config.width,
        height: config.height,
        num_images: 1,
        enable_safety_checker: false,
        safety_tolerance: '5',
      }),
    });

    if (!falRes.ok) {
      const errText = await falRes.text();
      console.error('fal.ai request failed:', falRes.status, errText);
      return NextResponse.json(
        { error: 'Image generation request failed' },
        { status: 500 }
      );
    }

    const falData = await falRes.json();
    const requestId = falData.request_id;

    return NextResponse.json({ request_id: requestId, prompt });
  } catch (error) {
    console.error('Generate series asset image error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
