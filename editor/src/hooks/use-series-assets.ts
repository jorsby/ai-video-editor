import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const SERIES_ASSETS_BUCKET = 'series-assets';

type AssetType = 'character' | 'location' | 'prop';

interface VariantImageRow {
  url: string | null;
  storage_path: string | null;
}

interface VariantRow {
  id: string;
  label: string;
  is_default: boolean;
  is_finalized: boolean;
  series_asset_variant_images: VariantImageRow[] | null;
}

interface AssetRow {
  id: string;
  name: string;
  type: string;
  description: string | null;
  sort_order: number | null;
  series_asset_variants: VariantRow[] | null;
}

export interface SeriesAssetVariant {
  id: string;
  label: string;
  isDefault: boolean;
  isFinalized: boolean;
  imageUrl: string | null;
}

export interface SeriesAsset {
  id: string;
  name: string;
  type: AssetType;
  description: string | null;
  sortOrder: number | null;
  thumbnailUrl: string | null;
  variants: SeriesAssetVariant[];
}

interface UseSeriesAssetsResult {
  isLoading: boolean;
  error: string | null;
  seriesId: string | null;
  assets: SeriesAsset[];
}

function isAssetType(value: string): value is AssetType {
  return value === 'character' || value === 'location' || value === 'prop';
}

function resolveImageUrl(
  supabase: ReturnType<typeof createClient>,
  image: VariantImageRow
): string | null {
  const rawUrl = image.url ?? null;

  if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  const storagePath = image.storage_path ?? rawUrl;

  if (storagePath) {
    const {
      data: { publicUrl },
    } = supabase.storage.from(SERIES_ASSETS_BUCKET).getPublicUrl(storagePath);

    if (publicUrl) {
      return publicUrl;
    }
  }

  return rawUrl;
}

function pickFirstImageUrl(
  supabase: ReturnType<typeof createClient>,
  images: VariantImageRow[]
): string | null {
  for (const image of images) {
    const url = resolveImageUrl(supabase, image);
    if (url) {
      return url;
    }
  }

  return null;
}

function pickThumbnailUrl(
  supabase: ReturnType<typeof createClient>,
  variants: VariantRow[]
): string | null {
  for (const variant of variants) {
    if (variant.is_finalized) {
      const url = pickFirstImageUrl(
        supabase,
        variant.series_asset_variant_images ?? []
      );
      if (url) {
        return url;
      }
    }
  }

  for (const variant of variants) {
    if (variant.is_default) {
      const url = pickFirstImageUrl(
        supabase,
        variant.series_asset_variant_images ?? []
      );
      if (url) {
        return url;
      }
    }
  }

  for (const variant of variants) {
    const url = pickFirstImageUrl(
      supabase,
      variant.series_asset_variant_images ?? []
    );
    if (url) {
      return url;
    }
  }

  return null;
}

export function useSeriesAssets(
  projectId: string | null
): UseSeriesAssetsResult {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [assets, setAssets] = useState<SeriesAsset[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadAssets() {
      if (!projectId) {
        if (!cancelled) {
          setIsLoading(false);
          setError(null);
          setSeriesId(null);
          setAssets([]);
        }
        return;
      }

      if (!cancelled) {
        setIsLoading(true);
        setError(null);
      }

      const supabase = createClient('studio');

      try {
        // Step 1: Find series ID via project settings or series.project_id
        let foundSeriesId: string | null = null;

        // Try project settings first (has series_id from create-project)
        const projRes = await fetch(`/api/projects/${projectId}`);
        if (projRes.ok) {
          const projData = await projRes.json();
          const settings = projData?.project?.settings as Record<
            string,
            unknown
          > | null;
          if (settings?.series_id && typeof settings.series_id === 'string') {
            foundSeriesId = settings.series_id;
          }
        }

        // Fallback: query series.project_id
        if (!foundSeriesId) {
          const { data: series, error: seriesError } = await supabase
            .from('series')
            .select('id')
            .eq('project_id', projectId)
            .limit(1)
            .maybeSingle();

          if (!seriesError && series?.id) {
            foundSeriesId = series.id;
          }
        }

        if (!foundSeriesId) {
          if (!cancelled) {
            setSeriesId(null);
            setAssets([]);
            setIsLoading(false);
          }
          return;
        }

        const { data: assetsData, error: assetsError } = await supabase
          .from('series_assets')
          .select(
            'id, name, type, description, sort_order, series_asset_variants(id, label, is_default, is_finalized, series_asset_variant_images(url, storage_path))'
          )
          .eq('series_id', foundSeriesId)
          .order('type', { ascending: true })
          .order('sort_order', { ascending: true });

        if (assetsError) {
          throw new Error(assetsError.message);
        }

        const parsedAssets: SeriesAsset[] = (
          (assetsData ?? []) as AssetRow[]
        ).flatMap((asset) => {
          if (!isAssetType(asset.type)) {
            return [];
          }

          const variants = (asset.series_asset_variants ?? []).map(
            (variant) => ({
              id: variant.id,
              label: variant.label,
              isDefault: variant.is_default,
              isFinalized: variant.is_finalized,
              imageUrl: pickFirstImageUrl(
                supabase,
                variant.series_asset_variant_images ?? []
              ),
            })
          );

          return [
            {
              id: asset.id,
              name: asset.name,
              type: asset.type,
              description: asset.description,
              sortOrder: asset.sort_order,
              thumbnailUrl: pickThumbnailUrl(
                supabase,
                asset.series_asset_variants ?? []
              ),
              variants,
            },
          ];
        });

        if (!cancelled) {
          setSeriesId(foundSeriesId);
          setAssets(parsedAssets);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load series assets'
          );
          setSeriesId(null);
          setAssets([]);
          setIsLoading(false);
        }
      }
    }

    loadAssets();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return {
    isLoading,
    error,
    seriesId,
    assets,
  };
}
