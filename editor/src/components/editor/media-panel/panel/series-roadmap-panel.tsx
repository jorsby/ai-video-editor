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

interface StoryboardScene {
  id: string;
  order: number;
  prompt: string | null;
  video_status: string | null;
  video_url: string | null;
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

function SceneRow({ scene, index }: { scene: StoryboardScene; index: number }) {
  const prompt = scene.prompt || 'No prompt yet';
  const videoStatus = scene.video_status || 'pending';

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded bg-muted/10 border border-border/20">
      <span className="text-[9px] font-mono text-muted-foreground mt-0.5 shrink-0 w-4">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
          {prompt.length > 120 ? `${prompt.slice(0, 120)}...` : prompt}
        </p>
      </div>
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
  );
}

function EpisodeCard({
  episode,
  storyboard,
  isExpanded,
  onToggle,
}: {
  episode: Episode;
  storyboard: StoryboardInfo | null;
  isExpanded: boolean;
  onToggle: () => void;
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
                <SceneRow key={scene.id} scene={scene} index={i} />
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

          // Load scenes from DB
          const { data: scenes } = await supabase
            .from('scenes')
            .select('id, order, prompt, video_status, video_url')
            .eq('storyboard_id', sb.id)
            .order('order', { ascending: true });

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
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
