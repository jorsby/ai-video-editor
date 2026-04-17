import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const SERIES_ASSETS_BUCKET = 'video-assets';

type AssetType = 'character' | 'location' | 'prop';
type GridPromptKey = 'characters' | 'locations' | 'props';

interface VariantRow {
  id: string;
  name: string | null;
  slug: string;
  structured_prompt: Record<string, unknown> | null;
  use_case: string | null;
  image_url: string | null;
  is_main: boolean;
  image_gen_status?: string | null;
}

interface AssetRow {
  id: string;
  name: string;
  slug: string | null;
  type: AssetType;
  structured_prompt: Record<string, unknown> | null;
  use_case: string | null;
  sort_order: number | null;
  video_id: string | null;
  variants: VariantRow[];
}

const TYPED_TABLES = [
  {
    type: 'character' as const,
    table: 'characters' as const,
    variantTable: 'character_variants' as const,
    fk: 'character_id' as const,
  },
  {
    type: 'location' as const,
    table: 'locations' as const,
    variantTable: 'location_variants' as const,
    fk: 'location_id' as const,
  },
  {
    type: 'prop' as const,
    table: 'props' as const,
    variantTable: 'prop_variants' as const,
    fk: 'prop_id' as const,
  },
] as const;

export interface ProjectAssetVariant {
  id: string;
  label: string;
  slug: string;
  structuredPrompt: Record<string, unknown> | null;
  useCase: string | null;
  isMain: boolean;
  isFinalized: boolean;
  imageUrl: string | null;
  imageGenStatus: string | null;
}

export interface ProjectAsset {
  id: string;
  name: string;
  slug: string | null;
  type: AssetType;
  videoId: string | null;
  structuredPrompt: Record<string, unknown> | null;
  useCase: string | null;
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
        if (!initialLoadDoneRef.current) {
          setIsLoading(true);
        }
        setError(null);
      }

      const supabase = createClient('studio');

      try {
        // Load video id for linking
        const { data: videoData, error: videoLoadError } = await supabase
          .from('videos')
          .select('id')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (videoLoadError) {
          throw new Error(videoLoadError.message);
        }

        const linkedVideoId =
          typeof videoData?.id === 'string' ? videoData.id : null;

        // Load grid prompts from projects.generation_settings
        const { data: projectData } = await supabase
          .from('projects')
          .select('generation_settings')
          .eq('id', projectId)
          .maybeSingle();

        const genSettings = isRecord(projectData?.generation_settings)
          ? projectData.generation_settings
          : {};
        const metadata = isRecord(genSettings.creative_brief)
          ? genSettings.creative_brief
          : {};

        // Load assets from all 3 typed tables in parallel
        const variantFields =
          'id, name, slug, structured_prompt, use_case, image_url, is_main, image_gen_status';
        const assetResults = await Promise.all(
          TYPED_TABLES.map(async ({ type, table, variantTable }) => {
            const { data, error: queryError } = await supabase
              .from(table)
              .select(
                `id, name, slug, structured_prompt, use_case, sort_order, video_id, ${variantTable}(${variantFields})`
              )
              .eq('project_id', projectId)
              .order('sort_order', { ascending: true });

            if (queryError) throw new Error(queryError.message);

            return (data ?? []).map((row: Record<string, unknown>) => ({
              id: row.id as string,
              name: row.name as string,
              slug: (row.slug as string | null) ?? null,
              type,
              structured_prompt: row.structured_prompt as Record<
                string,
                unknown
              > | null,
              use_case: row.use_case as string | null,
              sort_order: row.sort_order as number | null,
              video_id: (row.video_id as string | null) ?? null,
              variants: (row[variantTable] ?? []) as VariantRow[],
            }));
          })
        );

        const assetsRows: AssetRow[] = assetResults.flat();

        const parsedAssets: ProjectAsset[] = assetsRows.map((asset) => {
          const variants = asset.variants.map((variant) => ({
            id: variant.id,
            label:
              (typeof variant.name === 'string' && variant.name.trim()) ||
              variant.slug,
            slug: variant.slug,
            structuredPrompt: isRecord(variant.structured_prompt)
              ? variant.structured_prompt
              : null,
            useCase:
              typeof variant.use_case === 'string' ? variant.use_case : null,
            isMain: variant.is_main,
            isFinalized: false,
            imageUrl: resolveStoredUrl(supabase, variant.image_url),
            imageGenStatus: variant.image_gen_status ?? null,
          }));

          return {
            id: asset.id,
            name: asset.name,
            slug: asset.slug ?? null,
            type: asset.type,
            videoId: asset.video_id,
            structuredPrompt: isRecord(asset.structured_prompt)
              ? asset.structured_prompt
              : null,
            useCase: typeof asset.use_case === 'string' ? asset.use_case : null,
            sortOrder: asset.sort_order,
            thumbnailUrl: pickThumbnailUrl(supabase, asset.variants),
            variants,
          };
        });

        // Derive generation status from variant image_gen_status
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
      if (!projectId) {
        return { ok: false, error: 'Project is required' };
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

        const response = await fetch(`/api/v2/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            generation_settings: {
              ...(isRecord(videoMetadata) ? {} : {}),
              creative_brief: nextMetadata,
            },
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to save grid prompt');
        }

        setVideoMetadata(nextMetadata);
        setGridPrompts(resolveGridPrompts(nextMetadata));

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
    [gridPrompts, projectId, videoMetadata]
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
        }))
        .filter((item) => !!item.variant_id)
        .map((item) => ({
          asset_id: item.asset_id,
          variant_id: item.variant_id as string,
        }));

      if (generationTargets.length === 0) {
        return {
          ok: false,
          error: 'No variants available for generation',
        };
      }

      setIsGeneratingGrid((prev) => ({ ...prev, [type]: true }));

      try {
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

  // Realtime subscriptions for typed variant tables
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
          table: 'character_variants',
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
          table: 'location_variants',
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
          table: 'prop_variants',
        },
        () => {
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
