'use client';

import type { SceneData, VariantImageMap } from '../../shared/scene-types';
import { deriveSceneStatus, formatDuration } from '../../shared/scene-types';
import { IconPhoto, IconMovie } from '@tabler/icons-react';
import {
  getSceneThumbnailUrl,
  statusDotColor,
  type ChapterData,
} from './helpers';

// ── Compact Scene List Row ────────────────────────────────────────────────────

export function SceneListRow({
  scene,
  index,
  imageMap,
  isSelected,
  onToggleSelected,
}: {
  scene: SceneData;
  index: number;
  imageMap: VariantImageMap;
  isSelected: boolean;
  onToggleSelected: () => void;
}) {
  const status = deriveSceneStatus(scene);
  const thumbUrl = getSceneThumbnailUrl(scene, imageMap);

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted/20 rounded transition-colors">
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggleSelected}
        onClick={(e) => e.stopPropagation()}
        className="size-3 rounded border-border/60 bg-background accent-primary shrink-0"
      />
      <div className="size-5 rounded overflow-hidden bg-muted/20 shrink-0 flex items-center justify-center">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            className="w-full h-full object-cover"
            loading="lazy"
            alt=""
          />
        ) : (
          <IconPhoto className="size-2.5 text-muted-foreground/30" />
        )}
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0">
        S{index + 1}
      </span>
      <span className="text-[11px] truncate flex-1">
        {scene.title || `Scene ${index + 1}`}
      </span>
      <div
        className={`size-2 rounded-full shrink-0 ${statusDotColor(status)}`}
      />
      <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">
        {formatDuration(scene.audio_duration ?? scene.video_duration ?? 0)}
      </span>
    </div>
  );
}

// ── Scene Thumbnail Strip ─────────────────────────────────────────────────────

export function SceneThumbnailStrip({
  chapters,
  imageMap,
  focusedSceneId,
  onSceneClick,
}: {
  chapters: ChapterData[];
  imageMap: VariantImageMap;
  focusedSceneId: string | null;
  onSceneClick: (sceneId: string) => void;
}) {
  const allScenes = chapters.flatMap((ch) => ch.scenes);
  if (allScenes.length === 0) return null;

  return (
    <div className="flex gap-1 overflow-x-auto pb-1 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 [&::-webkit-scrollbar-thumb]:rounded">
      {allScenes.map((scene, i) => {
        const thumbUrl = getSceneThumbnailUrl(scene, imageMap);
        const status = deriveSceneStatus(scene);
        const isFocused = scene.id === focusedSceneId;

        return (
          <button
            key={scene.id}
            type="button"
            onClick={() => onSceneClick(scene.id)}
            className={`relative shrink-0 w-12 h-8 rounded overflow-hidden border transition-colors ${
              isFocused
                ? 'border-primary ring-1 ring-primary/30'
                : 'border-border/30 hover:border-primary/50'
            }`}
            title={scene.title || `Scene ${i + 1}`}
          >
            {thumbUrl ? (
              <img
                src={thumbUrl}
                className="w-full h-full object-cover"
                loading="lazy"
                alt=""
              />
            ) : (
              <div className="w-full h-full bg-muted/30 flex items-center justify-center">
                <IconMovie className="size-3 text-muted-foreground/30" />
              </div>
            )}
            <span className="absolute bottom-0 inset-x-0 text-[7px] text-white bg-black/60 text-center leading-tight">
              {i + 1}
            </span>
            <div
              className={`absolute top-0.5 right-0.5 size-1.5 rounded-full ${statusDotColor(status)}`}
            />
          </button>
        );
      })}
    </div>
  );
}
