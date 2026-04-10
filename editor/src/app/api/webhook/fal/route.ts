import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { probeMediaDuration } from '@/lib/media-probe';
import { transcribeSceneVideo } from '@/lib/transcribe/transcribe-url';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function ok(body: Record<string, unknown>) {
  return NextResponse.json(body, { status: 200, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const VALID_STEPS = new Set(['GenerateSceneVideo', 'GenerateSceneTTS']);

/**
 * POST /api/webhook/fal?step=GenerateSceneVideo|GenerateSceneTTS&scene_id=xxx
 *
 * fal.ai sends the completed result here.
 */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const step = url.searchParams.get('step');
    const sceneId = url.searchParams.get('scene_id');

    if (!step || !VALID_STEPS.has(step) || !sceneId) {
      return ok({ success: false, error: 'Missing step or scene_id' });
    }

    const body = await req.json().catch(() => ({}));

    console.log(
      `[webhook/fal] ${step} received:`,
      JSON.stringify(body).slice(0, 500)
    );

    const supabase = createServiceClient('studio');

    const status = body.status as string | undefined;

    // ── Failed ─────────────────────────────────────────────────
    if (status === 'FAILED' || status === 'ERROR') {
      console.error(`[webhook/fal] ${step} job failed:`, body.error ?? body);

      if (step === 'GenerateSceneVideo') {
        await supabase
          .from('scenes')
          .update({ video_status: 'failed', video_task_id: null })
          .eq('id', sceneId);
      } else {
        await supabase
          .from('scenes')
          .update({ tts_status: 'failed', tts_task_id: null })
          .eq('id', sceneId);
      }

      return ok({ success: true, failed: true, step, scene_id: sceneId });
    }

    // ── In progress ────────────────────────────────────────────
    if (
      status === 'IN_PROGRESS' ||
      status === 'IN_QUEUE' ||
      status === 'PENDING'
    ) {
      return ok({ success: true, pending: true });
    }

    // ── Completed ──────────────────────────────────────────────
    const payload = body.payload ?? body;

    if (step === 'GenerateSceneVideo') {
      return handleVideoCompleted(supabase, sceneId, payload, body);
    }

    return handleTtsCompleted(supabase, sceneId, payload);
  } catch (error) {
    console.error('[webhook/fal] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// ── Video completion handler ────────────────────────────────────────────────

async function handleVideoCompleted(
  supabase: ReturnType<typeof createServiceClient>,
  sceneId: string,
  payload: Record<string, unknown>,
  body: Record<string, unknown>
) {
  const videoUrl =
    extractNestedUrl(payload, ['video', 'url']) ??
    extractNestedUrl(payload, ['output', 'video', 'url']);

  if (!videoUrl) {
    console.error(
      '[webhook/fal] No video URL in payload:',
      JSON.stringify(body).slice(0, 500)
    );
    await supabase
      .from('scenes')
      .update({ video_status: 'failed', video_task_id: null })
      .eq('id', sceneId);

    return ok({ success: true, failed: true, error: 'no_video_url' });
  }

  const videoDuration = await probeMediaDuration(videoUrl as string);

  await supabase
    .from('scenes')
    .update({
      video_url: videoUrl,
      ...(videoDuration != null ? { video_duration: videoDuration } : {}),
      video_status: 'done',
      video_task_id: null,
    })
    .eq('id', sceneId);

  // Fire-and-forget: transcribe the video
  void transcribeSceneVideo(supabase, sceneId, videoUrl as string).catch(
    (err) =>
      console.error('[webhook/fal] Transcription failed (non-fatal):', err)
  );

  return ok({
    success: true,
    scene_id: sceneId,
    video_url: videoUrl,
    video_duration: videoDuration,
    provider: 'fal',
  });
}

// ── TTS completion handler ──────────────────────────────────────────────────

async function handleTtsCompleted(
  supabase: ReturnType<typeof createServiceClient>,
  sceneId: string,
  payload: Record<string, unknown>
) {
  // fal ElevenLabs TTS returns { audio: { url }, timestamps: [...] }
  const audioUrl =
    (payload?.audio as { url?: string })?.url ??
    (payload as { audio_url?: string })?.audio_url ??
    null;

  if (!audioUrl) {
    console.error(
      '[webhook/fal] No audio URL in TTS payload:',
      JSON.stringify(payload).slice(0, 500)
    );
    await supabase
      .from('scenes')
      .update({ tts_status: 'failed', tts_task_id: null })
      .eq('id', sceneId);

    return ok({ success: true, failed: true, error: 'no_audio_url' });
  }

  const audioDuration = await probeMediaDuration(audioUrl);

  // Build voiceover transcription from fal's ElevenLabs timestamps
  const voiceoverTranscription = buildVoiceoverTranscription(
    payload,
    audioDuration
  );

  await supabase
    .from('scenes')
    .update({
      audio_url: audioUrl,
      ...(audioDuration != null ? { audio_duration: audioDuration } : {}),
      tts_status: 'done',
      tts_task_id: null,
      ...(voiceoverTranscription != null
        ? { voiceover_transcription: voiceoverTranscription }
        : {}),
    })
    .eq('id', sceneId);

  return ok({
    success: true,
    step: 'GenerateSceneTTS',
    scene_id: sceneId,
    audio_url: audioUrl,
    audio_duration: audioDuration,
    has_voiceover_transcription: voiceoverTranscription != null,
    provider: 'fal',
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractNestedUrl(
  obj: Record<string, unknown>,
  path: string[]
): string | null {
  let current: unknown = obj;
  for (const key of path) {
    if (current == null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.length > 0 ? current : null;
}

type WordEntry = {
  word: string;
  start: number;
  end: number;
  confidence: number;
};

function charsToWords(
  chars: string[],
  starts: number[],
  ends: number[]
): WordEntry[] {
  const words: WordEntry[] = [];
  let buf = '';
  let wStart = -1;
  let wEnd = -1;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const isWhitespace = ch === ' ' || ch === '\n' || ch === '\t';

    if (isWhitespace) {
      if (buf.length > 0) {
        words.push({ word: buf, start: wStart, end: wEnd, confidence: 1.0 });
        buf = '';
      }
      continue;
    }

    if (buf.length === 0) wStart = starts[i];
    buf += ch;
    wEnd = ends[i];
  }

  if (buf.length > 0) {
    words.push({ word: buf, start: wStart, end: wEnd, confidence: 1.0 });
  }

  return words;
}

// ── Voiceover transcription from ElevenLabs character-level timestamps ──────

function buildVoiceoverTranscription(
  payload: Record<string, unknown>,
  audioDuration: number | null
) {
  const timestampsArr = payload.timestamps;
  if (!Array.isArray(timestampsArr) || timestampsArr.length === 0) return null;

  const ts = timestampsArr[0] as {
    characters?: string[];
    character_start_times_seconds?: number[];
    character_end_times_seconds?: number[];
  };

  const chars = ts.characters;
  const starts = ts.character_start_times_seconds;
  const ends = ts.character_end_times_seconds;
  if (!chars || !starts || !ends || chars.length === 0) return null;

  const words = charsToWords(chars, starts, ends);
  if (words.length === 0) return null;

  return {
    text: words.map((w) => w.word).join(' '),
    words,
    language: null,
    duration: audioDuration ?? (ends.length > 0 ? ends[ends.length - 1] : null),
  };
}
