/**
 * POST /api/v2/series/{id}/generate-assets
 *
 * Generates images for series assets (characters, locations, props) using
 * fal-ai/nano-banana-2. Each asset gets its own queued fal.ai job that fires
 * back to the existing SeriesAssetImage webhook step.
 *
 * Body: {
 *   asset_ids?: string[],   // optional – defaults to all assets in the series
 *   resolution?: "0.5k" | "1k" | "2k"  // default "1k"
 * }
 *
 * Response: { jobs: [{ asset_id, fal_request_id, status: "queued" }] }
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

const FAL_ENDPOINT = 'fal-ai/nano-banana-2';

const ASSET_CONFIG: Record<
  'character' | 'location' | 'prop',
  { aspect_ratio: string; suffix: string }
> = {
  character: {
    aspect_ratio: '1:1',
    suffix:
      'Full body, front-facing, neutral solid background, character reference sheet, high detail, consistent design. No text, no labels.',
  },
  location: {
    aspect_ratio: '16:9',
    suffix:
      'Wide establishing shot, cinematic composition, atmospheric lighting. No text, no labels.',
  },
  prop: {
    aspect_ratio: '1:1',
    suffix:
      'Product shot, clean white background, high detail, studio lighting. No text, no labels.',
  },
};

const RESOLUTION_MAP: Record<string, string> = {
  '0.5k': '0.5K',
  '1k': '1K',
  '2k': '2K',
};

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: seriesId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const assetIdsFilter: string[] | undefined = Array.isArray(body?.asset_ids)
      ? (body.asset_ids as unknown[]).filter(
          (v): v is string => typeof v === 'string'
        )
      : undefined;

    const rawResolution =
      typeof body?.resolution === 'string'
        ? body.resolution.toLowerCase()
        : '1k';
    const resolution = RESOLUTION_MAP[rawResolution] ?? '1K';

    const db = createServiceClient('studio');

    // Verify series ownership
    const { data: series, error: seriesError } = await db
      .from('series')
      .select('id, name, genre, tone')
      .eq('id', seriesId)
      .eq('user_id', user.id)
      .single();

    if (seriesError || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    // Fetch assets — optionally filtered by asset_ids
    let assetsQuery = db
      .from('series_assets')
      .select(
        'id, type, name, description, series_asset_variants(id, is_default, description)'
      )
      .eq('series_id', seriesId)
      .order('sort_order', { ascending: true });

    if (assetIdsFilter && assetIdsFilter.length > 0) {
      assetsQuery = assetsQuery.in('id', assetIdsFilter);
    }

    const { data: assets, error: assetsError } = await assetsQuery;

    if (assetsError) {
      console.error('[v2/generate-assets] Failed to load assets:', assetsError);
      return NextResponse.json(
        { error: 'Failed to load series assets' },
        { status: 500 }
      );
    }

    if (!assets || assets.length === 0) {
      return NextResponse.json(
        { error: 'No assets found for this series' },
        { status: 404 }
      );
    }

    const webhookBase =
      process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL!;

    const jobs: Array<{
      asset_id: string;
      fal_request_id: string;
      status: 'queued';
    }> = [];

    const errors: Array<{ asset_id: string; error: string }> = [];

    for (const asset of assets as Array<{
      id: string;
      type: string;
      name: string;
      description: string | null;
      series_asset_variants: Array<{
        id: string;
        is_default: boolean;
        description: string | null;
      }>;
    }>) {
      const assetType = (
        ['character', 'location', 'prop'].includes(asset.type)
          ? asset.type
          : 'character'
      ) as 'character' | 'location' | 'prop';

      const config = ASSET_CONFIG[assetType];

      // Prefer default variant; create one if none exist
      const variants = asset.series_asset_variants ?? [];
      let variant = variants.find((v) => v.is_default) ?? variants[0];

      if (!variant) {
        const { data: createdVariant, error: variantError } = await db
          .from('series_asset_variants')
          .insert({
            asset_id: asset.id,
            label: 'Default',
            is_default: true,
          })
          .select('id, is_default, description')
          .single();

        if (variantError || !createdVariant) {
          errors.push({
            asset_id: asset.id,
            error: 'Failed to create variant',
          });
          continue;
        }
        variant = createdVariant;
      }

      // Build prompt
      const promptParts: string[] = [];
      if (series.genre) promptParts.push(`${series.genre} genre`);
      if (series.tone) promptParts.push(`${series.tone} tone`);
      promptParts.push(asset.name);
      if (asset.description) promptParts.push(asset.description);
      if (variant.description) promptParts.push(variant.description);
      promptParts.push(config.suffix);

      const prompt = promptParts.filter(Boolean).join(', ');

      // Webhook URL — fires SeriesAssetImage step
      const webhookUrl = `${webhookBase}/api/webhook/fal?step=SeriesAssetImage&variant_id=${variant.id}`;

      const falUrl = new URL(`https://queue.fal.run/${FAL_ENDPOINT}`);
      falUrl.searchParams.set('fal_webhook', webhookUrl);

      try {
        const falRes = await fetch(falUrl.toString(), {
          method: 'POST',
          headers: {
            Authorization: `Key ${process.env.FAL_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt,
            num_images: 1,
            resolution,
            aspect_ratio: config.aspect_ratio,
            output_format: 'jpeg',
            safety_tolerance: '6',
          }),
        });

        if (!falRes.ok) {
          const errText = await falRes.text();
          console.error(
            `[v2/generate-assets] fal.ai error for asset ${asset.id}:`,
            errText
          );
          errors.push({
            asset_id: asset.id,
            error: `fal.ai ${falRes.status}: ${errText.slice(0, 100)}`,
          });
          continue;
        }

        const falData = await falRes.json();
        const requestId = falData.request_id as string;

        // Record in series_generation_jobs for webhook lookup
        await db.from('series_generation_jobs').insert({
          series_id: seriesId,
          request_id: requestId,
          type: 'asset_image',
          prompt,
          model: FAL_ENDPOINT,
          config: {
            asset_id: asset.id,
            variant_id: variant.id,
            asset_type: assetType,
            resolution,
          },
        });

        jobs.push({
          asset_id: asset.id,
          fal_request_id: requestId,
          status: 'queued',
        });
      } catch (err) {
        console.error(
          `[v2/generate-assets] Exception for asset ${asset.id}:`,
          err
        );
        errors.push({
          asset_id: asset.id,
          error: err instanceof Error ? err.message : 'Request exception',
        });
      }
    }

    return NextResponse.json({
      jobs,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (error) {
    console.error('[v2/generate-assets] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
