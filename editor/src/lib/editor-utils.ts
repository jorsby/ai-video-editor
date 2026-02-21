import type { CanvasSize } from '@/types/editor';
import type { MediaType } from '@/types/media';
import { type Studio, Image, Video, Audio } from 'openvideo';

export interface MediaAsset {
  url: string;
  type: MediaType;
}

export async function addMediaToCanvas(
  studio: Studio,
  asset: MediaAsset,
  sceneSize = { width: 1080, height: 1920 }
): Promise<void> {
  if (asset.type === 'image') {
    const clip = await Image.fromUrl(`${asset.url}?v=${Date.now()}`);
    clip.display = { from: 0, to: 5 * 1e6 };
    clip.duration = 5 * 1e6;
    await clip.scaleToFit(sceneSize.width, sceneSize.height);
    clip.centerInScene(sceneSize.width, sceneSize.height);
    await studio.addClip(clip);
  } else if (asset.type === 'video') {
    const clip = await Video.fromUrl(asset.url);
    await studio.addClip(clip);
  } else if (asset.type === 'audio') {
    const clip = await Audio.fromUrl(asset.url);
    clip.volume = 0.35;
    await studio.addClip(clip, asset.url);
  }
}

export const DEFAULT_CANVAS_PRESETS = [
  { name: '16:9', width: 1920, height: 1080 },
  { name: '9:16', width: 1080, height: 1920 },
  { name: '1:1', width: 1080, height: 1080 },
  { name: '4:3', width: 1440, height: 1080 },
];

/**
 * Helper function to find the best matching canvas preset for an aspect ratio
 * @param aspectRatio The target aspect ratio to match
 * @returns The best matching canvas size
 */
export function findBestCanvasPreset(aspectRatio: number): CanvasSize {
  // Calculate aspect ratio for each preset and find the closest match
  let bestMatch = DEFAULT_CANVAS_PRESETS[0]; // Default to 16:9 HD
  let smallestDifference = Math.abs(
    aspectRatio - bestMatch.width / bestMatch.height
  );

  for (const preset of DEFAULT_CANVAS_PRESETS) {
    const presetAspectRatio = preset.width / preset.height;
    const difference = Math.abs(aspectRatio - presetAspectRatio);

    if (difference < smallestDifference) {
      smallestDifference = difference;
      bestMatch = preset;
    }
  }

  // If the difference is still significant (> 0.1), create a custom size
  // based on the media aspect ratio with a reasonable resolution
  const bestAspectRatio = bestMatch.width / bestMatch.height;
  if (Math.abs(aspectRatio - bestAspectRatio) > 0.1) {
    // Create custom dimensions based on the aspect ratio
    if (aspectRatio > 1) {
      // Landscape - use 1920 width
      return { width: 1920, height: Math.round(1920 / aspectRatio) };
    }
    // Portrait or square - use 1080 height
    return { width: Math.round(1080 * aspectRatio), height: 1080 };
  }

  return { width: bestMatch.width, height: bestMatch.height };
}
