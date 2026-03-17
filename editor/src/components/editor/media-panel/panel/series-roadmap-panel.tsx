'use client';

import { useEffect, useState, useMemo } from 'react';
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
  scenes: StoryboardScene[];
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

function SceneRow({
  scene,
  index,
  variantImages,
}: {
  scene: StoryboardScene;
  index: number;
  variantImages: Map<string, string>;
}) {
  const prompt = scene.prompt || 'No prompt yet';
  const videoStatus = scene.video_status || 'pending';

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

        <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-5">
          {episode.number}
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{episode.title}</p>
        </div>

        <Badge
          variant="outline"
          className={`text-[7px] px-1 py-0 h-3.5 shrink-0 ${statusConfig.color} border-current/30`}
        >
          {statusConfig.label}
        </Badge>

        {sceneCount > 0 && (
          <span className="text-[9px] text-muted-foreground shrink-0">
            {doneScenes}/{sceneCount}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="px-2.5 pb-2.5 space-y-2">
          <p className="text-[10px] text-muted-foreground leading-relaxed pl-6">
            {episode.summary}
          </p>

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
        setLoading(false);
        return;
      }

      // Load series data
      const { data: series } = await supabase
        .from('series')
        .select('name, bible, metadata')
        .eq('id', seriesId)
        .single();

      if (series) {
        setSeriesName(series.name || '');
        setBible(series.bible || '');
        const meta = series.metadata as { episodes?: Episode[] } | null;
        setEpisodes(meta?.episodes ?? []);
      }

      // Load storyboards with scenes
      const { data: sbs } = await supabase
        .from('storyboards')
        .select('id, plan_status, mode, voiceover, plan')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (sbs) {
        const sbMap = new Map<number, StoryboardInfo>();

        for (const sb of sbs) {
          // Try to match storyboard to episode by title or order
          const plan = sb.plan as Record<string, unknown> | null;
          const voiceoverList = plan?.voiceover_list;
          const scenePrompts = plan?.scene_prompts as string[] | undefined;

          // Load scenes with objects and backgrounds
          const { data: scenes } = await supabase
            .from('scenes')
            .select('id, order, prompt, video_status, video_url')
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
            scenes: (scenes ?? []).map((s) => ({
              id: s.id,
              order: s.order,
              prompt: s.prompt,
              video_status: s.video_status,
              video_url: s.video_url,
              objects: objectsByScene.get(s.id) || [],
              background: bgByScene.has(s.id)
                ? { imageUrl: bgByScene.get(s.id)! }
                : null,
            })),
          };

          // Match to episode 1 for now (we'll improve matching later)
          if (!sbMap.has(1) && sb.plan_status !== 'draft') {
            sbMap.set(1, sbInfo);
          }
        }

        setStoryboards(sbMap);
      }

      setLoading(false);
    }

    load();
  }, [projectId]);

  const totalScenes = useMemo(() => {
    let total = 0;
    for (const [, sb] of storyboards) {
      total += sb.scenes.length;
    }
    return total;
  }, [storyboards]);

  const doneEpisodes = episodes.filter((e) => e.status === 'done').length;

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

        {/* Bible (collapsible) */}
        {bible && (
          <Collapsible open={showBible} onOpenChange={setShowBible}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded bg-muted/20 border border-border/30 text-left hover:bg-muted/30 transition-colors"
              >
                <IconBook className="size-3 text-muted-foreground shrink-0" />
                <span className="text-[10px] font-medium flex-1">
                  Series Bible
                </span>
                {showBible ? (
                  <IconChevronUp className="size-3 text-muted-foreground" />
                ) : (
                  <IconChevronDown className="size-3 text-muted-foreground" />
                )}
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
