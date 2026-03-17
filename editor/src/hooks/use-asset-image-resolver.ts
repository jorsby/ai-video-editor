import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const SERIES_ASSETS_BUCKET = 'series-assets';

export interface AssetImageMap {
  [variantId: string]: string;
}

interface AssetImageRow {
  variant_id: string;
  url: string | null;
  storage_path: string | null;
}

export interface AssetImageTarget {
  url?: string | null;
  final_url?: string | null;
  series_asset_variant_id?: string | null;
}

export function resolveAssetImageUrl(
  asset: AssetImageTarget | null | undefined,
  assetImageMap: Record<string, string>
): string | null {
  if (!asset) return null;

  const variantId = asset.series_asset_variant_id;
  if (variantId && assetImageMap[variantId]) {
    return assetImageMap[variantId];
  }

  return asset.final_url ?? asset.url ?? null;
}

/**
 * Given a set of variant IDs from scene objects/backgrounds,
 * loads the latest image URL for each from series_asset_variant_images.
 * Returns a map: variantId -> imageUrl
 */
export function useAssetImageResolver(variantIds: string[]): AssetImageMap {
  const [imageMap, setImageMap] = useState<AssetImageMap>({});

  const variantDependencyKey = useMemo(
    () => [...new Set(variantIds.filter(Boolean))].sort().join(','),
    [variantIds.join(',')]
  );

  useEffect(() => {
    const uniqueVariantIds =
      variantDependencyKey.length > 0 ? variantDependencyKey.split(',') : [];

    if (uniqueVariantIds.length === 0) {
      setImageMap({});
      return;
    }

    const supabase = createClient('studio');

    async function resolve() {
      const { data } = await supabase
        .from('series_asset_variant_images')
        .select('variant_id, url, storage_path')
        .in('variant_id', uniqueVariantIds)
        .order('created_at', { ascending: false });

      if (!data) {
        setImageMap({});
        return;
      }

      const map: AssetImageMap = {};

      for (const row of data as AssetImageRow[]) {
        if (map[row.variant_id]) continue;

        const resolvedUrl =
          row.url && /^https?:\/\//i.test(row.url)
            ? row.url
            : row.storage_path
              ? supabase.storage
                  .from(SERIES_ASSETS_BUCKET)
                  .getPublicUrl(row.storage_path).data.publicUrl
              : row.url;

        if (resolvedUrl) {
          map[row.variant_id] = resolvedUrl;
        }
      }

      setImageMap(map);
    }

    resolve();
  }, [variantDependencyKey]);

  return imageMap;
}
