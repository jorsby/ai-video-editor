'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
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
  IconChevronUp,
  IconClock,
  IconMovie,
  IconPlayerPlay,
  IconCheck,
  IconLoader2,
} from '@tabler/icons-react';

interface Episode {
  number: number;
  title: string;
  summary: string;
  status: 'planned' | 'in_progress' | 'done';
}

interface SceneObject {
  name: string;
  imageUrl: string | null;
  variantId: string | null;
}

interface SceneBackground {
  imageUrl: string | null;
}

interface StoryboardScene {
  id: string;
  order: number;
  prompt: string | null;
  multi_prompt?: string[] | null;
  video_status: string | null;
  video_url: string | null;
  objects: SceneObject[];
  background: SceneBackground | null;
}

interface StoryboardInfo {
  id: string;
  plan_status: string;
  mode: string;
  voiceover: string;
  scriptLanguage: string;
  scriptLines: string[];
  scenes: StoryboardScene[];
}

interface SeriesMetadata {
  scene_mode?: string | null;
  episode_count?: number | null;
  aspect_ratio?: string | null;
  language?: string | null;
  tts_settings?: {
    voice_id?: string | null;
    speed?: number | null;
    model?: string | null;
  } | null;
  style?: {
    visual_style?: string | null;
    setting?: string | null;
    custom_notes?: string | null;
  } | null;
}

const STATUS_CONFIG = {
  planned: {
    label: 'Planned',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30',
  },
  in_progress: {
    label: 'In Progress',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
  done: { label: 'Done', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
} as const;

function trimSentence(value: string, max = 180): string {
  const text = value.trim();
  if (!text) return text;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function deriveScriptLines(params: {
  voiceover: string;
  planVoiceoverList: unknown;
}): { language: string; lines: string[] } {
  const list = params.planVoiceoverList;

  if (list && typeof list === 'object') {
    const entries = Object.entries(list as Record<string, unknown>);
    for (const [language, value] of entries) {
      if (!Array.isArray(value)) continue;
      const lines = value
        .map((line) => (typeof line === 'string' ? line.trim() : ''))
        .filter(Boolean);
      if (lines.length > 0) {
        return { language, lines };
      }
    }
  }

  const fallback = params.voiceover
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    language: 'tr',
    lines: fallback,
  };
}

function SceneRow({
  scene,
  index,
  variantImages,
}: {
  scene: StoryboardScene;
  index: number;
  variantImages: Map<string, string>;
}) {
  const firstMultiPrompt =
    Array.isArray(scene.multi_prompt) && scene.multi_prompt.length > 0
      ? scene.multi_prompt[0]
      : null;
  const prompt =
    scene.prompt?.trim() || firstMultiPrompt?.trim() || 'No prompt yet';
  const videoStatus = scene.video_status || 'pending';
  const shotCount = Array.isArray(scene.multi_prompt)
    ? scene.multi_prompt.length
    : 0;

  // Resolve live thumbnails from variant images map
  const objectThumbs = scene.objects.map((obj) => ({
    name: obj.name,
    url: obj.variantId
      ? (variantImages.get(obj.variantId) ?? obj.imageUrl)
      : obj.imageUrl,
  }));
  const bgThumb = scene.background?.imageUrl ?? null;

  return (
    <div className="space-y-1.5 px-2 py-2 rounded bg-muted/10 border border-border/20">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono text-muted-foreground shrink-0 w-4">
          {index + 1}
        </span>

        {/* Asset thumbnails */}
        <div className="flex items-center gap-1 shrink-0">
          {bgThumb && (
            <img
              src={bgThumb}
              alt="bg"
              className="size-6 rounded object-cover border border-border/30 opacity-70"
              title="Background"
            />
          )}
          {objectThumbs.map((obj, i) => (
            <img
              key={`${obj.name}-${i}`}
              src={obj.url || ''}
              alt={obj.name}
              className="size-6 rounded-full object-cover border border-border/30"
              title={obj.name}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ))}
        </div>

        <div className="flex-1" />

        {shotCount > 1 && (
          <span className="text-[8px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 shrink-0">
            {shotCount}-shot
          </span>
        )}

        <div className="shrink-0">
          {videoStatus === 'success' ? (
            <IconCheck className="size-3 text-emerald-400" />
          ) : videoStatus === 'processing' ? (
            <IconLoader2 className="size-3 text-amber-400 animate-spin" />
          ) : (
            <IconClock className="size-3 text-muted-foreground/50" />
          )}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed pl-6">
        {prompt.length > 120 ? `${prompt.slice(0, 120)}...` : prompt}
      </p>
    </div>
  );
}

function EpisodeCard({
  episode,
  storyboard,
  isExpanded,
  onToggle,
  variantImages,
}: {
  episode: Episode;
  storyboard: StoryboardInfo | null;
  isExpanded: boolean;
  onToggle: () => void;
  variantImages: Map<string, string>;
}) {
  const statusConfig = STATUS_CONFIG[episode.status] || STATUS_CONFIG.planned;
  const sceneCount = storyboard?.scenes?.length ?? 0;
  const doneScenes =
    storyboard?.scenes?.filter((s) => s.video_status === 'success').length ?? 0;

  const simpleFlow =
    sceneCount > 0
      ? `${sceneCount} sahne • ${doneScenes}/${sceneCount} video hazır`
      : 'Storyboard henüz oluşturulmadı';

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

        <span className="text-xs font-mono text-muted-foreground shrink-0 w-5">
          {episode.number}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{episode.title}</p>
        </div>

        <Badge
          variant="outline"
          className={`text-[9px] px-1.5 py-0.5 h-4 shrink-0 ${statusConfig.color} border-current/30`}
        >
          {statusConfig.label}
        </Badge>

        {sceneCount > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {doneScenes}/{sceneCount}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="px-2.5 pb-2.5 space-y-2">
          <div className="pl-6 space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Bu bölümde ne olacak?
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {episode.summary}
            </p>
            <p className="text-[10px] text-muted-foreground">{simpleFlow}</p>
          </div>

          {storyboard && storyboard.scriptLines.length > 0 && (
            <div className="pl-6 pt-1 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Full Script ({storyboard.scriptLanguage.toUpperCase()})
              </p>
              <div className="space-y-2 max-h-[70vh] overflow-auto pr-1 rounded bg-muted/10 border border-border/20 p-3">
                {storyboard.scriptLines.map((line, idx) => (
                  <p
                    key={`${episode.number}-script-${idx}`}
                    className="text-sm text-foreground/90 leading-relaxed"
                  >
                    <span className="text-muted-foreground/70 font-mono">
                      {idx + 1}.
                    </span>{' '}
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}

          {storyboard && storyboard.scenes.length > 0 ? (
            <div className="pl-6 space-y-1">
              <p className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                Scenes ({storyboard.scenes.length})
              </p>
              {storyboard.scenes.map((scene, i) => (
                <SceneRow
                  key={scene.id}
                  scene={scene}
                  index={i}
                  variantImages={variantImages}
                />
              ))}
            </div>
          ) : (
            <p className="text-[9px] text-muted-foreground/50 pl-6 italic">
              No storyboard generated yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SeriesRoadmapPanel() {
  const projectId = useProjectId();
  const [bible, setBible] = useState<string>('');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [storyboards, setStoryboards] = useState<Map<number, StoryboardInfo>>(
    new Map()
  );
  const [variantImages, setVariantImages] = useState<Map<string, string>>(
    new Map()
  );
  const [expandedEp, setExpandedEp] = useState<number | null>(1);
  const [showBible, setShowBible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [seriesName, setSeriesName] = useState('');
  const [seriesMetadata, setSeriesMetadata] = useState<SeriesMetadata | null>(
    null
  );

  useEffect(() => {
    if (!projectId) return;

    async function load() {
      setLoading(true);
      const supabase = createClient('studio');

      // Find series for this project
      let seriesId: string | null = null;

      // Try project settings
      try {
        const projRes = await fetch(`/api/projects/${projectId}`);
        if (projRes.ok) {
          const projData = await projRes.json();
          seriesId = projData?.project?.settings?.series_id ?? null;
        }
      } catch {}

      // Fallback: series.project_id
      if (!seriesId) {
        const { data: series } = await supabase
          .from('series')
          .select('id')
          .eq('project_id', projectId)
          .limit(1)
          .maybeSingle();
        seriesId = series?.id ?? null;
      }

      if (!seriesId) {
        setSeriesMetadata(null);
        setLoading(false);
        return;
      }

      // Load series data
      const { data: series } = await supabase
        .from('series')
        .select('name, bible, metadata')
        .eq('id', seriesId)
        .single();

      // Load episodes from table (source of truth fallback)
      const { data: episodeRows } = await supabase
        .from('series_episodes')
        .select('episode_number, title, synopsis, storyboard_id')
        .eq('series_id', seriesId)
        .order('episode_number', { ascending: true });

      const episodesFromTable: Episode[] = (episodeRows ?? []).map((row) => ({
        number: row.episode_number,
        title: row.title || `Episode ${row.episode_number}`,
        summary: row.synopsis || 'No summary yet.',
        status: 'planned',
      }));

      const storyboardIdToEpisode = new Map<string, number>();
      for (const row of episodeRows ?? []) {
        if (row.storyboard_id) {
          storyboardIdToEpisode.set(row.storyboard_id, row.episode_number);
        }
      }

      let resolvedEpisodes: Episode[] = episodesFromTable;

      if (series) {
        setSeriesName(series.name || '');
        setBible(series.bible || '');
        setSeriesMetadata(
          series.metadata &&
            typeof series.metadata === 'object' &&
            !Array.isArray(series.metadata)
            ? (series.metadata as SeriesMetadata)
            : null
        );
      } else {
        setSeriesMetadata(null);
      }

      // Load only storyboards linked to episodes (not all project storyboards)
      const linkedSbIds = (episodeRows ?? [])
        .map((r) => r.storyboard_id)
        .filter(Boolean) as string[];

      const { data: sbs } = linkedSbIds.length
        ? await supabase
            .from('storyboards')
            .select('id, plan_status, mode, voiceover, plan')
            .in('id', linkedSbIds)
        : {
            data: [] as {
              id: string;
              plan_status: string | null;
              mode: string | null;
              voiceover: string | null;
              plan: Record<string, unknown> | null;
            }[],
          };

      if (sbs) {
        const sbMap = new Map<number, StoryboardInfo>();

        for (const sb of sbs) {
          // Try to match storyboard to episode by title or order
          const plan = sb.plan as Record<string, unknown> | null;
          const voiceoverList = plan?.voiceover_list;
          const { language: scriptLanguage, lines: scriptLines } =
            deriveScriptLines({
              voiceover: sb.voiceover || '',
              planVoiceoverList: voiceoverList,
            });

          // Load scenes with objects and backgrounds
          const { data: scenes } = await supabase
            .from('scenes')
            .select('id, order, prompt, multi_prompt, video_status, video_url')
            .eq('storyboard_id', sb.id)
            .order('order', { ascending: true });

          // Load objects and backgrounds for each scene
          const sceneIds = (scenes ?? []).map((s) => s.id);
          const { data: objects } = sceneIds.length
            ? await supabase
                .from('objects')
                .select(
                  'scene_id, scene_order, name, final_url, series_asset_variant_id'
                )
                .in('scene_id', sceneIds)
                .order('scene_order', { ascending: true })
            : { data: [] };

          const { data: backgrounds } = sceneIds.length
            ? await supabase
                .from('backgrounds')
                .select('scene_id, final_url')
                .in('scene_id', sceneIds)
                .limit(sceneIds.length)
            : { data: [] };

          // Collect all variant IDs for live image resolution
          const variantIds = (objects ?? [])
            .map(
              (o: { series_asset_variant_id?: string }) =>
                o.series_asset_variant_id
            )
            .filter(Boolean) as string[];

          if (variantIds.length > 0) {
            const { data: variantImgs } = await supabase
              .from('series_asset_variant_images')
              .select('variant_id, url')
              .in('variant_id', variantIds)
              .order('created_at', { ascending: false });

            if (variantImgs) {
              const imgMap = new Map<string, string>();
              for (const img of variantImgs) {
                if (img.url && !imgMap.has(img.variant_id)) {
                  imgMap.set(img.variant_id, img.url);
                }
              }
              setVariantImages((prev) => {
                const next = new Map(prev);
                for (const [k, v] of imgMap) next.set(k, v);
                return next;
              });
            }
          }

          // Group objects/backgrounds by scene
          const objectsByScene = new Map<string, SceneObject[]>();
          for (const obj of objects ?? []) {
            const existing = objectsByScene.get(obj.scene_id) || [];
            existing.push({
              name: obj.name || 'Unknown',
              imageUrl: obj.final_url,
              variantId: obj.series_asset_variant_id || null,
            });
            objectsByScene.set(obj.scene_id, existing);
          }

          const bgByScene = new Map<string, string>();
          for (const bg of backgrounds ?? []) {
            if (bg.final_url && !bgByScene.has(bg.scene_id)) {
              bgByScene.set(bg.scene_id, bg.final_url);
            }
          }

          const sbInfo: StoryboardInfo = {
            id: sb.id,
            plan_status: sb.plan_status || 'draft',
            mode: sb.mode || 'ref_to_video',
            voiceover: sb.voiceover || '',
            scriptLanguage,
            scriptLines,
            scenes: (scenes ?? []).map((s) => ({
              id: s.id,
              order: s.order,
              prompt: s.prompt,
              multi_prompt: s.multi_prompt,
              video_status: s.video_status,
              video_url: s.video_url,
              objects: objectsByScene.get(s.id) || [],
              background: bgByScene.has(s.id)
                ? { imageUrl: bgByScene.get(s.id)! }
                : null,
            })),
          };

          const epNumber = storyboardIdToEpisode.get(sb.id);
          if (epNumber) {
            sbMap.set(epNumber, sbInfo);
          }
        }

        setStoryboards(sbMap);

        // Update episode statuses from storyboard/scenes availability
        resolvedEpisodes = resolvedEpisodes.map((ep) => {
          const sb = sbMap.get(ep.number);
          if (!sb) return { ...ep, status: 'planned' };

          const total = sb.scenes.length;
          const done = sb.scenes.filter(
            (scene) => scene.video_status === 'success'
          ).length;

          if (total > 0 && done === total) {
            return { ...ep, status: 'done' };
          }

          return { ...ep, status: 'in_progress' };
        });
      }

      setEpisodes(resolvedEpisodes);
      setLoading(false);
    }

    load();
  }, [projectId]);

  // --- Realtime subscription for storyboard plan/status updates ---
  const storyboardEpMapRef = useRef<Map<string, number>>(new Map());

  // Keep the mapping up to date whenever storyboards state changes
  useEffect(() => {
    const map = new Map<string, number>();
    for (const [epNum, sb] of storyboards) {
      map.set(sb.id, epNum);
    }
    storyboardEpMapRef.current = map;
  }, [storyboards]);

  useEffect(() => {
    if (!projectId) return;

    const supabase = createClient('studio');
    const channel = supabase
      .channel(`roadmap_sb_${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'studio',
          table: 'storyboards',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const updated = payload.new as {
            id: string;
            plan_status?: string;
            plan?: Record<string, unknown> | null;
            voiceover?: string;
            mode?: string;
          };

          const epNumber = storyboardEpMapRef.current.get(updated.id);
          if (epNumber == null) return;

          const voiceoverList = updated.plan?.voiceover_list;
          const { language: scriptLanguage, lines: scriptLines } =
            deriveScriptLines({
              voiceover: updated.voiceover || '',
              planVoiceoverList: voiceoverList,
            });

          setStoryboards((prev) => {
            const next = new Map(prev);
            const existing = next.get(epNumber);
            if (existing) {
              next.set(epNumber, {
                ...existing,
                plan_status: updated.plan_status || existing.plan_status,
                mode: updated.mode || existing.mode,
                voiceover: updated.voiceover || existing.voiceover,
                scriptLanguage,
                scriptLines,
              });
            }
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const totalScenes = useMemo(() => {
    let total = 0;
    for (const [, sb] of storyboards) {
      total += sb.scenes.length;
    }
    return total;
  }, [storyboards]);

  const doneEpisodes = episodes.filter((e) => e.status === 'done').length;

  const generalFlowText = useMemo(() => {
    if (episodes.length === 0) return '';
    if (episodes.length === 1) return trimSentence(episodes[0].summary, 240);

    const first = trimSentence(episodes[0].summary, 140);
    const mid = trimSentence(
      episodes[Math.floor((episodes.length - 1) / 2)].summary,
      140
    );
    const last = trimSentence(episodes[episodes.length - 1].summary, 140);

    return [first, mid, last].filter(Boolean).join(' → ');
  }, [episodes]);

  const episodeRoadmapLines = useMemo(
    () =>
      episodes.map(
        (episode) =>
          `Bölüm ${episode.number}: ${episode.title} — ${trimSentence(episode.summary, 120)}`
      ),
    [episodes]
  );

  const metadataBadges = useMemo(() => {
    if (!seriesMetadata) return [];

    const badges: string[] = [];
    if (seriesMetadata.scene_mode) badges.push(seriesMetadata.scene_mode);
    if (seriesMetadata.aspect_ratio) badges.push(seriesMetadata.aspect_ratio);
    if (seriesMetadata.language) badges.push(seriesMetadata.language);
    if (typeof seriesMetadata.episode_count === 'number') {
      badges.push(`${seriesMetadata.episode_count} episodes`);
    }

    return badges;
  }, [seriesMetadata]);

  const metadataStyleText = useMemo(() => {
    if (!seriesMetadata?.style) return '';

    const parts: string[] = [];
    if (seriesMetadata.style.visual_style) {
      parts.push(seriesMetadata.style.visual_style);
    }
    if (seriesMetadata.style.setting) {
      parts.push(seriesMetadata.style.setting);
    }

    return parts.join(' • ');
  }, [seriesMetadata]);

  const metadataCustomNotes = seriesMetadata?.style?.custom_notes?.trim() ?? '';

  const metadataTtsText = useMemo(() => {
    if (!seriesMetadata?.tts_settings) return '';

    const model = seriesMetadata.tts_settings.model?.trim();
    const speed = seriesMetadata.tts_settings.speed;
    const speedText =
      typeof speed === 'number' && Number.isFinite(speed) ? `${speed}x` : null;

    if (!model && !speedText) return '';
    if (model && speedText) return `${model} • ${speedText}`;
    return model || speedText || '';
  }, [seriesMetadata]);

  const hasMetadataSection =
    metadataBadges.length > 0 ||
    Boolean(metadataStyleText) ||
    Boolean(metadataCustomNotes) ||
    Boolean(metadataTtsText);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-muted-foreground animate-pulse">
          Loading roadmap...
        </p>
      </div>
    );
  }

  if (episodes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center">
        <IconMovie className="size-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">
          No episodes planned yet.
        </p>
        <p className="text-[10px] text-muted-foreground/70 mt-1">
          Create episode outlines to see the full roadmap.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {/* Series header */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{seriesName}</p>
            <span className="text-[9px] text-muted-foreground">
              {doneEpisodes}/{episodes.length} episodes
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-muted/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500/60 rounded-full transition-all"
              style={{
                width: `${episodes.length > 0 ? (doneEpisodes / episodes.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        {hasMetadataSection && (
          <div className="rounded border border-border/30 bg-muted/15 p-2 space-y-1">
            <p className="text-[10px] font-medium">Series Metadata</p>

            {metadataBadges.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {metadataBadges.map((badge, index) => (
                  <Badge
                    key={`${badge}-${index}`}
                    variant="outline"
                    className="h-4 px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground bg-muted/20 border-border/40"
                  >
                    {badge}
                  </Badge>
                ))}
              </div>
            )}

            {metadataStyleText && (
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {metadataStyleText}
              </p>
            )}

            {metadataCustomNotes && (
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                <span className="mr-1">⚠️</span>
                {metadataCustomNotes}
              </p>
            )}

            {metadataTtsText && (
              <p className="text-[10px] text-muted-foreground">
                TTS: {metadataTtsText}
              </p>
            )}
          </div>
        )}

        {/* Genel akış */}
        <div className="rounded border border-border/30 bg-muted/15 p-2 space-y-1.5">
          <p className="text-[10px] font-medium">Genel Akış</p>
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            {generalFlowText || 'Genel akış henüz hazırlanmadı.'}
          </p>
        </div>

        {/* Bölüm haritası */}
        <Collapsible open={showBible} onOpenChange={setShowBible}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded bg-muted/20 border border-border/30 text-left hover:bg-muted/30 transition-colors"
            >
              <IconBook className="size-3 text-muted-foreground shrink-0" />
              <span className="text-[10px] font-medium flex-1">
                Bölüm Bölüm Ne Olacak?
              </span>
              {showBible ? (
                <IconChevronUp className="size-3 text-muted-foreground" />
              ) : (
                <IconChevronDown className="size-3 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-2 pt-1.5 pb-1 space-y-1">
              {episodeRoadmapLines.map((line, idx) => (
                <p
                  key={`roadmap-line-${idx}`}
                  className="text-[10px] text-muted-foreground leading-relaxed"
                >
                  • {line}
                </p>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Bible (collapsible) */}
        {bible && (
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
              <p className="text-[10px] text-muted-foreground leading-relaxed px-2 pt-1.5 pb-1">
                {bible}
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Episode list */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <IconPlayerPlay className="size-3 text-muted-foreground" />
            <span className="text-[10px] font-medium">
              Episodes ({episodes.length})
            </span>
            <span className="text-[9px] text-muted-foreground">
              · {totalScenes} scenes total
            </span>
          </div>

          {episodes.map((ep) => (
            <EpisodeCard
              key={ep.number}
              episode={ep}
              storyboard={storyboards.get(ep.number) ?? null}
              isExpanded={expandedEp === ep.number}
              onToggle={() =>
                setExpandedEp(expandedEp === ep.number ? null : ep.number)
              }
              variantImages={variantImages}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
