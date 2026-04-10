'use client';

import { useProjectId } from '@/contexts/project-context';
import { useVideoChapters } from '@/hooks/use-video-chapters';
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
  const { isLoading, video, chapters, error } = useVideoChapters(projectId);
  const setActiveTab = useMediaPanelStore((state) => state.setActiveTab);

  const readyCount = chapters.filter(
    (chapter) => chapter.status === 'ready'
  ).length;
  const plannedCount = chapters.filter(
    (chapter) => chapter.status === 'planned'
  ).length;

  const handleOpenChapter = (_chapterId: string | null) => {
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

  if (!video) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center">
        <IconMovie className="size-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">
          This project is not linked to a video yet.
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
                  {video.name || 'Untitled Video'}
                </p>
                <p className="text-[10px] text-muted-foreground">Video Bible</p>
              </div>
              <IconChevronDown className="size-3.5 text-muted-foreground group-data-[state=open]:hidden" />
              <IconChevronUp className="size-3.5 text-muted-foreground hidden group-data-[state=open]:block" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-2 px-1">
              <div className="flex flex-wrap gap-1.5">
                {video.genre ? (
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-secondary/30"
                  >
                    {video.genre}
                  </Badge>
                ) : null}
                {video.tone ? (
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-secondary/30"
                  >
                    {video.tone}
                  </Badge>
                ) : null}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {video.bible?.trim() || 'No bible yet.'}
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-medium">Chapters</p>
            <p className="text-[10px] text-muted-foreground">
              {chapters.length} total
            </p>
          </div>

          {chapters.length === 0 ? (
            <div className="rounded-md border border-border/40 bg-secondary/10 px-3 py-4 text-center text-[11px] text-muted-foreground">
              No chapters yet.
            </div>
          ) : (
            chapters.map((chapter) => (
              <div
                key={chapter.id}
                className="rounded-md border border-border/40 bg-secondary/10 px-3 py-2.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">
                      EP{chapter.chapterNumber}: {chapter.title || 'Untitled'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-3">
                      {chapter.synopsis?.trim() || 'No synopsis yet.'}
                    </p>
                  </div>

                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0.5 ${getStatusBadgeClasses(chapter.status)}`}
                  >
                    {getStatusLabel(chapter.status)}
                  </Badge>
                </div>

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[10px]"
                    disabled={!chapter.storyboardId}
                    onClick={() => handleOpenChapter(chapter.storyboardId)}
                  >
                    Open
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
          {chapters.length} chapters • {readyCount} ready • {plannedCount}{' '}
          planned
        </div>
      </div>
    </ScrollArea>
  );
}
