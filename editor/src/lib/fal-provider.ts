import { fal } from '@fal-ai/client';

fal.config({
  credentials: process.env.FAL_KEY ?? '',
});

const FAL_MAX_DURATION = 10;

export interface FalVideoInput {
  prompt: string;
  reference_image_urls: string[];
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
}

export interface FalQueueResult {
  request_id: string;
}

/**
 * Submit a video generation job to fal.ai queue with webhook callback.
 * Uses xai/grok-imagine-video/reference-to-video model.
 * Duration is clamped to max 10s.
 */
export async function submitFalVideoJob(params: {
  prompt: string;
  imageUrls: string[];
  duration: number;
  aspectRatio: string;
  resolution: string;
  webhookUrl: string;
}): Promise<{ requestId: string }> {
  const { prompt, imageUrls, duration, aspectRatio, resolution, webhookUrl } =
    params;

  // fal.ai Grok Imagine max duration = 10s
  const clampedDuration = Math.min(duration, FAL_MAX_DURATION);

  // Convert @imageN refs → @ImageN (fal.ai expects capital I)
  const falPrompt = prompt.replace(/@image(\d+)/gi, '@Image$1');

  const { request_id } = await fal.queue.submit(
    'xai/grok-imagine-video/reference-to-video',
    {
      input: {
        prompt: falPrompt,
        reference_image_urls: imageUrls,
        duration: clampedDuration,
        aspect_ratio: aspectRatio,
        resolution,
      },
      webhookUrl,
    }
  );

  return { requestId: request_id };
}

/**
 * Submit a TTS job to fal.ai queue with webhook callback.
 * Uses fal-ai/elevenlabs/tts/turbo-v2.5 model.
 */
export async function submitFalTtsJob(params: {
  text: string;
  voice: string;
  speed: number;
  stability: number;
  similarityBoost: number;
  timestamps: boolean;
  previousText: string;
  nextText: string;
  languageCode: string;
  webhookUrl: string;
}): Promise<{ requestId: string }> {
  const {
    text,
    voice,
    speed,
    stability,
    similarityBoost,
    timestamps,
    previousText,
    nextText,
    languageCode,
    webhookUrl,
  } = params;

  const input: Record<string, unknown> = {
    text,
    voice,
    speed,
    stability,
    similarity_boost: similarityBoost,
    timestamps,
  };

  if (previousText) input.previous_text = previousText;
  if (nextText) input.next_text = nextText;
  if (languageCode) input.language_code = languageCode;

  const { request_id } = await fal.queue.submit(
    'fal-ai/elevenlabs/tts/turbo-v2.5' as string,
    { input, webhookUrl }
  );

  return { requestId: request_id };
}

export { FAL_MAX_DURATION };
