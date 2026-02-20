'use client';

import { Input } from '@/components/ui/input';
import type { YouTubeOptions as YouTubeOptionsType, YouTubePrivacy } from '@/types/post';

interface YouTubeOptionsProps {
  value: YouTubeOptionsType;
  onChange: (value: YouTubeOptionsType) => void;
}

const PRIVACY_OPTIONS: { value: YouTubePrivacy; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
  { value: 'unlisted', label: 'Unlisted' },
];

export function YouTubeOptions({ value, onChange }: YouTubeOptionsProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium text-zinc-400">
          YouTube Title
        </label>
        <Input
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="Video title..."
          className="bg-zinc-900/40 border-white/[0.08] text-sm"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-zinc-400">Privacy</label>
        <div className="flex gap-2">
          {PRIVACY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...value, status: opt.value })}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                value.status === opt.value
                  ? 'border-red-500 bg-red-500/20 text-red-400'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
