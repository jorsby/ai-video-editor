import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createTask } from '@/lib/kieai';
import { submitFalTtsJob } from '@/lib/fal-provider';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';
import { getProjectTtsSettings } from '@/lib/api/variant-table-resolver';

type RouteContext = { params: Promise<{ id: string }> };

const TTS_MODEL = 'elevenlabs/text-to-speech-turbo-2-5';
// kie.ai's ElevenLabs model accepts only curated voice NAMES (e.g. "Adam",
// "Rachel"), not raw 20-char ElevenLabs IDs. fal.ai accepts raw IDs — so we
// auto-route raw IDs to fal below.
const DEFAULT_VOICE_ID = 'Adam';
const RAW_ELEVENLABS_ID_RE = /^[A-Za-z0-9]{20}$/;

function isRawElevenLabsId(voice: string): boolean {
  return RAW_ELEVENLABS_ID_RE.test(voice);
}

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
      .select('id, project_id, user_id')
      .eq('id', chapter.video_id)
      .maybeSingle();

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // ── Auth: user must own the video ──────────────────────────────────

    if (video.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── TTS defaults now live in projects.generation_settings jsonb ────
    const ttsDefaults = await getProjectTtsSettings(supabase, video.project_id);

    // ── Parse body ──────────────────────────────────────────────────────

    const body = await req.json().catch(() => ({}));

    const resolvedVoiceId = resolveVoiceId(body.voice_id, ttsDefaults.voiceId);

    // kie.ai rejects raw ElevenLabs voice IDs ("Unsupported voiceId: ..."),
    // but fal.ai accepts them. Auto-route raw IDs to fal so custom voices
    // (e.g. cloned / non-preset) work without manual provider selection.
    const explicitProvider =
      typeof body.provider === 'string'
        ? body.provider.toLowerCase()
        : undefined;
    const provider: 'fal' | 'kie' =
      explicitProvider === 'fal'
        ? 'fal'
        : explicitProvider === 'kie'
          ? 'kie'
          : isRawElevenLabsId(resolvedVoiceId)
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
      voiceId: resolvedVoiceId,
      speed: clampSpeed(body.speed ?? ttsDefaults.ttsSpeed),
      previousText: body.previous_text ?? '',
      nextText: body.next_text ?? '',
      languageCode: body.language_code ?? ttsDefaults.language ?? '',
    };

    console.log('[v2/scenes/:id/generate-tts] submitting', {
      sceneId,
      provider,
      voiceId: ttsParams.voiceId,
      speed: ttsParams.speed,
      textLength: ttsParams.text.length,
    });

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
