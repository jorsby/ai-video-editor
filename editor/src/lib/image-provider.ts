import { queueKieImageTask } from '@/lib/kie-image';
import { queueFalImageTask } from '@/lib/fal-image';

export type ImageProvider = 'kie' | 'fal';

export interface ImageTaskParams {
  provider: ImageProvider;
  prompt: string;
  webhookUrl: string;
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: string;
  imageInput?: string[];
}

export interface ImageTaskResult {
  requestId: string;
  model: string;
  provider: ImageProvider;
}

/**
 * Resolve provider string to a typed ImageProvider.
 * Defaults to 'kie' for any unrecognized value.
 */
export function resolveImageProvider(
  value: string | null | undefined
): ImageProvider {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'fal') return 'fal';
  return 'kie';
}

/**
 * Queue an image generation task with the appropriate provider.
 * Unified interface — callers don't need to know which provider is active.
 */
export async function queueImageTask(
  params: ImageTaskParams
): Promise<ImageTaskResult> {
  if (params.provider === 'fal') {
    const result = await queueFalImageTask({
      prompt: params.prompt,
      webhookUrl: params.webhookUrl,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      outputFormat: params.outputFormat,
      imageInput: params.imageInput,
      safetyTolerance: 6,
    });
    return result;
  }

  // Default: Kie.ai
  const result = await queueKieImageTask({
    prompt: params.prompt,
    callbackUrl: params.webhookUrl,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
    outputFormat: params.outputFormat,
    imageInput: params.imageInput,
  });

  return {
    requestId: result.requestId,
    model: result.model,
    provider: 'kie',
  };
}
