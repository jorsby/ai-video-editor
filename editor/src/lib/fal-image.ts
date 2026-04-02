import { createFalClient } from '@fal-ai/client';

const FAL_IMAGE_MODEL = 'fal-ai/nano-banana-2';

type FalAspectRatio =
  | 'auto'
  | '21:9'
  | '16:9'
  | '3:2'
  | '4:3'
  | '5:4'
  | '1:1'
  | '4:5'
  | '3:4'
  | '2:3'
  | '9:16'
  | '4:1'
  | '1:4'
  | '8:1'
  | '1:8';

type FalOutputFormat = 'jpeg' | 'png' | 'webp';
type FalResolution = '0.5K' | '1K' | '2K' | '4K';
type FalSafetyTolerance = 1 | 2 | 3 | 4 | 5 | 6;

const FAL_ASPECT_RATIOS = new Set<string>([
  'auto',
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '5:4',
  '1:1',
  '4:5',
  '3:4',
  '2:3',
  '9:16',
  '4:1',
  '1:4',
  '8:1',
  '1:8',
]);

function getFalClient() {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new Error('FAL_KEY is not configured');
  }
  return createFalClient({ credentials: key });
}

export function normalizeFalAspectRatio(
  value: string | null | undefined,
  fallback = 'auto'
): FalAspectRatio {
  const normalized = (value ?? '').trim();
  if (normalized && FAL_ASPECT_RATIOS.has(normalized)) {
    return normalized as FalAspectRatio;
  }
  return (
    FAL_ASPECT_RATIOS.has(fallback) ? fallback : 'auto'
  ) as FalAspectRatio;
}

export function normalizeFalResolution(
  value: string | null | undefined
): FalResolution {
  const normalized = (value ?? '').trim().toUpperCase();
  if (normalized === '4K') return '4K';
  if (normalized === '2K') return '2K';
  if (normalized === '0.5K') return '0.5K';
  return '1K';
}

export function normalizeFalOutputFormat(
  value: string | null | undefined
): FalOutputFormat {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'png') return 'png';
  if (normalized === 'webp') return 'webp';
  return 'jpeg';
}

export interface QueueFalImageParams {
  prompt: string;
  webhookUrl: string;
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: string;
  safetyTolerance?: FalSafetyTolerance;
  imageInput?: string[];
}

export interface QueueFalImageResult {
  requestId: string;
  model: string;
  provider: 'fal';
}

/**
 * Queue an image generation task on fal.ai with webhook callback.
 * Uses fal queue.submit → webhook pattern (same async flow as Kie.ai).
 */
export async function queueFalImageTask(
  params: QueueFalImageParams
): Promise<QueueFalImageResult> {
  const fal = getFalClient();

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    num_images: 1,
    aspect_ratio: normalizeFalAspectRatio(params.aspectRatio, 'auto'),
    resolution: normalizeFalResolution(params.resolution),
    output_format: normalizeFalOutputFormat(params.outputFormat),
    safety_tolerance: params.safetyTolerance ?? 6,
    limit_generations: true,
  };

  if (Array.isArray(params.imageInput) && params.imageInput.length > 0) {
    input.image_input = params.imageInput.slice(0, 14);
  }

  const result = await fal.queue.submit(FAL_IMAGE_MODEL, {
    input,
    webhookUrl: params.webhookUrl,
  });

  return {
    requestId: result.request_id,
    model: FAL_IMAGE_MODEL,
    provider: 'fal',
  };
}
