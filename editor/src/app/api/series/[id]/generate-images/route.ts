import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';

type RouteContext = { params: Promise<{ id: string }> };

type AssetType = 'character' | 'location' | 'prop';

const ASSET_IMAGE_CONFIG: Record<
  AssetType,
  {
    resolution: '1K';
    aspect_ratio: '3:4' | '1:1';
    suffix: string;
  }
> = {
  character: {
    resolution: '1K',
    aspect_ratio: '3:4',
    suffix:
      'Single character only. Full body visible head-to-toe. Keep entire body in frame. No crop, no close-up portrait, no cut-off limbs. Front-facing reference pose. Neutral clean background. High detail. Consistent design language.',
  },
  location: {
    resolution: '1K',
    aspect_ratio: '1:1',
    suffix:
      'Single location only. Empty environment, no people. Establishing composition, atmospheric but clean readability, high detail.',
  },
  prop: {
    resolution: '1K',
    aspect_ratio: '1:1',
    suffix:
      'Single prop/object only. Entire object fully visible in frame. Centered composition. Neutral clean background. Product-shot clarity, high detail.',
  },
};

// fal.ai image generation endpoint
const FAL_IMAGE_ENDPOINT = 'fal-ai/nano-banana-2';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function pushIfString(target: string[], value: unknown, prefix?: string) {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed) return;
  target.push(prefix ? `${prefix}${trimmed}` : trimmed);
}

function getWebhookBaseUrl(req: NextRequest): string {
  return (
    process.env.WEBHOOK_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    req.nextUrl.origin
  );
}

function buildStyleLock(series: {
  genre: string | null;
  tone: string | null;
  visual_style: unknown;
  metadata: unknown;
}): string[] {
  const styleParts: string[] = [
    'Use a consistent visual style across all assets in this series.',
  ];

  pushIfString(styleParts, series.genre, 'Genre anchor: ');
  pushIfString(styleParts, series.tone, 'Tone anchor: ');

  if (isRecord(series.visual_style)) {
    pushIfString(
      styleParts,
      series.visual_style.visual_style,
      'Visual style: '
    );
    pushIfString(
      styleParts,
      series.visual_style.camera_style,
      'Camera style: '
    );
    pushIfString(styleParts, series.visual_style.lighting, 'Lighting: ');
    pushIfString(styleParts, series.visual_style.mood, 'Mood: ');
  }

  if (isRecord(series.metadata) && isRecord(series.metadata.style)) {
    const style = series.metadata.style;
    pushIfString(styleParts, style.visual_style, 'Visual style: ');
    pushIfString(styleParts, style.camera_style, 'Camera style: ');
    pushIfString(styleParts, style.lighting, 'Lighting: ');
    pushIfString(styleParts, style.mood, 'Mood: ');
    pushIfString(styleParts, style.custom_notes, 'Critical notes: ');
  }

  styleParts.push(
    'Maintain identity consistency with previously generated assets for this same series.'
  );

  return styleParts;
}

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
    const { asset_id, variant_id, prompt: customPrompt } = body;

    if (!asset_id || !variant_id) {
      return NextResponse.json(
        { error: 'asset_id and variant_id are required' },
        { status: 400 }
      );
    }

    // Load series (verify ownership)
    const { data: series, error: seriesError } = await dbClient
      .from('series')
      .select('id, genre, tone, visual_style, metadata')
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

    const assetType = asset.type as AssetType;
    const config =
      ASSET_IMAGE_CONFIG[assetType] ?? ASSET_IMAGE_CONFIG.character;

    // Build prompt — use custom prompt if provided, otherwise auto-generate
    let prompt: string;
    if (typeof customPrompt === 'string' && customPrompt.trim()) {
      prompt = customPrompt.trim();
    } else {
      const promptParts: string[] = [];

      // Style lock (series-wide consistency)
      promptParts.push(...buildStyleLock(series));

      // Asset-specific identity
      promptParts.push(`Asset name: ${asset.name}`);
      if (asset.description)
        promptParts.push(`Asset description: ${asset.description}`);
      if (variant.description)
        promptParts.push(`Variant description: ${variant.description}`);

      // Technical / composition requirements
      promptParts.push(config.suffix);
      promptParts.push(
        'Absolutely no text, no words, no letters, no labels, no watermark.'
      );

      prompt = promptParts.filter(Boolean).join(' ');
    }

    // Build webhook URL
    const webhookBase = getWebhookBaseUrl(req);
    const webhookUrl = `${webhookBase}/api/webhook/fal?step=SeriesAssetImage&variant_id=${variant_id}`;

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
        num_images: 1,
        resolution: config.resolution,
        aspect_ratio: config.aspect_ratio,
        output_format: 'jpeg',
        safety_tolerance: '4',
        limit_generations: true,
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

    // Store generation job so webhook can persist prompt/model metadata
    await dbClient.from('series_generation_jobs').insert({
      series_id: id,
      request_id: requestId,
      type: 'asset_image',
      prompt,
      model: FAL_IMAGE_ENDPOINT,
      config: {
        asset_id,
        variant_id,
        asset_type: assetType,
        resolution: config.resolution,
        aspect_ratio: config.aspect_ratio,
      },
    });

    // Background polling fallback (for cases when webhook URL is unreachable)
    const pollUrl = `${req.nextUrl.origin}/api/series/${id}/poll-images`;
    const authHeader = req.headers.get('authorization') ?? '';
    const fallbackAuth =
      authHeader ||
      (process.env.OCTUPOST_API_KEY
        ? `Bearer ${process.env.OCTUPOST_API_KEY}`
        : '');

    setTimeout(async () => {
      try {
        await fetch(pollUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(fallbackAuth ? { Authorization: fallbackAuth } : {}),
          },
          body: JSON.stringify({
            jobs: [
              {
                request_id: requestId,
                model: FAL_IMAGE_ENDPOINT,
                type: 'single',
                variant_ids: [variant_id],
                cols: 1,
                rows: 1,
              },
            ],
          }),
        });
      } catch (pollError) {
        console.error('[SeriesImage] Background poll failed:', pollError);
      }
    }, 60_000);

    return NextResponse.json({
      request_id: requestId,
      prompt,
      model: FAL_IMAGE_ENDPOINT,
      provider: 'banana',
      resolution: config.resolution,
      aspect_ratio: config.aspect_ratio,
      custom_prompt:
        typeof customPrompt === 'string' && customPrompt.trim().length > 0,
      poll_fallback: '60s automatic',
    });
  } catch (error) {
    console.error('Generate series asset image error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
