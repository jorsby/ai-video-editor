import { transcribe } from '@/lib/transcribe';
import type { TranscriptObject } from '@/lib/transcribe/types';
import type { createServiceClient } from '@/lib/supabase/admin';

export interface TranscriptionSummary {
  text: string;
  words: { word: string; start: number; end: number; confidence: number }[];
  language: string | null;
  duration: number | null;
}

export function buildSummary(
  result: Partial<TranscriptObject>
): TranscriptionSummary {
  const main = result.results?.main;
  return {
    text: main?.text ?? '',
    words: (main?.words ?? []).map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
    })),
    language: main?.language?.language ?? null,
    duration: result.duration ?? null,
  };
}

export async function transcribeUrl(
  db: ReturnType<typeof createServiceClient>,
  url: string,
  projectId: string
): Promise<TranscriptionSummary> {
  // Check cache first
  const { data: cached } = await db
    .from('transcriptions')
    .select('data')
    .eq('project_id', projectId)
    .eq('source_url', url)
    .eq('model', 'nova-3')
    .maybeSingle();

  if (cached?.data) {
    return buildSummary(cached.data as Partial<TranscriptObject>);
  }

  // Transcribe via Deepgram
  const result = await transcribe({
    url,
    model: 'nova-3',
    words: true,
    smartFormat: true,
    paragraphs: true,
  });

  if (!result) {
    return { text: '', words: [], language: null, duration: null };
  }

  // Cache full result
  await db
    .from('transcriptions')
    .upsert(
      {
        project_id: projectId,
        source_url: url,
        model: 'nova-3',
        language: result.results?.main?.language?.language ?? null,
        duration: result.duration ?? null,
        data: result,
      },
      { onConflict: 'project_id,source_url,model' }
    )
    .select('id')
    .maybeSingle();

  return buildSummary(result);
}

/**
 * Auto-transcribe a scene's video and update the scene record.
 * Designed to be called fire-and-forget from webhooks.
 */
export async function transcribeSceneVideo(
  db: ReturnType<typeof createServiceClient>,
  sceneId: string,
  videoUrl: string
): Promise<void> {
  // Resolve projectId: scene → chapter → video
  const { data: scene } = await db
    .from('scenes')
    .select('chapter_id')
    .eq('id', sceneId)
    .maybeSingle();
  if (!scene) return;

  const { data: chapter } = await db
    .from('chapters')
    .select('video_id')
    .eq('id', scene.chapter_id)
    .maybeSingle();
  if (!chapter) return;

  const { data: video } = await db
    .from('videos')
    .select('project_id')
    .eq('id', chapter.video_id)
    .maybeSingle();
  if (!video?.project_id) return;

  try {
    const result = await transcribeUrl(db, videoUrl, video.project_id);

    await db
      .from('scenes')
      .update({
        video_transcription: result,
        video_transcription_status: 'done',
        has_speech: result.words.length > 0,
      })
      .eq('id', sceneId);
  } catch (err) {
    await db
      .from('scenes')
      .update({ video_transcription_status: 'failed' })
      .eq('id', sceneId);
    throw err;
  }
}
