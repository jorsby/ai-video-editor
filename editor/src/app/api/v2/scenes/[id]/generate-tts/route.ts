import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createTask } from '@/lib/kieai';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const TTS_MODEL = 'elevenlabs/text-to-speech-turbo-2-5';

/**
 * POST /api/v2/scenes/{id}/generate-tts
 *
 * Generates TTS audio for a scene's audio_text using ElevenLabs via kie.ai.
 *
 * Body (optional overrides):
 *   voice_id?: string   — ElevenLabs voice ID or name (default from series.voice_id or 'Rachel')
 *   speed?: number       — Speech speed 0.7-1.2 (default from series.tts_speed or 1.0)
 *   previous_text?: string — Previous scene audio_text for continuity
 *   next_text?: string     — Next scene audio_text for continuity
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: sceneId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    // ── Fetch scene + episode + series ──────────────────────────────────

    const { data: scene, error: sceneError } = await supabase
      .from('scenes')
      .select('id, episode_id, audio_text, audio_url')
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

    const { data: episode } = await supabase
      .from('episodes')
      .select('id, series_id')
      .eq('id', scene.episode_id)
      .maybeSingle();

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const { data: series } = await supabase
      .from('series')
      .select('id, voice_id, tts_speed, language, user_id')
      .eq('id', episode.series_id)
      .maybeSingle();

    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    // ── Auth: user must own the series ──────────────────────────────────

    if (series.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Parse body ──────────────────────────────────────────────────────

    const body = await req.json().catch(() => ({}));

    if (!series.voice_id) {
      return NextResponse.json(
        {
          error:
            'Series has no voice_id configured. Set it in series settings first.',
        },
        { status: 400 }
      );
    }

    const voiceId = body.voice_id ?? series.voice_id;
    const speed = clampSpeed(body.speed ?? series.tts_speed);
    const previousText = body.previous_text ?? '';
    const nextText = body.next_text ?? '';
    const languageCode = body.language_code ?? series.language ?? '';

    // ── Build webhook URL ───────────────────────────────────────────────

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
    webhookUrl.searchParams.set('step', 'GenerateSceneTTS');
    webhookUrl.searchParams.set('scene_id', sceneId);

    // ── Submit to kie.ai ────────────────────────────────────────────────

    const result = await createTask({
      model: TTS_MODEL,
      callbackUrl: webhookUrl.toString(),
      input: {
        text: scene.audio_text.trim(),
        voice_id: voiceId,
        speed,
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        timestamps: false,
        previous_text: previousText,
        next_text: nextText,
        language_code: languageCode,
      },
    });

    // ── Mark TTS as generating ─────────────────────────────────────────

    await supabase
      .from('scenes')
      .update({ tts_status: 'generating', tts_task_id: result.taskId })
      .eq('id', sceneId);

    return NextResponse.json({
      task_id: result.taskId,
      model: TTS_MODEL,
      scene_id: sceneId,
      voice_id: voiceId,
      speed,
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
