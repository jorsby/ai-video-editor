import {
  type ImageModelId,
  IMAGE_MODEL_CONFIGS,
  queueKieImageTask,
} from '@/lib/kie-image';

export interface ImageTaskParams {
  prompt: string;
  webhookUrl: string;
  model?: ImageModelId;
  inputUrls?: string[];
  aspectRatio?: string;
  resolution?: string;
}

export interface ImageTaskResult {
  requestId: string;
  model: string;
}

// ── Default model mappings ──────────────────────────────────────────────

/** Text-to-image defaults per asset type (configurable via videos.image_models) */
export const DEFAULT_T2I_MODELS: Record<string, ImageModelId> = {
  character: 'z-image',
  location: 'gpt-image/1.5-text-to-image',
  prop: 'z-image',
};

/** Image-to-image defaults per asset type (configurable via videos.image_models with _i2i suffix) */
export const DEFAULT_I2I_MODELS: Record<string, ImageModelId> = {
  character: 'flux-2/pro-image-to-image',
  location: 'gpt-image/1.5-image-to-image',
  prop: 'flux-2/pro-image-to-image',
};

/**
 * Resolve the text-to-image model for an asset type.
 * Reads from video.image_models JSONB, falls back to defaults.
 */
export function getT2iModel(
  imageModels: Record<string, string> | null | undefined,
  assetType: string
): ImageModelId {
  const model = imageModels?.[assetType];
  if (model && model in IMAGE_MODEL_CONFIGS) return model as ImageModelId;
  return (DEFAULT_T2I_MODELS[assetType] ?? 'z-image') as ImageModelId;
}

/**
 * Resolve the image-to-image model for an asset type.
 * Reads from video.image_models JSONB (e.g. "character_i2i"), falls back to defaults.
 */
export function getI2iModel(
  imageModels: Record<string, string> | null | undefined,
  assetType: string
): ImageModelId {
  const key = `${assetType}_i2i`;
  const model = imageModels?.[key];
  if (model && model in IMAGE_MODEL_CONFIGS) return model as ImageModelId;
  return (DEFAULT_I2I_MODELS[assetType] ??
    'flux-2/pro-image-to-image') as ImageModelId;
}

// ── Per-model settings resolvers ──────────────────────────────────────

/**
 * Resolve the image aspect ratio for a specific asset type + slot.
 * Reads from image_models JSONB keys like "character_aspect_ratio" or "location_i2i_aspect_ratio".
 * Falls back to the global aspect_ratio, then the model's default.
 */
export function getImageAspectRatio(
  imageModels: Record<string, string> | null | undefined,
  assetType: string,
  isI2i: boolean,
  globalFallback?: string
): string {
  const suffix = isI2i ? '_i2i' : '';
  const key = `${assetType}${suffix}_aspect_ratio`;
  const stored = imageModels?.[key];
  if (stored) return stored;
  return globalFallback ?? '9:16';
}

/**
 * Resolve the image resolution for a specific asset type + slot.
 * Reads from image_models JSONB keys like "character_resolution" or "location_i2i_resolution".
 * Falls back to '2K' (matching previous hardcoded behavior).
 */
export function getImageResolution(
  imageModels: Record<string, string> | null | undefined,
  assetType: string,
  isI2i: boolean
): string {
  const suffix = isI2i ? '_i2i' : '';
  const key = `${assetType}${suffix}_resolution`;
  return imageModels?.[key] ?? '2K';
}

// ── Queue task ──────────────────────────────────────────────────────────

/**
 * Queue an image generation task via Kie.ai.
 * Supports text-to-image and image-to-image models.
 */
export async function queueImageTask(
  params: ImageTaskParams
): Promise<ImageTaskResult> {
  const result = await queueKieImageTask({
    prompt: params.prompt,
    callbackUrl: params.webhookUrl,
    model: params.model,
    inputUrls: params.inputUrls,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
  });

  return {
    requestId: result.requestId,
    model: result.model,
  };
}
