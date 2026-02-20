'use client';

import type { FacebookOptions as FacebookOptionsType, FacebookPostType } from '@/types/post';

interface FacebookOptionsProps {
  value: FacebookOptionsType;
  onChange: (value: FacebookOptionsType) => void;
}

const POST_TYPES: { value: FacebookPostType; label: string }[] = [
  { value: 'post', label: 'Post' },
  { value: 'reel', label: 'Reel' },
  { value: 'story', label: 'Story' },
];

export function FacebookOptions({ value, onChange }: FacebookOptionsProps) {
  return (
    <div className="space-y-3">
      <label className="text-xs font-medium text-zinc-400">
        Facebook Post Type
      </label>
      <div className="flex gap-2">
        {POST_TYPES.map((pt) => (
          <button
            key={pt.value}
            type="button"
            onClick={() => onChange({ ...value, type: pt.value })}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
              value.type === pt.value
                ? 'border-blue-500 bg-blue-500/20 text-blue-400'
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
