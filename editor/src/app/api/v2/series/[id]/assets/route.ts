import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

type AssetType = 'character' | 'location' | 'prop';

const SERIES_ASSETS_BUCKET = 'series-assets';

function isAssetType(value: string): value is AssetType {
  return value === 'character' || value === 'location' || value === 'prop';
}

function resolveImageUrl(
  db: ReturnType<typeof createServiceClient>,
  image: { url: string | null; storage_path: string | null }
): string | null {
  const rawUrl = image.url ?? null;

  if (
    rawUrl &&
    /^https?:\/\//i.test(rawUrl) &&
    !rawUrl.includes('/object/sign/')
  ) {
    return rawUrl;
  }

  if (image.storage_path) {
    const {
      data: { publicUrl },
    } = db.storage.from(SERIES_ASSETS_BUCKET).getPublicUrl(image.storage_path);

    if (publicUrl) {
      return publicUrl;
    }
  }

  return rawUrl;
}

function pickVariantImageUrl(
  db: ReturnType<typeof createServiceClient>,
  images: Array<{ url: string | null; storage_path: string | null }>
): string | null {
  for (const image of images) {
    const resolvedUrl = resolveImageUrl(db, image);
    if (resolvedUrl) {
      return resolvedUrl;
    }
  }

  return null;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id: seriesId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const typeFilter = req.nextUrl.searchParams.get('type');
    if (typeFilter && !isAssetType(typeFilter)) {
      return NextResponse.json(
        { error: 'type must be one of: character, location, prop' },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');

    const { data: series, error: seriesError } = await db
      .from('series')
      .select('id')
      .eq('id', seriesId)
      .eq('user_id', user.id)
      .single();

    if (seriesError || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    let assetsQuery = db
      .from('series_assets')
      .select(
        'id, name, type, description, tags, series_asset_variants (id, label, description, is_default, is_finalized, finalized_at, created_at, series_asset_variant_images (id, url, storage_path, created_at))'
      )
      .eq('series_id', seriesId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (typeFilter) {
      assetsQuery = assetsQuery.eq('type', typeFilter);
    }

    const { data: assetsData, error: assetsError } = await assetsQuery;

    if (assetsError) {
      return NextResponse.json(
        { error: 'Failed to load series assets' },
        { status: 500 }
      );
    }

    const assets = (assetsData ?? []) as Array<{
      id: string;
      name: string;
      type: AssetType;
      description: string | null;
      tags: string[] | null;
      series_asset_variants: Array<{
        id: string;
        label: string;
        description: string | null;
        is_default: boolean;
        is_finalized: boolean;
        finalized_at: string | null;
        created_at: string;
        series_asset_variant_images: Array<{
          id: string;
          url: string | null;
          storage_path: string | null;
          created_at: string;
        }>;
      }>;
    }>;

    const responseAssets = assets.map((asset) => {
      const variants = (asset.series_asset_variants ?? []).map((variant) => {
        const imageUrl = pickVariantImageUrl(
          db,
          variant.series_asset_variant_images ?? []
        );

        return {
          id: variant.id,
          label: variant.label,
          description: variant.description,
          image_url: imageUrl,
          is_default: variant.is_default,
          is_finalized: variant.is_finalized,
        };
      });

      const referenceImageUrl =
        variants.find((variant) => variant.is_finalized && variant.image_url)
          ?.image_url ??
        variants.find((variant) => variant.is_default && variant.image_url)
          ?.image_url ??
        variants.find((variant) => variant.image_url)?.image_url ??
        null;

      return {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        description: asset.description,
        usage_notes: asset.description,
        tags: asset.tags ?? [],
        reference_image_url: referenceImageUrl,
        variants: variants.map((variant) => ({
          id: variant.id,
          label: variant.label,
          description: variant.description,
          image_url: variant.image_url,
        })),
      };
    });

    return NextResponse.json({ assets: responseAssets });
  } catch (error) {
    console.error('[v2/series/assets] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
