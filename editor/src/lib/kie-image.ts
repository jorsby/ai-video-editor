import { createTask } from '@/lib/kieai';

// Re-export everything from the client-safe configs module
export {
  type ImageModelId,
  type ImageModelConfig,
  IMAGE_MODEL_CONFIGS,
  isValidImageModel,
  normalizeAspectRatioForModel,
  normalizeKieResolution,
  normalizeKieAspectRatio,
} from '@/lib/kie-image-configs';

import {
  type ImageModelId,
  IMAGE_MODEL_CONFIGS,
  normalizeAspectRatioForModel,
} from '@/lib/kie-image-configs';

/** @deprecated Use IMAGE_MODEL_CONFIGS instead */
export const KIE_IMAGE_MODEL = 'flux-2/pro-text-to-image';

// ── Queue task ──────────────────────────────────────────────────────────

export async function queueKieImageTask(params: {
  prompt: string;
  callbackUrl: string;
  model?: ImageModelId;
  inputUrls?: string[];
  aspectRatio?: string;
  resolution?: string;
}) {
  const modelId = params.model ?? 'flux-2/pro-text-to-image';
  const config = IMAGE_MODEL_CONFIGS[modelId];

  if (!config) {
    throw new Error(`Unknown image model: ${modelId}`);
  }

  const aspectRatio = normalizeAspectRatioForModel(modelId, params.aspectRatio);
  const input = config.buildInput({
    prompt: params.prompt,
    aspectRatio,
    resolution: params.resolution,
    inputUrls: params.inputUrls,
  });

  const result = await createTask({
    model: modelId,
    callbackUrl: params.callbackUrl,
    input,
  });

  return {
    requestId: result.taskId,
    model: modelId,
    endpoint: 'https://api.kie.ai/api/v1/jobs/createTask',
  };
}
