'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface ProjectTagInputProps {
  projectId: string;
  tags: string[];
  onTagAdded: (projectId: string, tag: string) => void;
  onTagRemoved: (projectId: string, tag: string) => void;
}

export function ProjectTagInput({
  projectId,
  tags,
  onTagAdded,
  onTagRemoved,
}: ProjectTagInputProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  const handleAdd = () => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return;
    if (tags.includes(trimmed)) {
      setValue('');
      return;
    }
    onTagAdded(projectId, trimmed);
    setValue('');
  };

  return (
    <div
      className="flex items-center gap-1 flex-wrap"
      onClick={(e) => e.stopPropagation()}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTagRemoved(projectId, tag);
            }}
            className="ml-0.5 hover:text-destructive transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full"
            onClick={(e) => e.stopPropagation()}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-48 p-2"
          align="start"
          onClick={(e) => e.stopPropagation()}
        >
          <Input
            placeholder="Add tag..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
              if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            className="h-7 text-xs"
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
