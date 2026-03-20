import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const SERIES_ASSETS_BUCKET = 'series-assets';

type AssetType = 'character' | 'location' | 'prop';
type GridPromptKey = 'characters' | 'locations' | 'props';

interface VariantImageRow {
  url: string | null;
  storage_path: string | null;
  metadata?: Record<string, unknown> | null;
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

export interface SeriesGridPrompts {
  character: string;
  location: string;
  prop: string;
}

const DEFAULT_GRID_PROMPTS: SeriesGridPrompts = {
  character:
    'Photorealistic cinematic style with natural skin texture. Each cell shows one character on a neutral white background, front-facing, full body visible from head to shoes. Each character must show their complete outfit clearly visible.',
  location:
    'Photorealistic cinematic style. Each cell shows one empty environment/location with no people, with varied cinematic camera angles. Locations should feel lived-in and atmospheric with natural lighting and environmental details.',
  prop: 'Product photography style. Each cell shows one object/prop on a clean neutral background. Centered composition, studio lighting, high detail.',
};

const GRID_PROMPT_KEY_BY_TYPE: Record<AssetType, GridPromptKey> = {
  character: 'characters',
  location: 'locations',
  prop: 'props',
};

const INITIAL_ACTION_STATE: Record<AssetType, boolean> = {
  character: false,
  location: false,
  prop: false,
};

const EMPTY_GENERATION_STATUS: AssetGenerationStatus = {
  pending: 0,
  completed: 0,
  stale: 0,
};

const INITIAL_GENERATION_STATUS: Record<AssetType, AssetGenerationStatus> = {
  character: { ...EMPTY_GENERATION_STATUS },
  location: { ...EMPTY_GENERATION_STATUS },
  prop: { ...EMPTY_GENERATION_STATUS },
};

interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface AssetGenerationStatus {
  pending: number;
  completed: number;
  stale: number;
}

interface UseSeriesAssetsResult {
  isLoading: boolean;
  error: string | null;
  seriesId: string | null;
  assets: SeriesAsset[];
  gridPrompts: SeriesGridPrompts;
  isSavingPrompt: Record<AssetType, boolean>;
  isGeneratingGrid: Record<AssetType, boolean>;
  generationStatus: Record<AssetType, AssetGenerationStatus>;
  setGridPrompt: (type: AssetType, value: string) => void;
  saveGridPrompt: (type: AssetType) => Promise<ActionResult>;
  generateGrid: (type: AssetType) => Promise<ActionResult>;
  refresh: () => void;
}

function isAssetType(value: string): value is AssetType {
  return value === 'character' || value === 'location' || value === 'prop';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toPromptValue(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value;
}

function resolveGridPrompts(metadata: unknown): SeriesGridPrompts {
  if (!isRecord(metadata) || !isRecord(metadata.grid_prompts)) {
    return DEFAULT_GRID_PROMPTS;
  }

  const rawPrompts = metadata.grid_prompts;

  return {
    character: toPromptValue(
      rawPrompts.characters,
      DEFAULT_GRID_PROMPTS.character
    ),
    location: toPromptValue(
      rawPrompts.locations,
      DEFAULT_GRID_PROMPTS.location
    ),
    prop: toPromptValue(rawPrompts.props, DEFAULT_GRID_PROMPTS.prop),
  };
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
  const [seriesMetadata, setSeriesMetadata] = useState<Record<string, unknown>>(
    {}
  );
  const [gridPrompts, setGridPrompts] =
    useState<SeriesGridPrompts>(DEFAULT_GRID_PROMPTS);
  const [isSavingPrompt, setIsSavingPrompt] = useState(INITIAL_ACTION_STATE);
  const [isGeneratingGrid, setIsGeneratingGrid] =
    useState(INITIAL_ACTION_STATE);
  const [generationStatus, setGenerationStatus] = useState(
    INITIAL_GENERATION_STATUS
  );
  const [refreshNonce, setRefreshNonce] = useState(0);

  const refresh = useCallback(() => {
    setRefreshNonce((prev) => prev + 1);
  }, []);

  const setGridPrompt = useCallback((type: AssetType, value: string) => {
    setGridPrompts((prev) => ({
      ...prev,
      [type]: value,
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAssets() {
      if (!projectId) {
        if (!cancelled) {
          setIsLoading(false);
          setError(null);
          setSeriesId(null);
          setAssets([]);
          setSeriesMetadata({});
          setGridPrompts(DEFAULT_GRID_PROMPTS);
          setGenerationStatus(INITIAL_GENERATION_STATUS);
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
            setSeriesMetadata({});
            setGridPrompts(DEFAULT_GRID_PROMPTS);
            setGenerationStatus(INITIAL_GENERATION_STATUS);
            setIsLoading(false);
          }
          return;
        }

        const { data: seriesData, error: seriesLoadError } = await supabase
          .from('series')
          .select('metadata')
          .eq('id', foundSeriesId)
          .maybeSingle();

        if (seriesLoadError) {
          throw new Error(seriesLoadError.message);
        }

        const metadata = isRecord(seriesData?.metadata)
          ? seriesData.metadata
          : {};

        const { data: assetsData, error: assetsError } = await supabase
          .from('series_assets')
          .select(
            'id, name, type, description, sort_order, series_asset_variants(id, label, is_default, is_finalized, series_asset_variant_images(url, storage_path, metadata))'
          )
          .eq('series_id', foundSeriesId)
          .order('type', { ascending: true })
          .order('sort_order', { ascending: true });

        if (assetsError) {
          throw new Error(assetsError.message);
        }

        const assetsRows = (assetsData ?? []) as AssetRow[];

        const savedRequestIds = new Set<string>();
        for (const asset of assetsRows) {
          for (const variant of asset.series_asset_variants ?? []) {
            for (const image of variant.series_asset_variant_images ?? []) {
              const requestId = image?.metadata?.fal_request_id;
              if (typeof requestId === 'string' && requestId.trim()) {
                savedRequestIds.add(requestId.trim());
              }
            }
          }
        }

        const { data: jobsData } = await supabase
          .from('series_generation_jobs')
          .select('request_id, created_at, config')
          .eq('series_id', foundSeriesId)
          .eq('type', 'asset_image')
          .order('created_at', { ascending: false })
          .limit(300);

        const nextGenerationStatus: Record<AssetType, AssetGenerationStatus> = {
          character: { ...EMPTY_GENERATION_STATUS },
          location: { ...EMPTY_GENERATION_STATUS },
          prop: { ...EMPTY_GENERATION_STATUS },
        };

        const staleThresholdMs = 20 * 60 * 1000;

        for (const job of (jobsData ?? []) as Array<{
          request_id: string;
          created_at: string;
          config: Record<string, unknown> | null;
        }>) {
          const assetTypeRaw =
            isRecord(job.config) && typeof job.config.asset_type === 'string'
              ? job.config.asset_type
              : null;

          if (!assetTypeRaw || !isAssetType(assetTypeRaw)) {
            continue;
          }

          if (savedRequestIds.has(job.request_id)) {
            nextGenerationStatus[assetTypeRaw].completed += 1;
            continue;
          }

          const createdAtMs = Number(new Date(job.created_at));
          const isStale =
            Number.isFinite(createdAtMs) &&
            Date.now() - createdAtMs > staleThresholdMs;

          if (isStale) {
            nextGenerationStatus[assetTypeRaw].stale += 1;
          } else {
            nextGenerationStatus[assetTypeRaw].pending += 1;
          }
        }

        const parsedAssets: SeriesAsset[] = assetsRows.flatMap((asset) => {
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
          setSeriesMetadata(metadata);
          setGridPrompts(resolveGridPrompts(metadata));
          setGenerationStatus(nextGenerationStatus);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load series assets'
          );
          setSeriesId(null);
          setAssets([]);
          setSeriesMetadata({});
          setGridPrompts(DEFAULT_GRID_PROMPTS);
          setGenerationStatus(INITIAL_GENERATION_STATUS);
          setIsLoading(false);
        }
      }
    }

    loadAssets();

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshNonce]);

  const saveGridPrompt = useCallback(
    async (type: AssetType): Promise<ActionResult> => {
      if (!seriesId) {
        return { ok: false, error: 'Series is not linked to this project' };
      }

      const metadataKey = GRID_PROMPT_KEY_BY_TYPE[type];
      const prompt = gridPrompts[type];

      setIsSavingPrompt((prev) => ({ ...prev, [type]: true }));

      try {
        const currentMetadata = isRecord(seriesMetadata) ? seriesMetadata : {};
        const currentGridPrompts = isRecord(currentMetadata.grid_prompts)
          ? currentMetadata.grid_prompts
          : {};

        const nextMetadata = {
          ...currentMetadata,
          grid_prompts: {
            ...currentGridPrompts,
            [metadataKey]: prompt,
          },
        };

        const response = await fetch(`/api/series/${seriesId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metadata: nextMetadata }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to save grid prompt');
        }

        const data = await response.json().catch(() => ({}));
        const returnedMetadata = isRecord(data?.series?.metadata)
          ? data.series.metadata
          : nextMetadata;

        setSeriesMetadata(returnedMetadata);
        setGridPrompts(resolveGridPrompts(returnedMetadata));

        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : 'Failed to save grid prompt',
        };
      } finally {
        setIsSavingPrompt((prev) => ({ ...prev, [type]: false }));
      }
    },
    [gridPrompts, seriesId, seriesMetadata]
  );

  const generateGrid = useCallback(
    async (type: AssetType): Promise<ActionResult> => {
      if (!seriesId) {
        return { ok: false, error: 'Series is not linked to this project' };
      }

      const sectionAssets = assets.filter((asset) => asset.type === type);

      if (sectionAssets.length === 0) {
        return {
          ok: false,
          error: `No ${
            type === 'character'
              ? 'characters'
              : type === 'location'
                ? 'locations'
                : 'props'
          } to generate`,
        };
      }

      const generationTargets = sectionAssets
        .map((asset) => ({
          asset_id: asset.id,
          variant_id:
            asset.variants.find((variant) => variant.isDefault)?.id ??
            asset.variants[0]?.id ??
            null,
          isFinalized: asset.variants.some((variant) => variant.isFinalized),
        }))
        .filter((item) => !!item.variant_id && !item.isFinalized)
        .map((item) => ({
          asset_id: item.asset_id,
          variant_id: item.variant_id as string,
        }));

      if (generationTargets.length === 0) {
        return {
          ok: false,
          error: 'All assets are finalized or missing variants',
        };
      }

      setIsGeneratingGrid((prev) => ({ ...prev, [type]: true }));

      try {
        // Serialize requests to avoid burst rate-limit and keep order predictable
        for (const target of generationTargets) {
          const res = await fetch(`/api/series/${seriesId}/generate-images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              asset_id: target.asset_id,
              variant_id: target.variant_id,
            }),
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Asset image generation failed');
          }
        }

        setTimeout(refresh, 60_000);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'Asset image generation failed',
        };
      } finally {
        setIsGeneratingGrid((prev) => ({ ...prev, [type]: false }));
      }
    },
    [assets, refresh, seriesId]
  );

  const totalPending =
    generationStatus.character.pending +
    generationStatus.location.pending +
    generationStatus.prop.pending;

  useEffect(() => {
    if (totalPending <= 0) return;

    const timer = window.setInterval(() => {
      refresh();
    }, 8000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refresh, totalPending]);

  return {
    isLoading,
    error,
    seriesId,
    assets,
    gridPrompts,
    isSavingPrompt,
    isGeneratingGrid,
    generationStatus,
    setGridPrompt,
    saveGridPrompt,
    generateGrid,
    refresh,
  };
}
