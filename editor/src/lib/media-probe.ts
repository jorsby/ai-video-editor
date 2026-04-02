import { parseBuffer } from 'music-metadata';

/**
 * Probe a remote media file (MP3/MP4/WAV/OGG) and return its exact duration
 * in seconds.
 *
 * Uses `music-metadata` (pure JS, no native deps — works on Vercel serverless).
 * Returns `null` on any failure — callers should treat duration as optional
 * and not block the webhook flow.
 */
export async function probeMediaDuration(url: string): Promise<number | null> {
  try {
    const response = await fetch(url);

    if (!response.ok || !response.body) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const mimeType = guessMimeType(url, contentType);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    const metadata = await parseBuffer(buffer, { mimeType });

    const duration = metadata.format.duration;
    if (
      typeof duration === 'number' &&
      duration > 0 &&
      Number.isFinite(duration)
    ) {
      // Round to 2 decimal places
      return Math.round(duration * 100) / 100;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Guess MIME type from URL extension + Content-Type header.
 * music-metadata needs a hint for correct parser selection.
 */
function guessMimeType(url: string, contentType: string): string {
  // Prefer explicit content-type if it's specific enough
  if (contentType && !contentType.includes('octet-stream')) {
    return contentType.split(';')[0].trim();
  }

  // Fall back to URL extension
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  if (path.endsWith('.mp4')) return 'video/mp4';
  if (path.endsWith('.wav')) return 'audio/wav';
  if (path.endsWith('.ogg')) return 'audio/ogg';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.m4a')) return 'audio/mp4';
  if (path.endsWith('.aac')) return 'audio/aac';
  if (path.endsWith('.flac')) return 'audio/flac';

  return contentType || 'audio/mpeg';
}
