import { createTask } from '@/lib/kieai';

export const KIE_IMAGE_MODEL = 'flux-2/pro-text-to-image';

const KIE_ASPECT_RATIOS = new Set([
  '1:1',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
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
  fallback = '9:16'
): string {
  const normalized = (value ?? '').trim();
  if (normalized && KIE_ASPECT_RATIOS.has(normalized)) {
    return normalized;
  }

  return KIE_ASPECT_RATIOS.has(fallback) ? fallback : '9:16';
}

export async function queueKieImageTask(params: {
  prompt: string;
  callbackUrl: string;
  aspectRatio?: string;
  resolution?: string;
}) {
  const input: Record<string, unknown> = {
    prompt: params.prompt,
    aspect_ratio: normalizeKieAspectRatio(params.aspectRatio, '9:16'),
    resolution: normalizeKieResolution(params.resolution),
    nsfw_checker: false,
  };

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
