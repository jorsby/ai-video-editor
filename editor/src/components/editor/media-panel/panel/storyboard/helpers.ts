import {
  type SceneData,
  type VariantImageMap,
  deriveSceneStatus,
} from '../../shared/scene-types';

// ── Types ──────────────────────────────────────────────────────────────────────

export type VideoOption = { id: string; name: string };

export interface ChapterData {
  id: string;
  order: number;
  title: string | null;
  synopsis: string | null;
  status: string | null;
  audio_content: string | null;
  visual_outline: string | null;
  asset_variant_map: {
    characters?: string[];
    locations?: string[];
    props?: string[];
  } | null;
  scenes: SceneData[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Get a thumbnail URL for a scene: location image > character image > video URL > null */
export function getSceneThumbnailUrl(
  scene: SceneData,
  imageMap: VariantImageMap
): string | null {
  if (scene.location_variant_slug) {
    const info = imageMap.get(scene.location_variant_slug);
    if (info?.image_url) return info.image_url;
  }
  for (const slug of scene.character_variant_slugs ?? []) {
    const info = imageMap.get(slug);
    if (info?.image_url) return info.image_url;
  }
  if (scene.video_url) return scene.video_url;
  return null;
}

/** Status to dot color class */
export function statusDotColor(status: string): string {
  switch (status) {
    case 'done':
      return 'bg-green-400';
    case 'generating':
      return 'bg-yellow-400';
    case 'failed':
      return 'bg-red-400';
    case 'partial':
      return 'bg-blue-400';
    default:
      return 'bg-muted-foreground/30';
  }
}

/** Derive chapter display status from its scenes */
export function deriveChapterStatus(chapter: ChapterData): string {
  if (chapter.scenes.length === 0) return 'draft';
  const statuses = chapter.scenes.map(deriveSceneStatus);
  if (statuses.some((s) => s === 'generating')) return 'generating';
  if (statuses.every((s) => s === 'done')) return 'done';
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'done' || s === 'partial')) return 'partial';
  return 'draft';
}
