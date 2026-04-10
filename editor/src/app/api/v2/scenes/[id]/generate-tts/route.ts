import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createTask } from '@/lib/kieai';
import { submitFalTtsJob } from '@/lib/fal-provider';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const TTS_MODEL = 'elevenlabs/text-to-speech-turbo-2-5';
const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam

interface TtsParams {
  text: string;
  voiceId: string;
  speed: number;
  previousText: string;
  nextText: string;
  languageCode: string;
}

function resolveVoiceId(bodyVoice: unknown, videoVoice: unknown): string {
  if (typeof bodyVoice === 'string' && bodyVoice.trim().length > 0)
    return bodyVoice.trim();
  if (typeof videoVoice === 'string' && videoVoice.trim().length > 0)
    return videoVoice.trim();
  return DEFAULT_VOICE_ID;
}

async function submitToFal(
  params: TtsParams,
  sceneId: string,
  webhookBase: string
): Promise<string> {
  const url = new URL(`${webhookBase}/api/webhook/fal`);
  url.searchParams.set('step', 'GenerateSceneTTS');
  url.searchParams.set('scene_id', sceneId);

  const result = await submitFalTtsJob({
    text: params.text,
    voice: params.voiceId,
    speed: params.speed,
    stability: 0.5,
    similarityBoost: 0.75,
    timestamps: true,
    previousText: params.previousText,
    nextText: params.nextText,
    languageCode: params.languageCode,
    webhookUrl: url.toString(),
  });
  return result.requestId;
}

async function submitToKie(
  params: TtsParams,
  sceneId: string,
  webhookBase: string
): Promise<string> {
  const url = new URL(`${webhookBase}/api/webhook/kieai`);
  url.searchParams.set('step', 'GenerateSceneTTS');
  url.searchParams.set('scene_id', sceneId);

  const result = await createTask({
    model: TTS_MODEL,
    callbackUrl: url.toString(),
    input: {
      text: params.text,
      voice: params.voiceId,
      speed: params.speed,
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      timestamps: true,
      previous_text: params.previousText,
      next_text: params.nextText,
      language_code: params.languageCode,
    },
  });
  return result.taskId;
}

/**
 * POST /api/v2/scenes/{id}/generate-tts
 *
 * Generates TTS audio for a scene's audio_text using ElevenLabs via kie.ai or fal.ai.
 *
 * Body (optional overrides):
 *   provider?: 'kie' | 'fal' — Provider to use (default 'kie')
 *   voice_id?: string   — ElevenLabs voice ID or name
 *   speed?: number       — Speech speed 0.7-1.2
 *   previous_text?: string — Previous scene audio_text for continuity
 *   next_text?: string     — Next scene audio_text for continuity
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential validation chain
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: sceneId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    // ── Fetch scene + chapter + video ──────────────────────────────────

    const { data: scene, error: sceneError } = await supabase
      .from('scenes')
      .select('id, chapter_id, audio_text, audio_url')
      .eq('id', sceneId)
      .maybeSingle();

    if (sceneError || !scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    if (!scene.audio_text?.trim()) {
      return NextResponse.json(
        { error: 'Scene has no audio_text. Write narration first.' },
        { status: 400 }
      );
    }

    const { data: chapter } = await supabase
      .from('chapters')
      .select('id, video_id')
      .eq('id', scene.chapter_id)
      .maybeSingle();

    if (!chapter) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }

    const { data: video } = await supabase
      .from('videos')
      .select('id, voice_id, tts_speed, language, user_id')
      .eq('id', chapter.video_id)
      .maybeSingle();

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // ── Auth: user must own the video ──────────────────────────────────

    if (video.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Parse body ──────────────────────────────────────────────────────

    const body = await req.json().catch(() => ({}));

    const provider =
      typeof body.provider === 'string' && body.provider.toLowerCase() === 'fal'
        ? 'fal'
        : 'kie';

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    const ttsParams: TtsParams = {
      text: scene.audio_text.trim(),
      voiceId: resolveVoiceId(body.voice_id, video.voice_id),
      speed: clampSpeed(body.speed ?? video.tts_speed),
      previousText: body.previous_text ?? '',
      nextText: body.next_text ?? '',
      languageCode: body.language_code ?? video.language ?? '',
    };

    // ── Submit to provider ──────────────────────────────────────────────

    const taskId =
      provider === 'fal'
        ? await submitToFal(ttsParams, sceneId, webhookBase)
        : await submitToKie(ttsParams, sceneId, webhookBase);

    // ── Mark TTS as generating ─────────────────────────────────────────

    await supabase
      .from('scenes')
      .update({
        tts_status: 'generating',
        tts_task_id: taskId,
        audio_url: null,
        audio_duration: null,
        voiceover_transcription: null,
      })
      .eq('id', sceneId);

    return NextResponse.json({
      task_id: taskId,
      model:
        provider === 'fal' ? 'fal-ai/elevenlabs/tts/turbo-v2.5' : TTS_MODEL,
      provider,
      scene_id: sceneId,
      voice_id: ttsParams.voiceId,
      speed: ttsParams.speed,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    console.error('[v2/scenes/:id/generate-tts] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function clampSpeed(value: unknown): number {
  const n =
    typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (Number.isNaN(n)) return 1.0;
  return Math.max(0.7, Math.min(1.2, n));
}
