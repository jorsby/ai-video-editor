export const GRID_ASPECT_RATIO_OPTIONS = [
  { value: '1:1', label: '1:1 (Square)' },
  { value: '9:16', label: '9:16 (Portrait)' },
  { value: '16:9', label: '16:9 (Landscape)' },
] as const;

export const GRID_RESOLUTION_OPTIONS = [
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
] as const;

export type GridAspectRatio =
  (typeof GRID_ASPECT_RATIO_OPTIONS)[number]['value'];
export type GridResolution = (typeof GRID_RESOLUTION_OPTIONS)[number]['value'];

export const DEFAULT_GRID_ASPECT_RATIO: GridAspectRatio = '1:1';
export const DEFAULT_GRID_RESOLUTION: GridResolution = '2k';

export function isGridAspectRatio(value: unknown): value is GridAspectRatio {
  return GRID_ASPECT_RATIO_OPTIONS.some((option) => option.value === value);
}

export function isGridResolution(value: unknown): value is GridResolution {
  return GRID_RESOLUTION_OPTIONS.some((option) => option.value === value);
}

export function getGridOutputDimensions(
  aspectRatio: GridAspectRatio,
  resolution: GridResolution
): { width: number; height: number } {
  const longSide = resolution === '4k' ? 4096 : 2048;

  if (aspectRatio === '16:9') {
    return { width: longSide, height: Math.round((longSide * 9) / 16) };
  }

  if (aspectRatio === '9:16') {
    return { width: Math.round((longSide * 9) / 16), height: longSide };
  }

  return { width: longSide, height: longSide };
}

export function applyGridGenerationSettingsToPrompt(
  basePrompt: string,
  aspectRatio: GridAspectRatio,
  resolution: GridResolution
): string {
  const dimensions = getGridOutputDimensions(aspectRatio, resolution);

  return `${basePrompt}\n\nOutput requirements:\n- Final grid canvas aspect ratio must be ${aspectRatio}.\n- Render at ${resolution.toUpperCase()} quality around ${dimensions.width}x${dimensions.height}.\n- Keep all grid cells equal size with clear 1px black separators.`;
}
