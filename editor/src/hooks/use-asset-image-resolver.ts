import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const SERIES_ASSETS_BUCKET = 'video-assets';

export interface AssetImageMap {
  [variantId: string]: string;
}

interface AssetImageRow {
  id: string;
  image_url: string | null;
}

export interface AssetImageTarget {
  url?: string | null;
  final_url?: string | null;
  series_asset_variant_id?: string | null;
  project_asset_variant_id?: string | null;
}

export function resolveAssetImageUrl(
  asset: AssetImageTarget | null | undefined,
  assetImageMap: Record<string, string>
): string | null {
  if (!asset) return null;

  const variantId =
    asset.project_asset_variant_id ?? asset.series_asset_variant_id;
  if (variantId && assetImageMap[variantId]) {
    return assetImageMap[variantId];
  }

  return asset.final_url ?? asset.url ?? null;
}

/**
 * Given a set of variant IDs from scene objects/backgrounds,
 * loads the latest image URL for each from project_asset_variants.
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
        .from('project_asset_variants')
        .select('id, image_url')
        .in('id', uniqueVariantIds);

      if (!data) {
        setImageMap({});
        return;
      }

      const map: AssetImageMap = {};

      for (const row of data as AssetImageRow[]) {
        if (map[row.id]) continue;
        const resolvedUrl =
          row.image_url && /^https?:\/\//i.test(row.image_url)
            ? row.image_url
            : row.image_url
              ? supabase.storage
                  .from(SERIES_ASSETS_BUCKET)
                  .getPublicUrl(row.image_url).data.publicUrl
              : null;

        if (resolvedUrl) {
          map[row.id] = resolvedUrl;
        }
      }

      setImageMap(map);
    }

    resolve();
  }, [variantDependencyKey]);

  return imageMap;
}
