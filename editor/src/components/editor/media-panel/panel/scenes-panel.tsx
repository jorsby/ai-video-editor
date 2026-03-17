'use client';

import { useProjectId } from '@/contexts/project-context';
import { useSeriesEpisodes } from '@/hooks/use-series-episodes';
import { useMediaPanelStore } from '../store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { IconChevronDown, IconChevronUp, IconMovie } from '@tabler/icons-react';

function getStatusBadgeClasses(status: 'ready' | 'draft' | 'planned'): string {
  if (status === 'ready') {
    return 'border-green-500/40 bg-green-500/10 text-green-400';
  }

  if (status === 'draft') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-400';
  }

  return 'border-border/60 bg-secondary/20 text-muted-foreground';
}

function getStatusLabel(status: 'ready' | 'draft' | 'planned'): string {
  if (status === 'ready') return 'Ready';
  if (status === 'draft') return 'Draft';
  return 'Planned';
}

export default function ScenesPanel() {
  const projectId = useProjectId();
  const { isLoading, series, episodes, error } = useSeriesEpisodes(projectId);
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);
  const setSelectedStoryboardId = useMediaPanelStore(
    (state) => state.setSelectedStoryboardId
  );

  const readyCount = episodes.filter(
    (episode) => episode.status === 'ready'
  ).length;
  const plannedCount = episodes.filter(
    (episode) => episode.status === 'planned'
  ).length;

  const handleOpenEpisode = (storyboardId: string | null) => {
    if (!storyboardId) return;

    setSelectedStoryboardId(storyboardId);
    setActiveTab('storyboard');
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-muted-foreground animate-pulse">
          Loading scenes...
        </p>
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

  if (!series) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center">
        <IconMovie className="size-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">
          This project is not linked to a series yet.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        <Collapsible defaultOpen>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group w-full flex items-center justify-between px-2.5 py-2 rounded-md border border-border/40 bg-secondary/20 hover:bg-secondary/30 transition-colors"
            >
              <div className="text-left min-w-0">
                <p className="text-xs font-semibold truncate">
                  {series.name || 'Untitled Series'}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Series Bible
                </p>
              </div>
              <IconChevronDown className="size-3.5 text-muted-foreground group-data-[state=open]:hidden" />
              <IconChevronUp className="size-3.5 text-muted-foreground hidden group-data-[state=open]:block" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-2 px-1">
              <div className="flex flex-wrap gap-1.5">
                {series.genre ? (
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-secondary/30"
                  >
                    {series.genre}
                  </Badge>
                ) : null}
                {series.tone ? (
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-secondary/30"
                  >
                    {series.tone}
                  </Badge>
                ) : null}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {series.bible?.trim() || 'No bible yet.'}
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-medium">Episodes</p>
            <p className="text-[10px] text-muted-foreground">
              {episodes.length} total
            </p>
          </div>

          {episodes.length === 0 ? (
            <div className="rounded-md border border-border/40 bg-secondary/10 px-3 py-4 text-center text-[11px] text-muted-foreground">
              No episodes yet.
            </div>
          ) : (
            episodes.map((episode) => (
              <div
                key={episode.id}
                className="rounded-md border border-border/40 bg-secondary/10 px-3 py-2.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">
                      EP{episode.episodeNumber}: {episode.title || 'Untitled'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3">
                      {episode.synopsis?.trim() || 'No synopsis yet.'}
                    </p>
                  </div>

                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0.5 ${getStatusBadgeClasses(episode.status)}`}
                  >
                    {getStatusLabel(episode.status)}
                  </Badge>
                </div>

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[10px]"
                    disabled={!episode.storyboardId}
                    onClick={() => handleOpenEpisode(episode.storyboardId)}
                  >
                    Open
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
          {episodes.length} episodes • {readyCount} ready • {plannedCount}{' '}
          planned
        </div>
      </div>
    </ScrollArea>
  );
}
