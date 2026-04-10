import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const SERIES_ASSETS_BUCKET = 'video-assets';

type AssetType = 'character' | 'location' | 'prop';
type GridPromptKey = 'characters' | 'locations' | 'props';

interface VariantRow {
  id: string;
  name: string | null;
  slug: string;
  prompt: string | null;
  image_url: string | null;
  is_main: boolean;
  reasoning: string | null;
  image_gen_status?: string | null;
  // Legacy compatibility flag; canonical schema does not require lock state.
  is_finalized?: boolean | null;
}

interface AssetRow {
  id: string;
  name: string;
  slug: string | null;
  type: string;
  description: string | null;
  sort_order: number | null;
  project_asset_variants: VariantRow[] | null;
}

export interface ProjectAssetVariant {
  id: string;
  label: string;
  slug: string;
  prompt: string | null;
  isMain: boolean;
  isFinalized: boolean;
  imageUrl: string | null;
  imageGenStatus: string | null;
  reasoning: string | null;
}

export interface ProjectAsset {
  id: string;
  name: string;
  slug: string | null;
  type: AssetType;
  description: string | null;
  sortOrder: number | null;
  thumbnailUrl: string | null;
  variants: ProjectAssetVariant[];
}

export interface ProjectGridPrompts {
  character: string;
  location: string;
  prop: string;
}

const DEFAULT_GRID_PROMPTS: ProjectGridPrompts = {
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

interface UseProjectAssetsResult {
  isLoading: boolean;
  error: string | null;
  videoId: string | null;
  assets: ProjectAsset[];
  gridPrompts: ProjectGridPrompts;
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

function resolveGridPrompts(metadata: unknown): ProjectGridPrompts {
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

function resolveStoredUrl(
  supabase: ReturnType<typeof createClient>,
  rawUrl: string | null | undefined
): string | null {
  if (!rawUrl) return null;

  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(SERIES_ASSETS_BUCKET).getPublicUrl(rawUrl);

  return publicUrl || rawUrl;
}

function pickThumbnailUrl(
  supabase: ReturnType<typeof createClient>,
  variants: VariantRow[]
): string | null {
  for (const variant of variants) {
    if (variant.is_main) {
      const url = resolveStoredUrl(supabase, variant.image_url);
      if (url) return url;
    }
  }

  for (const variant of variants) {
    const url = resolveStoredUrl(supabase, variant.image_url);
    if (url) return url;
  }

  return null;
}

export function useProjectAssets(
  projectId: string | null
): UseProjectAssetsResult {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [videoMetadata, setVideoMetadata] = useState<Record<string, unknown>>(
    {}
  );
  const [gridPrompts, setGridPrompts] =
    useState<ProjectGridPrompts>(DEFAULT_GRID_PROMPTS);
  const [isSavingPrompt, setIsSavingPrompt] = useState(INITIAL_ACTION_STATE);
  const [isGeneratingGrid, setIsGeneratingGrid] =
    useState(INITIAL_ACTION_STATE);
  const [generationStatus, setGenerationStatus] = useState(
    INITIAL_GENERATION_STATUS
  );
  const [refreshNonce, setRefreshNonce] = useState(0);
  const initialLoadDoneRef = useRef(false);
  const assetIdsRef = useRef<Set<string>>(new Set());

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
          assetIdsRef.current = new Set();
          setIsLoading(false);
          setError(null);
          setVideoId(null);
          setAssets([]);
          setVideoMetadata({});
          setGridPrompts(DEFAULT_GRID_PROMPTS);
          setGenerationStatus(INITIAL_GENERATION_STATUS);
        }
        return;
      }

      if (!cancelled) {
        // Only show loading spinner on initial load, not on Realtime-triggered refreshes.
        // Realtime refreshes should silently update data without tearing down the UI tree.
        if (!initialLoadDoneRef.current) {
          setIsLoading(true);
        }
        setError(null);
      }

      const supabase = createClient('studio');

      try {
        const { data: videoData, error: videoLoadError } = await supabase
          .from('videos')
          .select('id, creative_brief')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (videoLoadError) {
          throw new Error(videoLoadError.message);
        }

        const linkedVideoId =
          typeof videoData?.id === 'string' ? videoData.id : null;
        const metadata = isRecord(videoData?.creative_brief)
          ? videoData.creative_brief
          : {};

        const { data: assetsData, error: assetsError } = await supabase
          .from('project_assets')
          .select(
            'id, name, slug, type, description, sort_order, project_asset_variants(id, name, slug, prompt, image_url, is_main, reasoning, image_gen_status)'
          )
          .eq('project_id', projectId)
          .order('type', { ascending: true })
          .order('sort_order', { ascending: true });

        if (assetsError) {
          throw new Error(assetsError.message);
        }

        const assetsRows = (assetsData ?? []) as AssetRow[];

        const parsedAssets: ProjectAsset[] = assetsRows.flatMap((asset) => {
          if (!isAssetType(asset.type)) {
            return [];
          }

          const variants = (asset.project_asset_variants ?? []).map(
            (variant) => ({
              id: variant.id,
              label:
                (typeof variant.name === 'string' && variant.name.trim()) ||
                variant.slug,
              slug: variant.slug,
              prompt: variant.prompt ?? null,
              isMain: variant.is_main,
              isFinalized: Boolean(variant.is_finalized),
              imageUrl: resolveStoredUrl(supabase, variant.image_url),
              imageGenStatus: variant.image_gen_status ?? null,
              reasoning: variant.reasoning ?? null,
            })
          );

          return [
            {
              id: asset.id,
              name: asset.name,
              slug: asset.slug ?? null,
              type: asset.type,
              description: asset.description,
              sortOrder: asset.sort_order,
              thumbnailUrl: pickThumbnailUrl(
                supabase,
                asset.project_asset_variants ?? []
              ),
              variants,
            },
          ];
        });

        // Derive generation status from variant image_gen_status (V2 pattern)
        const nextGenerationStatus: Record<AssetType, AssetGenerationStatus> = {
          character: { ...EMPTY_GENERATION_STATUS },
          location: { ...EMPTY_GENERATION_STATUS },
          prop: { ...EMPTY_GENERATION_STATUS },
        };

        for (const asset of parsedAssets) {
          for (const variant of asset.variants) {
            const rawStatus = variant.imageGenStatus;
            if (rawStatus === 'generating') {
              nextGenerationStatus[asset.type].pending += 1;
            } else if (rawStatus === 'failed') {
              nextGenerationStatus[asset.type].stale += 1;
            } else if (variant.imageUrl) {
              nextGenerationStatus[asset.type].completed += 1;
            }
          }
        }

        if (!cancelled) {
          assetIdsRef.current = new Set(parsedAssets.map((asset) => asset.id));
          setVideoId(linkedVideoId);
          setAssets(parsedAssets);
          setVideoMetadata(metadata);
          setGridPrompts(resolveGridPrompts(metadata));
          setGenerationStatus(nextGenerationStatus);
          setIsLoading(false);
          initialLoadDoneRef.current = true;
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load project assets'
          );
          assetIdsRef.current = new Set();
          setVideoId(null);
          setAssets([]);
          setVideoMetadata({});
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
      if (!videoId) {
        return { ok: false, error: 'Video is not linked to this project' };
      }

      const metadataKey = GRID_PROMPT_KEY_BY_TYPE[type];
      const prompt = gridPrompts[type];

      setIsSavingPrompt((prev) => ({ ...prev, [type]: true }));

      try {
        const currentMetadata = isRecord(videoMetadata) ? videoMetadata : {};
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

        const response = await fetch(`/api/videos/${videoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creative_brief: nextMetadata }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to save grid prompt');
        }

        const data = await response.json().catch(() => ({}));
        const returnedMetadata = isRecord(data?.video?.creative_brief)
          ? data.video.creative_brief
          : isRecord(data?.video?.metadata)
            ? data.video.metadata
            : nextMetadata;

        setVideoMetadata(returnedMetadata);
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
    [gridPrompts, videoId, videoMetadata]
  );

  const generateGrid = useCallback(
    async (type: AssetType): Promise<ActionResult> => {
      if (!projectId) {
        return { ok: false, error: 'Project is required' };
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
            asset.variants.find((variant) => variant.isMain)?.id ??
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
          const res = await fetch(
            `/api/v2/variants/${target.variant_id}/generate-image`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            }
          );

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
    [assets, projectId, refresh]
  );

  useEffect(() => {
    if (!projectId) return;

    const supabase = createClient('studio');
    const channel = supabase
      .channel(`project-assets-live-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'video',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          refresh();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'project_assets',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          refresh();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'project_asset_variants',
        },
        (payload) => {
          const assetId =
            (payload.new as { asset_id?: string } | null | undefined)
              ?.asset_id ??
            (payload.old as { asset_id?: string } | null | undefined)
              ?.asset_id ??
            null;

          if (!assetId || !assetIdsRef.current.has(assetId)) return;
          refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, refresh]);

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
    videoId,
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
