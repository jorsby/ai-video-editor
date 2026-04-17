'use client';

import { useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { SceneData, VariantImageMap } from '../../shared/scene-types';
import { IconChevronDown, IconChevronUp, IconMovie } from '@tabler/icons-react';
import type { ChapterData } from './helpers';
import { ChapterAccordion } from './chapter-accordion';

// ── Chapters Section ──────────────────────────────────────────────────────────

export function ChaptersSection({
  chapters,
  imageMap,
  chapterSelectionStatus,
  toggleChapter,
  selectedSceneIds,
  onToggleScene,
  forceOpen,
  focusedSceneId,
  onSceneDeleted,
  renderToolbar,
  viewMode,
  onReorderScenes,
}: {
  chapters: ChapterData[];
  imageMap: VariantImageMap;
  chapterSelectionStatus: Map<string, 'none' | 'some' | 'all'>;
  toggleChapter: (id: string) => void;
  selectedSceneIds: Set<string>;
  onToggleScene: (sceneId: string) => void;
  forceOpen?: boolean | null;
  focusedSceneId?: string | null;
  onSceneDeleted: (chapterId: string, sceneId: string) => void;
  renderToolbar?: () => React.ReactNode;
  viewMode: 'card' | 'list';
  onReorderScenes: (chapterId: string, reorderedScenes: SceneData[]) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md bg-muted/15 border border-border/30 text-left hover:bg-muted/25 transition-colors"
        >
          <IconMovie className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium flex-1">Chapters</span>
          <span className="text-[9px] text-muted-foreground/60">
            {chapters.length}
          </span>
          {open ? (
            <IconChevronUp className="size-3 text-muted-foreground" />
          ) : (
            <IconChevronDown className="size-3 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {renderToolbar?.()}
        <div className="mt-1 space-y-1">
          {chapters.map((ep) => (
            <ChapterAccordion
              key={ep.id}
              chapter={ep}
              imageMap={imageMap}
              chapterSelectionStatus={
                chapterSelectionStatus.get(ep.id) ?? 'none'
              }
              onToggleChapter={() => toggleChapter(ep.id)}
              selectedSceneIds={selectedSceneIds}
              onToggleScene={onToggleScene}
              forceOpen={forceOpen}
              focusedSceneId={focusedSceneId}
              onSceneDeleted={(sceneId) => onSceneDeleted(ep.id, sceneId)}
              viewMode={viewMode}
              onReorderScenes={onReorderScenes}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
