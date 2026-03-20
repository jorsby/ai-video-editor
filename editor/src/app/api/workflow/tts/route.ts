import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

const FAL_API_KEY = process.env.FAL_KEY!;
const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL!;

const TTS_ENDPOINTS: Record<string, string> = {
  'turbo-v2.5': 'fal-ai/elevenlabs/tts/turbo-v2.5',
  'multilingual-v2': 'fal-ai/elevenlabs/tts/multilingual-v2',
};

const DEFAULT_TTS_MODEL = 'turbo-v2.5';

interface GenerateTTSInput {
  scene_ids: string[];
  voice?: string;
  model?: 'turbo-v2.5' | 'multilingual-v2';
  language?: string;
  speed?: number;
}

interface SceneContext {
  voiceover_id: string;
  scene_id: string;
  storyboard_id: string;
  text: string;
  previous_text: string | null;
  next_text: string | null;
}

async function logVoiceoverGenerationAttempt(params: {
  db: ReturnType<typeof createServiceClient>;
  voiceoverId: string;
  storyboardId: string;
  prompt: string | null;
  generationMeta?: Record<string, unknown>;
  feedback?: string | null;
  resultUrl?: string | null;
  status: 'pending' | 'failed' | 'skipped';
  log: ReturnType<typeof createLogger>;
}) {
  const {
    db,
    voiceoverId,
    storyboardId,
    prompt,
    generationMeta,
    feedback,
    resultUrl,
    status,
    log,
  } = params;

  try {
    const { data: latest } = await db
      .from('generation_logs')
      .select('version')
      .eq('entity_type', 'voiceover')
      .eq('entity_id', voiceoverId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    await db.from('generation_logs').insert({
      entity_type: 'voiceover',
      entity_id: voiceoverId,
      storyboard_id: storyboardId,
      version: (latest?.version ?? 0) + 1,
      prompt,
      generation_meta: generationMeta ?? null,
      feedback: feedback ?? null,
      result_url: resultUrl ?? null,
      status,
    });
  } catch (error) {
    log.warn('Failed to write generation log row (non-fatal)', {
      voiceover_id: voiceoverId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function getSceneContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sceneId: string,
  language: string,
  log: ReturnType<typeof createLogger>
): Promise<SceneContext | null> {
  const { data: scene, error: sceneError } = await supabase
    .from('scenes')
    .select(`id, order, storyboard_id, voiceovers (id, text, language)`)
    .eq('id', sceneId)
    .single();

  if (sceneError || !scene) {
    log.error('Failed to fetch scene', {
      scene_id: sceneId,
      error: sceneError?.message,
    });
    return null;
  }

  const voiceover = (
    scene.voiceovers as Array<{ id: string; text: string; language: string }>
  )?.find((v) => v.language === language);
  if (!voiceover) {
    log.error('No voiceover found for scene/language', {
      scene_id: sceneId,
      language,
    });
    return null;
  }

  const { data: allScenes, error: allScenesError } = await supabase
    .from('scenes')
    .select(`id, order, voiceovers (text, language)`)
    .eq('storyboard_id', scene.storyboard_id)
    .order('order', { ascending: true });

  if (allScenesError || !allScenes) {
    log.warn('Failed to fetch sibling scenes for context', {
      error: allScenesError?.message,
    });
    return {
      voiceover_id: voiceover.id,
      scene_id: sceneId,
      storyboard_id: scene.storyboard_id,
      text: voiceover.text || '',
      previous_text: null,
      next_text: null,
    };
  }

  const currentIndex = allScenes.findIndex(
    (s: { id: string }) => s.id === sceneId
  );
  const previousScene = currentIndex > 0 ? allScenes[currentIndex - 1] : null;
  const nextScene =
    currentIndex < allScenes.length - 1 ? allScenes[currentIndex + 1] : null;

  const previous_text =
    (
      previousScene?.voiceovers as
        | Array<{ text: string; language: string }>
        | undefined
    )?.find((v) => v.language === language)?.text || null;
  const next_text =
    (
      nextScene?.voiceovers as
        | Array<{ text: string; language: string }>
        | undefined
    )?.find((v) => v.language === language)?.text || null;

  return {
    voiceover_id: voiceover.id,
    scene_id: sceneId,
    storyboard_id: scene.storyboard_id,
    text: voiceover.text || '',
    previous_text,
    next_text,
  };
}

async function sendTTSRequest(
  context: SceneContext,
  voice: string,
  endpoint: string,
  speed: number,
  log: ReturnType<typeof createLogger>
): Promise<{ requestId: string | null; error: string | null }> {
  const webhookParams = new URLSearchParams({
    step: 'GenerateTTS',
    voiceover_id: context.voiceover_id,
  });
  const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/fal?${webhookParams.toString()}`;

  const falUrl = new URL(`https://queue.fal.run/${endpoint}`);
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  log.api('fal.ai', endpoint, {
    text_length: context.text.length,
    has_previous: !!context.previous_text,
    has_next: !!context.next_text,
  });
  log.startTiming('fal_tts_request');

  try {
    const falResponse = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: context.text,
        voice,
        stability: 0.5,
        similarity_boost: 0.75,
        speed,
        previous_text: context.previous_text,
        next_text: context.next_text,
      }),
    });

    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      log.error('fal.ai TTS request failed', {
        status: falResponse.status,
        error: errorText,
        time_ms: log.endTiming('fal_tts_request'),
      });
      return {
        requestId: null,
        error: `fal.ai request failed: ${falResponse.status}`,
      };
    }

    const falResult = await falResponse.json();
    log.success('fal.ai TTS request accepted', {
      request_id: falResult.request_id,
      time_ms: log.endTiming('fal_tts_request'),
    });
    return { requestId: falResult.request_id, error: null };
  } catch (err) {
    log.error('fal.ai TTS request exception', {
      error: err instanceof Error ? err.message : String(err),
      time_ms: log.endTiming('fal_tts_request'),
    });
    return { requestId: null, error: 'Request exception' };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  const log = createLogger();
  log.setContext({ step: 'GenerateTTS' });

  try {
    const authClient = await createClient();
    const {
      data: { user: sessionUser },
    } = await authClient.auth.getUser();

    // Support API key auth for agent access
    let user = sessionUser;
    if (!user) {
      const { validateApiKey } = await import('@/lib/auth/api-key');
      const apiKeyResult = validateApiKey(req);
      if (apiKeyResult.valid && apiKeyResult.userId) {
        user = { id: apiKeyResult.userId } as typeof sessionUser;
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    log.info('Request received');

    const input: GenerateTTSInput = await req.json();
    const {
      scene_ids,
      voice = 'pNInz6obpgDQGcFmaJgB',
      model = DEFAULT_TTS_MODEL,
      language = 'en',
      speed: rawSpeed = 1.0,
    } = input;
    const speed = Math.min(1.2, Math.max(0.7, rawSpeed));

    if (!scene_ids || !Array.isArray(scene_ids) || scene_ids.length === 0) {
      log.error('Invalid input', { scene_ids });
      return NextResponse.json(
        { success: false, error: 'scene_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    const endpoint = TTS_ENDPOINTS[model];
    if (!endpoint) {
      log.error('Invalid TTS model', { model });
      return NextResponse.json(
        {
          success: false,
          error: `model must be one of: ${Object.keys(TTS_ENDPOINTS).join(', ')}`,
        },
        { status: 400 }
      );
    }

    log.info('Processing TTS requests', {
      scene_count: scene_ids.length,
      model,
    });

    const supabase = createServiceClient();

    const results: Array<{
      scene_id: string;
      voiceover_id: string | null;
      request_id: string | null;
      status: 'queued' | 'failed';
      error?: string;
    }> = [];

    for (let i = 0; i < scene_ids.length; i++) {
      const sceneId = scene_ids[i];

      if (i > 0) {
        log.info('Waiting before next request', { delay_ms: 1000, index: i });
        await delay(1000);
      }

      log.startTiming(`get_context_${i}`);
      const context = await getSceneContext(supabase, sceneId, language, log);
      log.info('Scene context fetched', {
        scene_id: sceneId,
        has_context: !!context,
        time_ms: log.endTiming(`get_context_${i}`),
      });

      if (!context) {
        results.push({
          scene_id: sceneId,
          voiceover_id: null,
          request_id: null,
          status: 'failed',
          error: 'Scene or voiceover not found',
        });
        continue;
      }

      if (!context.text || context.text.trim() === '') {
        log.warn('Empty voiceover text, skipping', { scene_id: sceneId });
        await supabase
          .from('voiceovers')
          .update({ status: 'failed', error_message: 'request_error' })
          .eq('id', context.voiceover_id);

        await logVoiceoverGenerationAttempt({
          db: supabase,
          voiceoverId: context.voiceover_id,
          storyboardId: context.storyboard_id,
          prompt: null,
          status: 'skipped',
          feedback: 'Skipped: voiceover text empty',
          log,
        });

        results.push({
          scene_id: sceneId,
          voiceover_id: context.voiceover_id,
          request_id: null,
          status: 'failed',
          error: 'Empty voiceover text',
        });
        continue;
      }

      await supabase
        .from('voiceovers')
        .update({ status: 'processing' })
        .eq('id', context.voiceover_id);

      const { requestId, error } = await sendTTSRequest(
        context,
        voice,
        endpoint,
        speed,
        log
      );

      if (error || !requestId) {
        await supabase
          .from('voiceovers')
          .update({ status: 'failed', error_message: 'request_error' })
          .eq('id', context.voiceover_id);

        await logVoiceoverGenerationAttempt({
          db: supabase,
          voiceoverId: context.voiceover_id,
          storyboardId: context.storyboard_id,
          prompt: context.text,
          status: 'failed',
          feedback: error || 'Unknown error',
          log,
        });

        results.push({
          scene_id: sceneId,
          voiceover_id: context.voiceover_id,
          request_id: null,
          status: 'failed',
          error: error || 'Unknown error',
        });
        continue;
      }

      await supabase
        .from('voiceovers')
        .update({ request_id: requestId })
        .eq('id', context.voiceover_id);

      await logVoiceoverGenerationAttempt({
        db: supabase,
        voiceoverId: context.voiceover_id,
        storyboardId: context.storyboard_id,
        prompt: context.text,
        generationMeta: {
          model: endpoint,
          voice_id: voice,
          speed,
          language,
          generated_at: new Date().toISOString(),
          generated_by: 'system',
        },
        status: 'pending',
        log,
      });

      results.push({
        scene_id: sceneId,
        voiceover_id: context.voiceover_id,
        request_id: requestId,
        status: 'queued',
      });
      log.success('TTS request queued', {
        scene_id: sceneId,
        voiceover_id: context.voiceover_id,
        request_id: requestId,
      });
    }

    const queuedCount = results.filter((r) => r.status === 'queued').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

    log.summary('success', {
      total: scene_ids.length,
      queued: queuedCount,
      failed: failedCount,
    });

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: scene_ids.length,
        queued: queuedCount,
        failed: failedCount,
      },
    });
  } catch (error) {
    log.error('Unexpected error', {
      error: error instanceof Error ? error.message : String(error),
    });
    log.summary('error', { reason: 'unexpected_exception' });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
