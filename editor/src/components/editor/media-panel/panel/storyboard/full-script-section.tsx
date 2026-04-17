'use client';

import { useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  IconChevronDown,
  IconChevronUp,
  IconFileText,
} from '@tabler/icons-react';
import { CopyButton } from '../../shared/copy-button';
import type { ChapterData } from './helpers';

// ── Full Script Section ────────────────────────────────────────────────────────

export function FullScriptSection({ chapters }: { chapters: ChapterData[] }) {
  const [isOpen, setIsOpen] = useState(false);

  // Gather all voiceover text grouped by chapter (fall back to chapter audio_content)
  const scriptChapters = chapters
    .map((ch) => {
      const sceneLines = ch.scenes
        .filter((s) => s.audio_text)
        .map((s) => s.audio_text as string);
      const lines =
        sceneLines.length > 0
          ? sceneLines
          : ch.audio_content
            ? [ch.audio_content]
            : [];
      return { order: ch.order, title: ch.title, lines };
    })
    .filter((ch) => ch.lines.length > 0);

  if (scriptChapters.length === 0) return null;

  const totalLines = scriptChapters.reduce(
    (sum, ch) => sum + ch.lines.length,
    0
  );
  const fullText = scriptChapters
    .map(
      (ch) => `CH${ch.order}: ${ch.title ?? 'Untitled'}\n${ch.lines.join('\n')}`
    )
    .join('\n\n');

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md bg-muted/15 border border-border/30 text-left hover:bg-muted/25 transition-colors"
        >
          <IconFileText className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium flex-1">Full Script</span>
          <span className="text-[9px] text-muted-foreground/60">
            {totalLines} lines
          </span>
          {isOpen ? (
            <IconChevronUp className="size-3 text-muted-foreground" />
          ) : (
            <IconChevronDown className="size-3 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mb-2 rounded-md border border-border/20 bg-background/50 overflow-hidden">
          {/* Copy all button */}
          <div className="flex items-center justify-end px-2.5 py-1.5 border-b border-border/20">
            <CopyButton text={fullText} />
          </div>
          {/* Script content */}
          <div className="px-3 py-2 space-y-3 max-h-[400px] overflow-y-auto">
            {scriptChapters.map((ch) => (
              <div key={ch.order}>
                <h4 className="text-[11px] font-semibold text-foreground/80 mb-1">
                  CH{ch.order}: {ch.title ?? 'Untitled'}
                </h4>
                <div className="space-y-1">
                  {ch.lines.map((line, i) => (
                    <p
                      key={`${ch.order}-${i}`}
                      className="text-[11px] text-muted-foreground leading-relaxed"
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
