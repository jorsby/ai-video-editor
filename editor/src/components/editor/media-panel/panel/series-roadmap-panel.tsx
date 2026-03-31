'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useProjectId } from '@/contexts/project-context';
import { createClient } from '@/lib/supabase/client';
import {
  IconBook,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconMovie,
  IconPlayerPlay,
  IconCheck,
  IconLoader2,
  IconAlertTriangle,
  IconMapPin,
  IconPackage,
  IconUsers,
  IconMicrophone,
  IconVideo,
} from '@tabler/icons-react';

type SceneStatus = 'draft' | 'ready' | 'in_progress' | 'done' | 'failed';
type EpisodeStatus = 'draft' | 'ready' | 'in_progress' | 'done';
type AssetType = 'character' | 'location' | 'prop';

interface CanonicalSeries {
  id: string;
  name: string;
  bible: string | null;
  creative_brief: Record<string, unknown> | null;
  content_mode: string | null;
  plan_status: string | null;
  language: string | null;
  aspect_ratio: string | null;
  voice_id: string | null;
  tts_speed: number | null;
}

interface EpisodeAssetVariantMap {
  characters: string[];
  locations: string[];
  props: string[];
}

interface EpisodeScene {
  id: string;
  order: number;
  title: string | null;
  prompt: string | null;
  audio_text: string | null;
  audio_url: string | null;
  video_url: string | null;
  status: SceneStatus;
  location_variant_slug: string | null;
  character_variant_slugs: string[];
  prop_variant_slugs: string[];
}

interface EpisodeCardData {
  id: string;
  order: number;
  title: string;
  synopsis: string | null;
  audioContent: string | null;
  visualOutline: string | null;
  status: EpisodeStatus;
  assetVariantMap: EpisodeAssetVariantMap;
  scenes: EpisodeScene[];
}

interface VariantMeta {
  slug: string;
  type: AssetType;
  label: string;
  imageUrl: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSlugArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function normalizeEpisodeAssetVariantMap(
  value: unknown
): EpisodeAssetVariantMap {
  if (!isRecord(value)) {
    return { characters: [], locations: [], props: [] };
  }

  return {
    characters: normalizeSlugArray(value.characters),
    locations: normalizeSlugArray(value.locations),
    props: normalizeSlugArray(value.props),
  };
}

function resolveStoredUrl(
  supabase: ReturnType<typeof createClient>,
  rawUrl: string | null | undefined
): string | null {
  if (!rawUrl) return null;
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;

  const {
    data: { publicUrl },
  } = supabase.storage.from('series-assets').getPublicUrl(rawUrl);

  return publicUrl || rawUrl;
}

const EPISODE_STATUS_CONFIG: Record<
  EpisodeStatus,
  { label: string; className: string }
> = {
  draft: {
    label: 'Draft',
    className: 'text-muted-foreground border-muted-foreground/30',
  },
  ready: { label: 'Ready', className: 'text-blue-400 border-blue-500/30' },
  in_progress: {
    label: 'In Progress',
    className: 'text-amber-400 border-amber-500/30',
  },
  done: { label: 'Done', className: 'text-emerald-400 border-emerald-500/30' },
};

const SCENE_STATUS_CONFIG: Record<
  SceneStatus,
  { label: string; className: string }
> = {
  draft: {
    label: 'Draft',
    className: 'text-muted-foreground border-muted-foreground/30',
  },
  ready: { label: 'Ready', className: 'text-blue-400 border-blue-500/30' },
  in_progress: {
    label: 'In Progress',
    className: 'text-amber-400 border-amber-500/30',
  },
  done: { label: 'Done', className: 'text-emerald-400 border-emerald-500/30' },
  failed: { label: 'Failed', className: 'text-red-400 border-red-500/30' },
};

function variantTypeBadgeClass(type: AssetType): string {
  if (type === 'character') return 'text-cyan-300 border-cyan-500/30';
  if (type === 'location') return 'text-violet-300 border-violet-500/30';
  return 'text-amber-300 border-amber-500/30';
}

function SceneRow({
  scene,
  variantBySlug,
}: {
  scene: EpisodeScene;
  variantBySlug: Map<string, VariantMeta>;
}) {
  const sceneStatusConfig =
    SCENE_STATUS_CONFIG[scene.status] ?? SCENE_STATUS_CONFIG.draft;
  const promptPreview = scene.prompt?.trim() || 'No prompt yet';
  const audioPreview = scene.audio_text?.trim() || null;

  const location = scene.location_variant_slug
    ? [scene.location_variant_slug]
    : [];
  const characters = scene.character_variant_slugs;
  const props = scene.prop_variant_slugs;

  const variantChips = [
    ...location.map((slug) => ({ slug, type: 'location' as const })),
    ...characters.map((slug) => ({ slug, type: 'character' as const })),
    ...props.map((slug) => ({ slug, type: 'prop' as const })),
  ];

  const thumbSlugs = variantChips
    .map((item) => item.slug)
    .filter((slug, index, arr) => arr.indexOf(slug) === index)
    .slice(0, 3);

  return (
    <div className="space-y-1.5 px-2 py-2 rounded bg-muted/10 border border-border/20">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono text-muted-foreground shrink-0 w-8">
          Sc {scene.order}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          {thumbSlugs.map((slug) => {
            const variant = variantBySlug.get(slug);
            if (!variant?.imageUrl) return null;

            return (
              <img
                key={`${scene.id}-${slug}`}
                src={variant.imageUrl}
                alt={variant.label}
                className="size-6 rounded object-cover border border-border/30"
                title={variant.label}
              />
            );
          })}
        </div>

        <div className="flex-1" />

        {scene.audio_url ? (
          <Badge
            variant="outline"
            className="h-4 px-1 text-[8px] border-blue-500/30 text-blue-300"
          >
            <IconMicrophone className="size-2.5 mr-0.5" />
            Audio
          </Badge>
        ) : null}

        {scene.video_url ? (
          <Badge
            variant="outline"
            className="h-4 px-1 text-[8px] border-cyan-500/30 text-cyan-300"
          >
            <IconVideo className="size-2.5 mr-0.5" />
            Video
          </Badge>
        ) : null}

        <Badge
          variant="outline"
          className={`h-4 px-1 text-[8px] ${sceneStatusConfig.className}`}
        >
          {sceneStatusConfig.label}
        </Badge>

        {scene.status === 'done' ? (
          <IconCheck className="size-3 text-emerald-400 shrink-0" />
        ) : scene.status === 'in_progress' ? (
          <IconLoader2 className="size-3 text-amber-400 animate-spin shrink-0" />
        ) : scene.status === 'failed' ? (
          <IconAlertTriangle className="size-3 text-red-400 shrink-0" />
        ) : (
          <IconClock className="size-3 text-muted-foreground/50 shrink-0" />
        )}
      </div>

      <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed pl-8">
        {promptPreview.length > 160
          ? `${promptPreview.slice(0, 160)}…`
          : promptPreview}
      </p>

      {audioPreview ? (
        <p className="text-[10px] text-foreground/80 line-clamp-2 leading-relaxed pl-8">
          {audioPreview.length > 160
            ? `${audioPreview.slice(0, 160)}…`
            : audioPreview}
        </p>
      ) : null}

      {variantChips.length > 0 ? (
        <div className="pl-8 flex flex-wrap gap-1">
          {variantChips.map((chip) => {
            const variant = variantBySlug.get(chip.slug);
            const label = variant?.label ?? chip.slug;
            const type = variant?.type ?? chip.type;

            return (
              <Badge
                key={`${scene.id}-${chip.slug}-${chip.type}`}
                variant="outline"
                className={`h-4 px-1 text-[8px] ${variantTypeBadgeClass(type)}`}
              >
                {label}
              </Badge>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function EpisodeCard({
  episode,
  isExpanded,
  onToggle,
  variantBySlug,
}: {
  episode: EpisodeCardData;
  isExpanded: boolean;
  onToggle: () => void;
  variantBySlug: Map<string, VariantMeta>;
}) {
  const statusConfig =
    EPISODE_STATUS_CONFIG[episode.status] ?? EPISODE_STATUS_CONFIG.draft;
  const sceneCount = episode.scenes.length;
  const doneScenes = episode.scenes.filter(
    (scene) => scene.status === 'done'
  ).length;

  const groupedAssetSlugs = [
    { label: 'Characters', slugs: episode.assetVariantMap.characters },
    { label: 'Locations', slugs: episode.assetVariantMap.locations },
    { label: 'Props', slugs: episode.assetVariantMap.props },
  ].filter((group) => group.slugs.length > 0);

  return (
    <div className="border border-border/40 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/20 transition-colors"
      >
        {isExpanded ? (
          <IconChevronDown className="size-3.5 text-muted-foreground shrink-0" />
        ) : (
          <IconChevronRight className="size-3.5 text-muted-foreground shrink-0" />
        )}

        <span className="text-xs font-mono text-muted-foreground shrink-0 w-10">
          Ep {episode.order}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{episode.title}</p>
          {episode.synopsis ? (
            <p className="text-[10px] text-muted-foreground line-clamp-1">
              {episode.synopsis}
            </p>
          ) : null}
        </div>

        <Badge
          variant="outline"
          className={`text-[9px] px-1.5 py-0.5 h-4 shrink-0 ${statusConfig.className}`}
        >
          {statusConfig.label}
        </Badge>

        <span className="text-[10px] text-muted-foreground shrink-0">
          {doneScenes}/{sceneCount}
        </span>
      </button>

      {isExpanded ? (
        <div className="px-2.5 pb-2.5 space-y-2">
          <div className="pl-6 space-y-1">
            <p className="text-[10px] text-muted-foreground">
              {sceneCount > 0
                ? `${sceneCount} scene(s) • ${doneScenes}/${sceneCount} done`
                : 'No scenes yet for this episode'}
            </p>
          </div>

          <div className="pl-6 pt-1 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Audio Content
            </p>
            <div className="space-y-2 max-h-[50vh] overflow-auto pr-1 rounded bg-muted/10 border border-border/20 p-3">
              {episode.audioContent ? (
                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {episode.audioContent}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground/70 italic">
                  No episode-level audio content yet.
                </p>
              )}
            </div>
          </div>

          <div className="pl-6 pt-1 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Visual Outline
            </p>
            <div className="space-y-2 max-h-[50vh] overflow-auto pr-1 rounded bg-muted/10 border border-border/20 p-3">
              {episode.visualOutline ? (
                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {episode.visualOutline}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground/70 italic">
                  No visual outline yet.
                </p>
              )}
            </div>
          </div>

          <div className="pl-6 pt-1 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Episode Asset Variant Map
            </p>
            {groupedAssetSlugs.length > 0 ? (
              <div className="rounded bg-muted/10 border border-border/20 p-2 space-y-1.5">
                {groupedAssetSlugs.map((group) => (
                  <div
                    key={`${episode.id}-${group.label}`}
                    className="space-y-1"
                  >
                    <p className="text-[10px] text-muted-foreground">
                      {group.label}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {group.slugs.map((slug) => {
                        const variant = variantBySlug.get(slug);
                        const type =
                          group.label === 'Characters'
                            ? 'character'
                            : group.label === 'Locations'
                              ? 'location'
                              : 'prop';
                        return (
                          <Badge
                            key={`${episode.id}-${group.label}-${slug}`}
                            variant="outline"
                            className={`h-5 px-1.5 text-[10px] ${variantTypeBadgeClass(
                              (variant?.type ?? type) as AssetType
                            )}`}
                          >
                            {variant?.label ?? slug}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground/70 italic">
                No variant slugs mapped yet.
              </p>
            )}
          </div>

          {sceneCount > 0 ? (
            <div className="pl-6 space-y-1">
              <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                Scenes ({sceneCount})
              </p>
              {episode.scenes.map((scene) => (
                <SceneRow
                  key={scene.id}
                  scene={scene}
                  variantBySlug={variantBySlug}
                />
              ))}
            </div>
          ) : (
            <p className="text-[9px] text-muted-foreground/50 pl-6 italic">
              Add scenes under this episode to review prompt/audio/video status.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function SeriesRoadmapPanel() {
  const projectId = useProjectId();
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [series, setSeries] = useState<CanonicalSeries | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeCardData[]>([]);
  const [variantBySlug, setVariantBySlug] = useState<Map<string, VariantMeta>>(
    new Map()
  );
  const [expandedEp, setExpandedEp] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const episodeIdsRef = useRef<Set<string>>(new Set());
  const assetIdsRef = useRef<Set<string>>(new Set());
  const refreshTimerRef = useRef<number | null>(null);

  const loadRoadmap = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      setError(null);
      setSeriesId(null);
      setSeries(null);
      setEpisodes([]);
      setVariantBySlug(new Map());
      episodeIdsRef.current = new Set();
      assetIdsRef.current = new Set();
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = createClient('studio');

    try {
      let resolvedSeriesId: string | null = null;

      try {
        const projectRes = await fetch(`/api/projects/${projectId}`);
        if (projectRes.ok) {
          const projectData = await projectRes.json();
          const settings = isRecord(projectData?.project?.settings)
            ? projectData.project.settings
            : null;

          if (
            typeof settings?.series_id === 'string' &&
            settings.series_id.trim()
          ) {
            resolvedSeriesId = settings.series_id.trim();
          }
        }
      } catch {
        // no-op, fallback below
      }

      if (!resolvedSeriesId) {
        const { data: seriesFromProject } = await supabase
          .from('series')
          .select('id')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        resolvedSeriesId = seriesFromProject?.id ?? null;
      }

      if (!resolvedSeriesId) {
        setSeriesId(null);
        setSeries(null);
        setEpisodes([]);
        setVariantBySlug(new Map());
        episodeIdsRef.current = new Set();
        assetIdsRef.current = new Set();
        setLoading(false);
        return;
      }

      const { data: seriesRow, error: seriesError } = await supabase
        .from('series')
        .select(
          'id, name, bible, creative_brief, content_mode, plan_status, language, aspect_ratio, voice_id, tts_speed'
        )
        .eq('id', resolvedSeriesId)
        .maybeSingle();

      if (seriesError || !seriesRow) {
        throw new Error(seriesError?.message ?? 'Failed to load series');
      }

      const { data: assetRows, error: assetError } = await supabase
        .from('series_assets')
        .select(
          'id, name, type, series_asset_variants(id, slug, name, image_url)'
        )
        .eq('series_id', resolvedSeriesId)
        .order('sort_order', { ascending: true });

      if (assetError) {
        throw new Error(assetError.message);
      }

      const nextVariantBySlug = new Map<string, VariantMeta>();
      const nextAssetIds = new Set<string>();

      for (const asset of assetRows ?? []) {
        nextAssetIds.add(asset.id);
        const assetType = asset.type as AssetType;
        const icon =
          assetType === 'character'
            ? '👤'
            : assetType === 'location'
              ? '📍'
              : '📦';

        for (const variant of asset.series_asset_variants ?? []) {
          if (typeof variant.slug !== 'string' || !variant.slug.trim()) {
            continue;
          }

          const variantLabel =
            typeof variant.name === 'string' && variant.name.trim()
              ? `${icon} ${asset.name} — ${variant.name.trim()}`
              : `${icon} ${asset.name} — ${variant.slug}`;

          nextVariantBySlug.set(variant.slug, {
            slug: variant.slug,
            type: assetType,
            label: variantLabel,
            imageUrl: resolveStoredUrl(supabase, variant.image_url),
          });
        }
      }

      const { data: episodeRows, error: episodeError } = await supabase
        .from('episodes')
        .select(
          'id, order, title, synopsis, audio_content, visual_outline, status, asset_variant_map'
        )
        .eq('series_id', resolvedSeriesId)
        .order('order', { ascending: true });

      if (episodeError) {
        throw new Error(episodeError.message);
      }

      const episodeIds = (episodeRows ?? []).map((episode) => episode.id);
      episodeIdsRef.current = new Set(episodeIds);
      assetIdsRef.current = nextAssetIds;

      const scenesByEpisode = new Map<string, EpisodeScene[]>();

      if (episodeIds.length > 0) {
        const { data: sceneRows, error: sceneError } = await supabase
          .from('scenes')
          .select(
            'id, episode_id, order, title, prompt, audio_text, audio_url, video_url, status, location_variant_slug, character_variant_slugs, prop_variant_slugs'
          )
          .in('episode_id', episodeIds)
          .order('order', { ascending: true });

        if (sceneError) {
          throw new Error(sceneError.message);
        }

        for (const scene of sceneRows ?? []) {
          const episodeId = scene.episode_id;
          if (!episodeId) continue;

          const list = scenesByEpisode.get(episodeId) ?? [];
          list.push({
            id: scene.id,
            order: Number(scene.order ?? 0),
            title: scene.title ?? null,
            prompt: scene.prompt ?? null,
            audio_text: scene.audio_text ?? null,
            audio_url: scene.audio_url ?? null,
            video_url: scene.video_url ?? null,
            status:
              scene.status && SCENE_STATUS_CONFIG[scene.status as SceneStatus]
                ? (scene.status as SceneStatus)
                : 'draft',
            location_variant_slug: scene.location_variant_slug ?? null,
            character_variant_slugs: normalizeSlugArray(
              scene.character_variant_slugs
            ),
            prop_variant_slugs: normalizeSlugArray(scene.prop_variant_slugs),
          });
          scenesByEpisode.set(episodeId, list);
        }
      }

      const nextEpisodes: EpisodeCardData[] = (episodeRows ?? []).map(
        (episode) => ({
          id: episode.id,
          order: Number(episode.order ?? 0),
          title: episode.title ?? `Episode ${episode.order}`,
          synopsis: episode.synopsis ?? null,
          audioContent: episode.audio_content ?? null,
          visualOutline: episode.visual_outline ?? null,
          status:
            episode.status &&
            EPISODE_STATUS_CONFIG[episode.status as EpisodeStatus]
              ? (episode.status as EpisodeStatus)
              : 'draft',
          assetVariantMap: normalizeEpisodeAssetVariantMap(
            episode.asset_variant_map
          ),
          scenes: (scenesByEpisode.get(episode.id) ?? []).sort(
            (a, b) => a.order - b.order
          ),
        })
      );

      setSeriesId(resolvedSeriesId);
      setSeries({
        id: seriesRow.id,
        name: seriesRow.name ?? 'Untitled series',
        bible: seriesRow.bible ?? null,
        creative_brief: isRecord(seriesRow.creative_brief)
          ? seriesRow.creative_brief
          : null,
        content_mode: seriesRow.content_mode ?? null,
        plan_status: seriesRow.plan_status ?? null,
        language: seriesRow.language ?? null,
        aspect_ratio: seriesRow.aspect_ratio ?? null,
        voice_id: seriesRow.voice_id ?? null,
        tts_speed:
          typeof seriesRow.tts_speed === 'number' ? seriesRow.tts_speed : null,
      });
      setVariantBySlug(nextVariantBySlug);
      setEpisodes(nextEpisodes);
      setExpandedEp((prev) => prev ?? nextEpisodes[0]?.order ?? null);
      setLoading(false);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load canonical roadmap'
      );
      setLoading(false);
    }
  }, [projectId]);

  const scheduleReload = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setTimeout(() => {
      void loadRoadmap();
    }, 250);
  }, [loadRoadmap]);

  useEffect(() => {
    void loadRoadmap();
  }, [loadRoadmap]);

  useEffect(() => {
    if (!seriesId) return;

    const supabase = createClient('studio');
    const channel = supabase
      .channel(`series-roadmap-live-${seriesId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'series',
          filter: `id=eq.${seriesId}`,
        },
        () => {
          scheduleReload();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'series_assets',
          filter: `series_id=eq.${seriesId}`,
        },
        () => {
          scheduleReload();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'series_asset_variants',
        },
        (payload) => {
          const assetId =
            (payload.new as { asset_id?: string } | null | undefined)
              ?.asset_id ??
            (payload.old as { asset_id?: string } | null | undefined)
              ?.asset_id ??
            null;

          if (!assetId || !assetIdsRef.current.has(assetId)) return;
          scheduleReload();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'episodes',
          filter: `series_id=eq.${seriesId}`,
        },
        () => {
          scheduleReload();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'scenes',
        },
        (payload) => {
          const episodeId =
            (payload.new as { episode_id?: string } | null | undefined)
              ?.episode_id ??
            (payload.old as { episode_id?: string } | null | undefined)
              ?.episode_id ??
            null;

          if (!episodeId || !episodeIdsRef.current.has(episodeId)) return;
          scheduleReload();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [scheduleReload, seriesId]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const totalScenes = useMemo(
    () => episodes.reduce((sum, episode) => sum + episode.scenes.length, 0),
    [episodes]
  );

  const doneEpisodes = useMemo(
    () => episodes.filter((episode) => episode.status === 'done').length,
    [episodes]
  );

  const reviewBadges = useMemo(() => {
    if (!series) return [];

    const badges: string[] = [];
    if (series.content_mode) badges.push(series.content_mode);
    if (series.plan_status) badges.push(series.plan_status);
    if (series.aspect_ratio) badges.push(series.aspect_ratio);
    if (series.language) badges.push(series.language);
    if (series.voice_id) badges.push(`voice:${series.voice_id}`);
    if (typeof series.tts_speed === 'number')
      badges.push(`speed:${series.tts_speed}`);

    return badges;
  }, [series]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-muted-foreground animate-pulse">
          Loading canonical roadmap...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center px-4 text-center">
        <p className="text-xs text-destructive">{error}</p>
      </div>
    );
  }

  if (!seriesId || !series) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center">
        <IconMovie className="size-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">
          This project is not linked to a series yet.
        </p>
        <p className="text-[10px] text-muted-foreground/70 mt-1">
          Link a canonical series to review episodes and scenes.
        </p>
      </div>
    );
  }

  if (episodes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center">
        <IconMovie className="size-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">No episodes yet.</p>
        <p className="text-[10px] text-muted-foreground/70 mt-1">
          Create episodes to unlock scene-level roadmap review.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{series.name}</p>
            <span className="text-[9px] text-muted-foreground">
              {doneEpisodes}/{episodes.length} episodes
            </span>
          </div>

          <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500/60 rounded-full transition-all"
              style={{
                width: `${episodes.length > 0 ? (doneEpisodes / episodes.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        {reviewBadges.length > 0 ? (
          <div className="rounded border border-border/30 bg-muted/15 p-2 flex flex-wrap gap-1">
            {reviewBadges.map((badge) => (
              <Badge
                key={badge}
                variant="outline"
                className="h-4 px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground bg-muted/20 border-border/40"
              >
                {badge}
              </Badge>
            ))}
          </div>
        ) : null}

        {series.creative_brief ? (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded bg-muted/20 border border-border/30 text-left hover:bg-muted/30 transition-colors"
              >
                <IconBook className="size-3 text-muted-foreground shrink-0" />
                <span className="text-[10px] font-medium flex-1">
                  Creative Brief
                </span>
                <IconChevronDown className="size-3 text-muted-foreground" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="text-[10px] text-muted-foreground leading-relaxed px-2 pt-1.5 pb-1 whitespace-pre-wrap break-words">
                {JSON.stringify(series.creative_brief, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {series.bible ? (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded bg-muted/20 border border-border/30 text-left hover:bg-muted/30 transition-colors"
              >
                <IconBook className="size-3 text-muted-foreground shrink-0" />
                <span className="text-[10px] font-medium flex-1">
                  Series Bible
                </span>
                <IconChevronDown className="size-3 text-muted-foreground" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="text-[10px] text-muted-foreground leading-relaxed px-2 pt-1.5 pb-1 whitespace-pre-wrap">
                {series.bible}
              </p>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <IconPlayerPlay className="size-3 text-muted-foreground" />
            <span className="text-[10px] font-medium">
              Episodes ({episodes.length})
            </span>
            <span className="text-[9px] text-muted-foreground">
              · {totalScenes} scene(s)
            </span>
            <div className="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground">
              <IconUsers className="size-3" />
              <IconMapPin className="size-3" />
              <IconPackage className="size-3" />
            </div>
          </div>

          {episodes.map((episode) => (
            <EpisodeCard
              key={episode.id}
              episode={episode}
              isExpanded={expandedEp === episode.order}
              onToggle={() =>
                setExpandedEp(
                  expandedEp === episode.order ? null : episode.order
                )
              }
              variantBySlug={variantBySlug}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
