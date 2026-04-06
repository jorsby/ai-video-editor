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
  IconChevronUp,
  IconMicrophone,
  IconVideo,
} from '@tabler/icons-react';
import { usePanelCollapseStore } from '@/stores/panel-collapse-store';

type SceneStatus =
  | 'draft'
  | 'ready'
  | 'generating'
  | 'partial'
  | 'done'
  | 'failed';
type ChapterStatus = 'draft' | 'generating' | 'partial' | 'done' | 'failed';
type AssetType = 'character' | 'location' | 'prop';

interface CanonicalVideo {
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

interface ChapterAssetVariantMap {
  characters: string[];
  locations: string[];
  props: string[];
}

interface ChapterScene {
  id: string;
  order: number;
  title: string | null;
  prompt: string | null;
  audio_text: string | null;
  audio_url: string | null;
  video_url: string | null;
  tts_status: string | null;
  video_status: string | null;
  location_variant_slug: string | null;
  character_variant_slugs: string[];
  prop_variant_slugs: string[];
}

interface ChapterCardData {
  id: string;
  order: number;
  title: string;
  synopsis: string | null;
  audioContent: string | null;
  visualOutline: string | null;
  assetVariantMap: ChapterAssetVariantMap;
  scenes: ChapterScene[];
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

function normalizeChapterAssetVariantMap(
  value: unknown
): ChapterAssetVariantMap {
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
  } = supabase.storage.from('video-assets').getPublicUrl(rawUrl);

  return publicUrl || rawUrl;
}

const EPISODE_STATUS_CONFIG: Record<
  ChapterStatus,
  { label: string; className: string }
> = {
  draft: {
    label: 'Draft',
    className: 'text-muted-foreground border-muted-foreground/30',
  },
  generating: {
    label: 'Generating',
    className: 'text-amber-400 border-amber-500/30',
  },
  partial: { label: 'Partial', className: 'text-blue-400 border-blue-500/30' },
  done: { label: 'Done', className: 'text-emerald-400 border-emerald-500/30' },
  failed: { label: 'Failed', className: 'text-red-400 border-red-500/30' },
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
  generating: {
    label: 'Generating',
    className: 'text-amber-400 border-amber-500/30',
  },
  partial: { label: 'Partial', className: 'text-blue-400 border-blue-500/30' },
  done: { label: 'Done', className: 'text-emerald-400 border-emerald-500/30' },
  failed: { label: 'Failed', className: 'text-red-400 border-red-500/30' },
};

function deriveSceneStatus(scene: ChapterScene): SceneStatus {
  if (
    scene.tts_status === 'generating' ||
    scene.video_status === 'generating'
  ) {
    return 'generating';
  }
  if (scene.tts_status === 'failed' || scene.video_status === 'failed') {
    return 'failed';
  }
  if (scene.audio_url && scene.video_url) {
    return 'done';
  }
  if (scene.audio_url || scene.video_url) {
    return 'partial';
  }
  if (scene.prompt) {
    return 'ready';
  }
  return 'draft';
}

function deriveChapterStatus(chapter: ChapterCardData): ChapterStatus {
  if (chapter.scenes.length < 1) return 'draft';
  const sceneStatuses = chapter.scenes.map(deriveSceneStatus);
  if (sceneStatuses.some((status) => status === 'generating'))
    return 'generating';
  if (sceneStatuses.every((status) => status === 'done')) return 'done';
  if (sceneStatuses.some((status) => status === 'failed')) return 'failed';
  if (
    sceneStatuses.some((status) => status === 'done' || status === 'partial')
  ) {
    return 'partial';
  }
  return 'draft';
}

function variantTypeBadgeClass(type: AssetType): string {
  if (type === 'character') return 'text-cyan-300 border-cyan-500/30';
  if (type === 'location') return 'text-violet-300 border-violet-500/30';
  return 'text-amber-300 border-amber-500/30';
}

function SceneRow({
  scene,
  variantBySlug,
}: {
  scene: ChapterScene;
  variantBySlug: Map<string, VariantMeta>;
}) {
  const sceneStatus = deriveSceneStatus(scene);
  const sceneStatusConfig =
    SCENE_STATUS_CONFIG[sceneStatus] ?? SCENE_STATUS_CONFIG.draft;
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

        {sceneStatus === 'done' ? (
          <IconCheck className="size-3 text-emerald-400 shrink-0" />
        ) : sceneStatus === 'generating' ? (
          <IconLoader2 className="size-3 text-amber-400 animate-spin shrink-0" />
        ) : sceneStatus === 'failed' ? (
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

function ChapterCard({
  chapter,
  isExpanded,
  onToggle,
  variantBySlug,
}: {
  chapter: ChapterCardData;
  isExpanded: boolean;
  onToggle: () => void;
  variantBySlug: Map<string, VariantMeta>;
}) {
  const chapterStatus = deriveChapterStatus(chapter);
  const statusConfig =
    EPISODE_STATUS_CONFIG[chapterStatus] ?? EPISODE_STATUS_CONFIG.draft;
  const sceneCount = chapter.scenes.length;
  const doneScenes = chapter.scenes.filter(
    (scene) => deriveSceneStatus(scene) === 'done'
  ).length;

  const groupedAssetSlugs = [
    { label: 'Characters', slugs: chapter.assetVariantMap.characters },
    { label: 'Locations', slugs: chapter.assetVariantMap.locations },
    { label: 'Props', slugs: chapter.assetVariantMap.props },
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
          Ep {chapter.order}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{chapter.title}</p>
          {chapter.synopsis ? (
            <p className="text-[10px] text-muted-foreground line-clamp-1">
              {chapter.synopsis}
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
                : 'No scenes yet for this chapter'}
            </p>
          </div>

          <div className="pl-6 pt-1 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Audio Content
            </p>
            <div className="space-y-2 max-h-[50vh] overflow-auto pr-1 rounded bg-muted/10 border border-border/20 p-3">
              {chapter.audioContent ? (
                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {chapter.audioContent}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground/70 italic">
                  No chapter-level audio content yet.
                </p>
              )}
            </div>
          </div>

          <div className="pl-6 pt-1 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Visual Outline
            </p>
            <div className="space-y-2 max-h-[50vh] overflow-auto pr-1 rounded bg-muted/10 border border-border/20 p-3">
              {chapter.visualOutline ? (
                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {chapter.visualOutline}
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
              Chapter Asset Variant Map
            </p>
            {groupedAssetSlugs.length > 0 ? (
              <div className="rounded bg-muted/10 border border-border/20 p-2 space-y-1.5">
                {groupedAssetSlugs.map((group) => (
                  <div
                    key={`${chapter.id}-${group.label}`}
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
                            key={`${chapter.id}-${group.label}-${slug}`}
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
              {chapter.scenes.map((scene) => (
                <SceneRow
                  key={scene.id}
                  scene={scene}
                  variantBySlug={variantBySlug}
                />
              ))}
            </div>
          ) : (
            <p className="text-[9px] text-muted-foreground/50 pl-6 italic">
              Add scenes under this chapter to review prompt/audio/video status.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

type VideoOption = { id: string; name: string };

export default function VideoRoadmapPanel() {
  const projectId = useProjectId();
  const [allVideo, setAllVideo] = useState<VideoOption[]>([]);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [video, setVideo] = useState<CanonicalVideo | null>(null);
  const [chapters, setChapters] = useState<ChapterCardData[]>([]);
  const [variantBySlug, setVariantBySlug] = useState<Map<string, VariantMeta>>(
    new Map()
  );
  const [expandedEps, setExpandedEps] = useState<Set<number>>(new Set());
  const { toggleAll, getForceOpen } = usePanelCollapseStore();
  const roadmapForceOpen = getForceOpen('roadmap');

  // Respond to collapse/expand all
  useEffect(() => {
    if (roadmapForceOpen === false) {
      setExpandedEps(new Set());
    } else if (roadmapForceOpen === null && chapters.length > 0) {
      // When reset from collapsed, expand first
      // (only if currently empty, i.e. was collapsed)
    }
  }, [roadmapForceOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const chapterIdsRef = useRef<Set<string>>(new Set());
  const assetIdsRef = useRef<Set<string>>(new Set());
  const refreshTimerRef = useRef<number | null>(null);

  // Load all video for this project (for the dropdown)
  useEffect(() => {
    if (!projectId) {
      setAllVideo([]);
      return;
    }

    const supabase = createClient('studio');
    supabase
      .from('videos')
      .select('id, name')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        const list: VideoOption[] = (data ?? []).map((s) => ({
          id: s.id,
          name: (s.name as string) || 'Untitled',
        }));
        setAllVideo(list);

        // Auto-select first video if nothing selected yet
        if (!videoId && list.length > 0) {
          setVideoId(list[0].id);
        }
      });
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRoadmap = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      setError(null);
      setVideo(null);
      setChapters([]);
      setVariantBySlug(new Map());
      chapterIdsRef.current = new Set();
      assetIdsRef.current = new Set();
      return;
    }

    if (!videoId) {
      setVideo(null);
      setChapters([]);
      setVariantBySlug(new Map());
      chapterIdsRef.current = new Set();
      assetIdsRef.current = new Set();
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = createClient('studio');
    const resolvedVideoId = videoId;

    try {

      const { data: videoRow, error: videoError } = await supabase
        .from('videos')
        .select(
          'id, name, bible, creative_brief, content_mode, plan_status, language, aspect_ratio, voice_id, tts_speed'
        )
        .eq('id', resolvedVideoId)
        .maybeSingle();

      if (videoError || !videoRow) {
        throw new Error(videoError?.message ?? 'Failed to load video');
      }

      const { data: assetRows, error: assetError } = await supabase
        .from('project_assets')
        .select(
          'id, name, type, project_asset_variants(id, slug, name, image_url)'
        )
        .eq('project_id', projectId)
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

        for (const variant of asset.project_asset_variants ?? []) {
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

      const { data: chapterRows, error: chapterError } = await supabase
        .from('chapters')
        .select(
          'id, order, title, synopsis, audio_content, visual_outline, asset_variant_map'
        )
        .eq('video_id', resolvedVideoId)
        .order('order', { ascending: true });

      if (chapterError) {
        throw new Error(chapterError.message);
      }

      const chapterIds = (chapterRows ?? []).map((chapter) => chapter.id);
      chapterIdsRef.current = new Set(chapterIds);
      assetIdsRef.current = nextAssetIds;

      const scenesByChapter = new Map<string, ChapterScene[]>();

      if (chapterIds.length > 0) {
        const { data: sceneRows, error: sceneError } = await supabase
          .from('scenes')
          .select(
            'id, chapter_id, order, title, prompt, audio_text, audio_url, video_url, tts_status, video_status, location_variant_slug, character_variant_slugs, prop_variant_slugs'
          )
          .in('chapter_id', chapterIds)
          .order('order', { ascending: true });

        if (sceneError) {
          throw new Error(sceneError.message);
        }

        for (const scene of sceneRows ?? []) {
          const chapterId = scene.chapter_id;
          if (!chapterId) continue;

          const list = scenesByChapter.get(chapterId) ?? [];
          list.push({
            id: scene.id,
            order: Number(scene.order ?? 0),
            title: scene.title ?? null,
            prompt: scene.prompt ?? null,
            audio_text: scene.audio_text ?? null,
            audio_url: scene.audio_url ?? null,
            video_url: scene.video_url ?? null,
            tts_status: scene.tts_status ?? null,
            video_status: scene.video_status ?? null,
            location_variant_slug: scene.location_variant_slug ?? null,
            character_variant_slugs: normalizeSlugArray(
              scene.character_variant_slugs
            ),
            prop_variant_slugs: normalizeSlugArray(scene.prop_variant_slugs),
          });
          scenesByChapter.set(chapterId, list);
        }
      }

      const nextChapters: ChapterCardData[] = (chapterRows ?? []).map(
        (chapter) => ({
          id: chapter.id,
          order: Number(chapter.order ?? 0),
          title: chapter.title ?? `Chapter ${chapter.order}`,
          synopsis: chapter.synopsis ?? null,
          audioContent: chapter.audio_content ?? null,
          visualOutline: chapter.visual_outline ?? null,
          assetVariantMap: normalizeChapterAssetVariantMap(
            chapter.asset_variant_map
          ),
          scenes: (scenesByChapter.get(chapter.id) ?? []).sort(
            (a, b) => a.order - b.order
          ),
        })
      );

      setVideoId(resolvedVideoId);
      setVideo({
        id: videoRow.id,
        name: videoRow.name ?? 'Untitled video',
        bible: videoRow.bible ?? null,
        creative_brief: isRecord(videoRow.creative_brief)
          ? videoRow.creative_brief
          : null,
        content_mode: videoRow.content_mode ?? null,
        plan_status: videoRow.plan_status ?? null,
        language: videoRow.language ?? null,
        aspect_ratio: videoRow.aspect_ratio ?? null,
        voice_id: videoRow.voice_id ?? null,
        tts_speed:
          typeof videoRow.tts_speed === 'number' ? videoRow.tts_speed : null,
      });
      setVariantBySlug(nextVariantBySlug);
      setChapters(nextChapters);
      setExpandedEps((prev) => {
        if (prev.size > 0) return prev;
        const first = nextChapters[0]?.order;
        return first != null ? new Set([first]) : new Set();
      });
      setLoading(false);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load canonical roadmap'
      );
      setLoading(false);
    }
  }, [projectId, videoId]);

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
    if (!videoId) return;

    const supabase = createClient('studio');
    const channel = supabase
      .channel(`video-roadmap-live-${videoId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'video',
          filter: `id=eq.${videoId}`,
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
          table: 'project_assets',
          filter: `project_id=eq.${projectId}`,
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
          scheduleReload();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'chapters',
          filter: `video_id=eq.${videoId}`,
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
          const chapterId =
            (payload.new as { chapter_id?: string } | null | undefined)
              ?.chapter_id ??
            (payload.old as { chapter_id?: string } | null | undefined)
              ?.chapter_id ??
            null;

          if (!chapterId || !chapterIdsRef.current.has(chapterId)) return;
          scheduleReload();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, scheduleReload, videoId]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const totalScenes = useMemo(
    () => chapters.reduce((sum, chapter) => sum + chapter.scenes.length, 0),
    [chapters]
  );

  const doneChapters = useMemo(
    () =>
      chapters.filter((chapter) => deriveChapterStatus(chapter) === 'done')
        .length,
    [chapters]
  );

  const reviewBadges = useMemo(() => {
    if (!video) return [];

    const badges: string[] = [];
    if (video.content_mode) badges.push(video.content_mode);
    if (video.plan_status) badges.push(video.plan_status);
    if (video.aspect_ratio) badges.push(video.aspect_ratio);
    if (video.language) badges.push(video.language);
    if (video.voice_id) badges.push(`voice:${video.voice_id}`);
    if (typeof video.tts_speed === 'number')
      badges.push(`speed:${video.tts_speed}`);

    return badges;
  }, [video]);

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

  if (!videoId || !video) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center">
        <IconMovie className="size-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">
          This project is not linked to a video yet.
        </p>
        <p className="text-[10px] text-muted-foreground/70 mt-1">
          Link a canonical video to review chapters and scenes.
        </p>
      </div>
    );
  }

  if (chapters.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center">
        <IconMovie className="size-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">No chapters yet.</p>
        <p className="text-[10px] text-muted-foreground/70 mt-1">
          Create chapters to unlock scene-level roadmap review.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            {allVideo.length > 1 ? (
              <select
                value={videoId ?? ''}
                onChange={(e) => setVideoId(e.target.value || null)}
                className="text-sm font-medium bg-transparent border border-border/40 rounded px-1.5 py-0.5 outline-none focus:border-primary/50 truncate max-w-[200px] cursor-pointer"
              >
                {allVideo.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm font-medium">{video.name}</p>
            )}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (expandedEps.size > 0) {
                    setExpandedEps(new Set());
                  } else {
                    setExpandedEps(new Set(chapters.map((e) => e.order)));
                  }
                }}
                className="h-6 px-1.5 text-xs rounded border bg-background hover:bg-accent text-muted-foreground transition-colors"
                title={expandedEps.size > 0 ? 'Collapse all chapters' : 'Expand all chapters'}
              >
                {expandedEps.size > 0 ? (
                  <IconChevronUp className="size-3.5" />
                ) : (
                  <IconChevronDown className="size-3.5" />
                )}
              </button>
              <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                {doneChapters}/{chapters.length} chapters
              </span>
            </div>
          </div>

          <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500/60 rounded-full transition-all"
              style={{
                width: `${chapters.length > 0 ? (doneChapters / chapters.length) * 100 : 0}%`,
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

        {video.creative_brief ? (
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
                {JSON.stringify(video.creative_brief, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {video.bible ? (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded bg-muted/20 border border-border/30 text-left hover:bg-muted/30 transition-colors"
              >
                <IconBook className="size-3 text-muted-foreground shrink-0" />
                <span className="text-[10px] font-medium flex-1">
                  Video Bible
                </span>
                <IconChevronDown className="size-3 text-muted-foreground" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="text-[10px] text-muted-foreground leading-relaxed px-2 pt-1.5 pb-1 whitespace-pre-wrap">
                {video.bible}
              </p>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <IconPlayerPlay className="size-3 text-muted-foreground" />
            <span className="text-[10px] font-medium">
              Chapters ({chapters.length})
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

          {chapters.map((chapter) => (
            <ChapterCard
              key={chapter.id}
              chapter={chapter}
              isExpanded={expandedEps.has(chapter.order)}
              onToggle={() =>
                setExpandedEps((prev) => {
                  const next = new Set(prev);
                  if (next.has(chapter.order)) {
                    next.delete(chapter.order);
                  } else {
                    next.add(chapter.order);
                  }
                  return next;
                })
              }
              variantBySlug={variantBySlug}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
