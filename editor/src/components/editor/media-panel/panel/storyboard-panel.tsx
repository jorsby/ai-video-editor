'use client';

import { useEffect, useState } from 'react';
import { useProjectId } from '@/contexts/project-context';
import { createClient } from '@/lib/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  IconChevronDown,
  IconChevronUp,
  IconMovie,
  IconPhoto,
  IconVolume,
  IconVideo,
  IconMapPin,
  IconUser,
  IconBox,
  IconLoader2,
} from '@tabler/icons-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SceneData {
  id: string;
  order: number;
  title: string | null;
  prompt: string | null;
  audio_text: string | null;
  audio_url: string | null;
  video_url: string | null;
  status: string | null;
  duration: number | null;
  location_variant_slug: string | null;
  character_variant_slugs: string[];
  prop_variant_slugs: string[];
}

interface EpisodeData {
  id: string;
  order: number;
  title: string | null;
  synopsis: string | null;
  status: string | null;
  audio_content: string | null;
  visual_outline: string | null;
  asset_variant_map: {
    characters?: string[];
    locations?: string[];
    props?: string[];
  } | null;
  scenes: SceneData[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: string | null): string {
  switch (status) {
    case 'done':
      return 'border-green-500/40 bg-green-500/10 text-green-400';
    case 'ready':
    case 'in_progress':
      return 'border-blue-500/40 bg-blue-500/10 text-blue-400';
    case 'failed':
      return 'border-red-500/40 bg-red-500/10 text-red-400';
    default:
      return 'border-border/60 bg-secondary/20 text-muted-foreground';
  }
}

function slugToLabel(slug: string): string {
  return slug
    .replace(/-main$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Scene Card ─────────────────────────────────────────────────────────────────

function SceneCard({ scene, index }: { scene: SceneData; index: number }) {
  const hasAudio = !!scene.audio_url;
  const hasVideo = !!scene.video_url;
  const hasPrompt = !!scene.prompt;
  const charCount = scene.character_variant_slugs?.length ?? 0;
  const hasLocation = !!scene.location_variant_slug;
  const propCount = scene.prop_variant_slugs?.length ?? 0;

  return (
    <div className="border border-border/40 rounded-md bg-card/50 overflow-hidden">
      {/* Scene header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border/30">
        <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0">
          S{index + 1}
        </span>
        <span className="text-xs font-medium truncate flex-1">
          {scene.title || `Scene ${index + 1}`}
        </span>
        <Badge variant="outline" className={`text-[9px] ${statusColor(scene.status)}`}>
          {scene.status || 'draft'}
        </Badge>
        {scene.duration && (
          <span className="text-[10px] text-muted-foreground">{scene.duration}s</span>
        )}
      </div>

      {/* Scene body */}
      <div className="px-3 py-2 space-y-2">
        {/* Narration */}
        {scene.audio_text && (
          <p className="text-[11px] text-muted-foreground leading-relaxed italic line-clamp-2">
            &ldquo;{scene.audio_text}&rdquo;
          </p>
        )}

        {/* Asset refs */}
        <div className="flex flex-wrap gap-1">
          {hasLocation && (
            <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <IconMapPin className="size-2.5" />
              {slugToLabel(scene.location_variant_slug!)}
            </span>
          )}
          {scene.character_variant_slugs?.map((slug) => (
            <span
              key={slug}
              className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20"
            >
              <IconUser className="size-2.5" />
              {slugToLabel(slug)}
            </span>
          ))}
          {scene.prop_variant_slugs?.map((slug) => (
            <span
              key={slug}
              className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20"
            >
              <IconBox className="size-2.5" />
              {slugToLabel(slug)}
            </span>
          ))}
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className={hasPrompt ? 'text-green-400' : 'opacity-30'} title="Visual prompt">
            <IconPhoto className="size-3 inline mr-0.5" />
            Prompt
          </span>
          <span className={hasAudio ? 'text-green-400' : 'opacity-30'} title="Audio/TTS">
            <IconVolume className="size-3 inline mr-0.5" />
            Audio
          </span>
          <span className={hasVideo ? 'text-green-400' : 'opacity-30'} title="Video">
            <IconVideo className="size-3 inline mr-0.5" />
            Video
          </span>
          <span className="ml-auto opacity-50">
            {charCount}ch {hasLocation ? '1loc' : '0loc'} {propCount}pr
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Episode Accordion ──────────────────────────────────────────────────────────

function EpisodeAccordion({ episode }: { episode: EpisodeData }) {
  const [isOpen, setIsOpen] = useState(false);
  const sceneCount = episode.scenes.length;
  const doneCount = episode.scenes.filter((s) => s.status === 'done').length;
  const hasAnyVideo = episode.scenes.some((s) => !!s.video_url);
  const hasAnyAudio = episode.scenes.some((s) => !!s.audio_url);
  const totalDuration = episode.scenes.reduce((sum, s) => sum + (s.duration || 0), 0);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors rounded-md text-left"
        >
          {isOpen ? (
            <IconChevronUp className="size-3.5 text-muted-foreground shrink-0" />
          ) : (
            <IconChevronDown className="size-3.5 text-muted-foreground shrink-0" />
          )}

          <span className="text-[10px] font-mono text-muted-foreground w-8 shrink-0">
            EP{episode.order}
          </span>

          <span className="text-xs font-medium truncate flex-1">
            {episode.title?.replace(/^EP\d+\s*[-—]\s*/, '') || `Episode ${episode.order}`}
          </span>

          {/* Scene progress */}
          <span className="text-[10px] text-muted-foreground shrink-0">
            {doneCount}/{sceneCount}
          </span>

          <Badge variant="outline" className={`text-[9px] shrink-0 ${statusColor(episode.status)}`}>
            {episode.status || 'draft'}
          </Badge>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="pl-4 pr-1 pb-3 space-y-2">
          {/* Episode summary bar */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground px-2 py-1.5 bg-muted/15 rounded">
            <span>{sceneCount} scenes</span>
            <span>{totalDuration}s total</span>
            <span className={hasAnyAudio ? 'text-green-400' : 'opacity-30'}>
              <IconVolume className="size-3 inline" /> Audio
            </span>
            <span className={hasAnyVideo ? 'text-green-400' : 'opacity-30'}>
              <IconVideo className="size-3 inline" /> Video
            </span>
          </div>

          {/* Synopsis */}
          {episode.synopsis && (
            <p className="text-[10px] text-muted-foreground/70 px-2 line-clamp-2">
              {episode.synopsis}
            </p>
          )}

          {/* Scenes */}
          {episode.scenes.length > 0 ? (
            <div className="space-y-1.5">
              {episode.scenes.map((scene, i) => (
                <SceneCard key={scene.id} scene={scene} index={i} />
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground/50 px-2 py-4 text-center">
              No scenes yet
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export default function StoryboardPanel() {
  const projectId = useProjectId();
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [seriesName, setSeriesName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!projectId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      const supabase = createClient('studio');

      try {
        // Find series for this project
        const { data: seriesRow } = await supabase
          .from('series')
          .select('id, name')
          .eq('project_id', projectId)
          .limit(1)
          .maybeSingle();

        if (!seriesRow) {
          if (!cancelled) {
            setEpisodes([]);
            setIsLoading(false);
          }
          return;
        }

        if (!cancelled) setSeriesName(seriesRow.name);

        // Fetch episodes
        const { data: epRows, error: epError } = await supabase
          .from('episodes')
          .select(
            'id, "order", title, synopsis, status, audio_content, visual_outline, asset_variant_map'
          )
          .eq('series_id', seriesRow.id)
          .order('"order"', { ascending: true });

        if (epError) throw new Error(epError.message);

        // Fetch all scenes for these episodes
        const epIds = (epRows ?? []).map((e: { id: string }) => e.id);
        let allScenes: SceneData[] = [];
        if (epIds.length > 0) {
          const { data: sceneRows, error: scError } = await supabase
            .from('scenes')
            .select(
              'id, episode_id, "order", title, prompt, audio_text, audio_url, video_url, status, duration, location_variant_slug, character_variant_slugs, prop_variant_slugs'
            )
            .in('episode_id', epIds)
            .order('"order"', { ascending: true });

          if (scError) throw new Error(scError.message);
          allScenes = (sceneRows ?? []) as unknown as (SceneData & { episode_id: string })[];
        }

        // Group scenes by episode
        const scenesByEp = new Map<string, SceneData[]>();
        for (const s of allScenes as (SceneData & { episode_id: string })[]) {
          const arr = scenesByEp.get(s.episode_id) ?? [];
          arr.push(s);
          scenesByEp.set(s.episode_id, arr);
        }

        const parsed: EpisodeData[] = (epRows ?? []).map((ep: any) => ({
          id: ep.id,
          order: ep.order,
          title: ep.title,
          synopsis: ep.synopsis,
          status: ep.status,
          audio_content: ep.audio_content,
          visual_outline: ep.visual_outline,
          asset_variant_map: ep.asset_variant_map,
          scenes: scenesByEp.get(ep.id) ?? [],
        }));

        if (!cancelled) {
          setEpisodes(parsed);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load');
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-xs text-destructive text-center">{error}</p>
      </div>
    );
  }

  if (episodes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center gap-2">
        <IconMovie className="size-8 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">No episodes yet.</p>
        <p className="text-[10px] text-muted-foreground/50">
          Create episodes via API to see the storyboard.
        </p>
      </div>
    );
  }

  // Stats
  const totalScenes = episodes.reduce((s, e) => s + e.scenes.length, 0);
  const doneScenes = episodes.reduce(
    (s, e) => s + e.scenes.filter((sc) => sc.status === 'done').length,
    0
  );
  const totalDuration = episodes.reduce(
    (s, e) => s + e.scenes.reduce((ss, sc) => ss + (sc.duration || 0), 0),
    0
  );

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-1">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold">{seriesName || 'Storyboard'}</h3>
            <p className="text-[10px] text-muted-foreground">
              {episodes.length} episodes · {totalScenes} scenes · {Math.round(totalDuration / 60)}min {totalDuration % 60}s
            </p>
          </div>
          <Badge variant="outline" className="text-[9px]">
            {doneScenes}/{totalScenes} done
          </Badge>
        </div>

        {/* Episode list */}
        {episodes.map((ep) => (
          <EpisodeAccordion key={ep.id} episode={ep} />
        ))}
      </div>
    </ScrollArea>
  );
}
