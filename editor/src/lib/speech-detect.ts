import { transcribe } from '@/lib/transcribe';

/**
 * Detect whether a video/audio URL contains speech.
 * Uses Deepgram transcription — if any words come back, there's speech.
 * Returns true if speech detected, false otherwise.
 */
export async function detectSpeech(mediaUrl: string): Promise<boolean> {
  try {
    const result = await transcribe({
      url: mediaUrl,
      smartFormat: false,
      paragraphs: false,
      words: true,
    });

    if (!result) return false;

    // Check if any words were detected
    const channels = (result as any)?.results?.channels ?? [];
    for (const channel of channels) {
      for (const alt of channel.alternatives ?? []) {
        const transcript = (alt.transcript ?? '').trim();
        if (transcript.length > 0) {
          console.log(
            `[speech-detect] Speech detected: "${transcript.slice(0, 100)}"`
          );
          return true;
        }
      }
    }

    // Also check the combo format output
    const text = (result as any)?.text?.trim() ?? '';
    if (text.length > 0) {
      console.log(
        `[speech-detect] Speech detected (combo): "${text.slice(0, 100)}"`
      );
      return true;
    }

    return false;
  } catch (error) {
    console.error('[speech-detect] Error:', error);
    // On error, assume no speech (don't block the pipeline)
    return false;
  }
}
