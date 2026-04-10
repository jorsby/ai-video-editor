// ── Model IDs ───────────────────────────────────────────────────────────
// Client-safe configs – no server-only imports (node:crypto etc.)

export type ImageModelId =
  | 'z-image'
  | 'gpt-image/1.5-text-to-image'
  | 'flux-2/pro-text-to-image'
  | 'flux-2/pro-image-to-image'
  | 'gpt-image/1.5-image-to-image'
  | 'nano-banana-2';

// ── Model configs ───────────────────────────────────────────────────────

export interface ImageModelConfig {
  supportedAspectRatios: Set<string>;
  defaultAspectRatio: string;
  supportsResolution: boolean;
  buildInput: (p: {
    prompt: string;
    aspectRatio: string;
    resolution?: string;
    inputUrls?: string[];
  }) => Record<string, unknown>;
}

export const IMAGE_MODEL_CONFIGS: Record<ImageModelId, ImageModelConfig> = {
  'z-image': {
    supportedAspectRatios: new Set(['1:1', '4:3', '3:4', '16:9', '9:16']),
    defaultAspectRatio: '9:16',
    supportsResolution: false,
    buildInput: ({ prompt, aspectRatio }) => ({
      prompt,
      aspect_ratio: aspectRatio,
      nsfw_checker: false,
    }),
  },
  'gpt-image/1.5-text-to-image': {
    supportedAspectRatios: new Set(['1:1', '2:3', '3:2']),
    defaultAspectRatio: '2:3',
    supportsResolution: false,
    buildInput: ({ prompt, aspectRatio }) => ({
      prompt,
      aspect_ratio: aspectRatio,
      quality: 'medium',
    }),
  },
  'flux-2/pro-text-to-image': {
    supportedAspectRatios: new Set([
      '1:1',
      '4:3',
      '3:4',
      '16:9',
      '9:16',
      '3:2',
      '2:3',
    ]),
    defaultAspectRatio: '9:16',
    supportsResolution: true,
    buildInput: ({ prompt, aspectRatio, resolution }) => ({
      prompt,
      aspect_ratio: aspectRatio,
      resolution: normalizeKieResolution(resolution),
      nsfw_checker: false,
    }),
  },
  'flux-2/pro-image-to-image': {
    supportedAspectRatios: new Set([
      '1:1',
      '4:3',
      '3:4',
      '16:9',
      '9:16',
      '3:2',
      '2:3',
      'auto',
    ]),
    defaultAspectRatio: '9:16',
    supportsResolution: true,
    buildInput: ({ prompt, aspectRatio, resolution, inputUrls }) => ({
      input_urls: inputUrls ?? [],
      prompt,
      aspect_ratio: aspectRatio,
      resolution: normalizeKieResolution(resolution, '2K'),
      nsfw_checker: false,
    }),
  },
  'gpt-image/1.5-image-to-image': {
    supportedAspectRatios: new Set(['1:1', '2:3', '3:2']),
    defaultAspectRatio: '2:3',
    supportsResolution: false,
    buildInput: ({ prompt, aspectRatio, inputUrls }) => ({
      input_urls: inputUrls ?? [],
      prompt,
      aspect_ratio: aspectRatio,
      quality: 'medium',
    }),
  },
  'nano-banana-2': {
    supportedAspectRatios: new Set([
      '1:1',
      '1:4',
      '1:8',
      '2:3',
      '3:2',
      '3:4',
      '4:1',
      '4:3',
      '4:5',
      '5:4',
      '8:1',
      '9:16',
      '16:9',
      '21:9',
      'auto',
    ]),
    defaultAspectRatio: '9:16',
    supportsResolution: true,
    buildInput: ({ prompt, aspectRatio, resolution, inputUrls }) => ({
      prompt,
      ...(inputUrls?.length ? { image_input: inputUrls } : {}),
      aspect_ratio: aspectRatio,
      resolution: normalizeKieResolution(resolution),
    }),
  },
};

export function isValidImageModel(model: string): model is ImageModelId {
  return model in IMAGE_MODEL_CONFIGS;
}

// ── Aspect ratio normalization ──────────────────────────────────────────

const ASPECT_RATIO_FALLBACKS: Array<[string, string]> = [
  ['4:3', '3:2'],
  ['3:4', '2:3'],
  ['16:9', '3:2'],
  ['9:16', '2:3'],
  ['3:2', '4:3'],
  ['2:3', '3:4'],
];

export function normalizeAspectRatioForModel(
  model: ImageModelId,
  value: string | null | undefined
): string {
  const config = IMAGE_MODEL_CONFIGS[model];
  const requested = (value ?? '').trim();

  if (requested && config.supportedAspectRatios.has(requested)) {
    return requested;
  }

  if (requested) {
    for (const [from, to] of ASPECT_RATIO_FALLBACKS) {
      if (from === requested && config.supportedAspectRatios.has(to)) {
        return to;
      }
    }
  }

  return config.defaultAspectRatio;
}

// ── Resolution normalization ────────────────────────────────────────────

export function normalizeKieResolution(
  value: string | null | undefined,
  fallback: '1K' | '2K' | '4K' = '1K'
): '1K' | '2K' | '4K' {
  const normalized = (value ?? '').trim().toUpperCase();

  if (normalized === '4K') return '4K';
  if (normalized === '2K') return '2K';
  if (normalized === '1K') return '1K';

  return fallback;
}

/** @deprecated Use normalizeAspectRatioForModel instead */
export function normalizeKieAspectRatio(
  value: string | null | undefined,
  fallback = '9:16'
): string {
  return normalizeAspectRatioForModel(
    'flux-2/pro-text-to-image',
    value ?? fallback
  );
}
