'use client';

import type { VariantImageMap } from '../../shared/scene-types';
import { slugToLabel } from '../../shared/scene-types';
import { VariantAvatar } from './lightbox';

// ── Prompt Highlighter ─────────────────────────────────────────────────────────

export function HighlightedPrompt({
  prompt,
  locationSlug,
  characterSlugs,
  propSlugs,
  imageMap,
}: {
  prompt: string;
  locationSlug: string | null;
  characterSlugs: string[];
  propSlugs: string[];
  imageMap: VariantImageMap;
}) {
  const colorMap = new Map<string, string>();
  if (locationSlug)
    colorMap.set(locationSlug, 'text-emerald-400 bg-emerald-500/15');
  for (const s of characterSlugs)
    colorMap.set(s, 'text-blue-400 bg-blue-500/15');
  for (const s of propSlugs) colorMap.set(s, 'text-amber-400 bg-amber-500/15');

  const pattern = /@([a-z0-9]+(?:-[a-z0-9]+)*)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = pattern.exec(prompt);

  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(prompt.slice(lastIndex, match.index));
    }
    const slug = match[1];
    const color = colorMap.get(slug);
    if (color) {
      parts.push(
        <span
          key={match.index}
          className={`${color} rounded px-0.5 font-medium inline-flex items-center gap-0.5`}
        >
          <VariantAvatar slug={slug} imageMap={imageMap} />@{slugToLabel(slug)}
        </span>
      );
    } else {
      parts.push(
        <span
          key={match.index}
          className="text-purple-400 bg-purple-500/15 rounded px-0.5 font-medium"
        >
          @{slug}
        </span>
      );
    }
    lastIndex = match.index + match[0].length;
    match = pattern.exec(prompt);
  }
  if (lastIndex < prompt.length) {
    parts.push(prompt.slice(lastIndex));
  }

  return <>{parts}</>;
}
