'use client';

import type { InstagramOptions as InstagramOptionsType, InstagramPostType } from '@/types/post';

interface InstagramOptionsProps {
  value: InstagramOptionsType;
  onChange: (value: InstagramOptionsType) => void;
}

const POST_TYPES: { value: InstagramPostType; label: string }[] = [
  { value: 'post', label: 'Post' },
  { value: 'reel', label: 'Reel' },
  { value: 'story', label: 'Story' },
];

export function InstagramOptions({ value, onChange }: InstagramOptionsProps) {
  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-zinc-400">
        Instagram Post Type
      </label>
      <div className="flex gap-2">
        {POST_TYPES.map((pt) => (
          <button
            key={pt.value}
            type="button"
            onClick={() => onChange({ ...value, type: pt.value })}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
              value.type === pt.value
                ? 'border-pink-500 bg-pink-500/20 text-pink-400'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
            }`}
          >
            {pt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
