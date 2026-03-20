'use client';

import { X, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProjectTagMap } from '@/types/project';

interface ProjectTagFilterProps {
  tags: ProjectTagMap;
  selectedTags: Map<string, 'include' | 'exclude'>;
  onToggleTag: (tag: string) => void;
  onClear: () => void;
}

export function ProjectTagFilter({
  tags,
  selectedTags,
  onToggleTag,
  onClear,
}: ProjectTagFilterProps) {
  const allTags = Array.from(new Set(Object.values(tags).flat())).sort();

  if (allTags.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">Filter:</span>
      {allTags.map((tag) => {
        const mode = selectedTags.get(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onToggleTag(tag)}
            className={`inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-xs transition-colors ${
              mode === 'include'
                ? 'bg-primary text-primary-foreground'
                : mode === 'exclude'
                  ? 'bg-destructive text-destructive-foreground line-through'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {mode === 'exclude' && <Minus className="h-3 w-3" />}
            {tag}
          </button>
        );
      })}
      {selectedTags.size > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-xs text-muted-foreground"
          onClick={onClear}
        >
          <X className="h-3 w-3 mr-0.5" />
          Clear
        </Button>
      )}
    </div>
  );
}
