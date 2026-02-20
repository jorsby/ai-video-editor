'use client';

import { ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type {
  CaptionStyleOptions as CaptionStyleOptionsType,
  CaptionLength,
  CaptionTone,
} from '@/types/caption-style';

interface CaptionStyleOptionsProps {
  value: CaptionStyleOptionsType;
  onChange: (value: CaptionStyleOptionsType) => void;
}

const LENGTH_OPTIONS: { value: CaptionLength; label: string; hint: string }[] =
  [
    { value: 'short', label: 'Short', hint: '1-2 sentences' },
    { value: 'medium', label: 'Medium', hint: '2-4 sentences' },
    { value: 'long', label: 'Long', hint: '4-8 sentences' },
  ];

const TONE_OPTIONS: { value: CaptionTone; label: string }[] = [
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
  { value: 'witty', label: 'Witty' },
  { value: 'inspirational', label: 'Inspirational' },
];

export function CaptionStyleOptions({
  value,
  onChange,
}: CaptionStyleOptionsProps) {
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="flex w-full items-center justify-between py-1">
        <span className="text-xs font-medium text-zinc-400">
          Style Options
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {LENGTH_OPTIONS.find((l) => l.value === value.length)?.label},{' '}
            {TONE_OPTIONS.find((t) => t.value === value.tone)?.label}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180" />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 pt-2">
          {/* Length selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground">Length</label>
            <div className="flex gap-2">
              {LENGTH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ ...value, length: opt.value })}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                    value.length === opt.value
                      ? 'border-purple-500 bg-purple-500/20 text-purple-400'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
                  }`}
                  title={opt.hint}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tone selector */}
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground">Tone</label>
            <div className="flex flex-wrap gap-1.5">
              {TONE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ ...value, tone: opt.value })}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-all ${
                    value.tone === opt.value
                      ? 'border-purple-500 bg-purple-500/20 text-purple-400'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
