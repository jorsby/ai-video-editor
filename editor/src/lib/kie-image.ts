import { createTask } from '@/lib/kieai';

export const KIE_IMAGE_MODEL = 'nano-banana-2';

const KIE_ASPECT_RATIOS = new Set([
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

export function normalizeKieResolution(
  value: string | null | undefined
): '1K' | '2K' | '4K' {
  const normalized = (value ?? '').trim().toUpperCase();

  if (normalized === '4K') return '4K';
  if (normalized === '2K') return '2K';

  // kie.ai does not support 0.5K; promote to 1K.
  return '1K';
}

export function normalizeKieAspectRatio(
  value: string | null | undefined,
  fallback: 'auto' | string = 'auto'
): string {
  const normalized = (value ?? '').trim();
  if (normalized && KIE_ASPECT_RATIOS.has(normalized)) {
    return normalized;
  }

  return KIE_ASPECT_RATIOS.has(fallback) ? fallback : 'auto';
}

export function normalizeKieOutputFormat(
  value: string | null | undefined
): 'jpg' | 'png' {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'png') return 'png';
  return 'jpg';
}

export async function queueKieImageTask(params: {
  prompt: string;
  callbackUrl: string;
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: string;
  imageInput?: string[];
}) {
  const input: Record<string, unknown> = {
    prompt: params.prompt,
    aspect_ratio: normalizeKieAspectRatio(params.aspectRatio, 'auto'),
    resolution: normalizeKieResolution(params.resolution),
    output_format: normalizeKieOutputFormat(params.outputFormat),
  };

  if (Array.isArray(params.imageInput) && params.imageInput.length > 0) {
    input.image_input = params.imageInput.slice(0, 14);
  }

  const result = await createTask({
    model: KIE_IMAGE_MODEL,
    callbackUrl: params.callbackUrl,
    input,
  });

  return {
    requestId: result.taskId,
    model: KIE_IMAGE_MODEL,
    endpoint: 'https://api.kie.ai/api/v1/jobs/createTask',
  };
}
