import { queueKieImageTask } from '@/lib/kie-image';

export interface ImageTaskParams {
  prompt: string;
  webhookUrl: string;
  aspectRatio?: string;
  resolution?: string;
}

export interface ImageTaskResult {
  requestId: string;
  model: string;
}

/**
 * Queue an image generation task via Kie.ai (Flux 2 Pro).
 */
export async function queueImageTask(
  params: ImageTaskParams
): Promise<ImageTaskResult> {
  const result = await queueKieImageTask({
    prompt: params.prompt,
    callbackUrl: params.webhookUrl,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
  });

  return {
    requestId: result.requestId,
    model: result.model,
  };
}
