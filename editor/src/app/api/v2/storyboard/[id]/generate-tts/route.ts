import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createTask } from '@/lib/kieai';
import {
  isProviderRoutingError,
  resolveProvider,
} from '@/lib/provider-routing';
import { createServiceClient } from '@/lib/supabase/admin';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam
const DEFAULT_TTS_MODEL = 'elevenlabs/text-to-speech-turbo-2-5';
const KIE_TTS_MODELS: Record<string, string> = {
  'turbo-v2.5': 'elevenlabs/text-to-speech-turbo-2-5',
  'multilingual-v2': 'elevenlabs/text-to-speech-multilingual-v2',
};

const bodySchema = z.object({
  voice_id: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  speed: z.number().optional(),
  tts_model: z.enum(['turbo-v2.5', 'multilingual-v2']).optional(),
});

type SceneRow = {
  id: string;
  order: number;
  voiceovers: Array<{
    id: string;
    text: string | null;
    language: string | null;
  }>;
};

type SceneQueueItem = {
  scene_id: string;
  voiceover_id: string | null;
  text: string | null;
  previous_text: string | null;
  next_text: string | null;
};

type TtsResult = {
  scene_id: string;
  voiceover_id: string | null;
  request_id: string | null;
  status: 'queued' | 'failed' | 'skipped';
  error?: string;
};

async function logVoiceoverGenerationAttempt(params: {
  db: ReturnType<typeof createServiceClient>;
  voiceoverId: string;
  storyboardId: string;
  prompt: string | null;
  generationMeta?: Record<string, unknown>;
  feedback?: string | null;
  resultUrl?: string | null;
  status: 'pending' | 'failed' | 'skipped';
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
  } = params;

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
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseInput(reqBody: unknown) {
  const parsedBody = bodySchema.safeParse(reqBody);
  if (!parsedBody.success) {
    return {
      error: NextResponse.json(
        {
          error: parsedBody.error.issues[0]?.message ?? 'Invalid request body',
        },
        { status: 400 }
      ),
    };
  }

  return {
    data: {
      voiceId: parsedBody.data.voice_id ?? DEFAULT_VOICE_ID,
      language: parsedBody.data.language ?? 'en',
      speed: Math.min(1.2, Math.max(0.7, parsedBody.data.speed ?? 1.0)),
      ttsModel: parsedBody.data.tts_model ?? 'turbo-v2.5',
    },
  };
}

function buildSceneQueueItems(
  scenes: SceneRow[],
  language: string
): SceneQueueItem[] {
  const items = scenes.map((scene) => {
    const matchingVoiceover = (scene.voiceovers ?? []).find(
      (voiceover) => voiceover.language === language
    );

    return {
      scene_id: scene.id,
      voiceover_id: matchingVoiceover?.id ?? null,
      text: normalizeText(matchingVoiceover?.text),
      previous_text: null,
      next_text: null,
    };
  });

  return items.map((item, index) => ({
    ...item,
    previous_text: index > 0 ? items[index - 1].text : null,
    next_text: index < items.length - 1 ? items[index + 1].text : null,
  }));
}

async function markVoiceoverFailed(
  db: ReturnType<typeof createServiceClient>,
  voiceoverId: string
) {
  await db
    .from('voiceovers')
    .update({ status: 'failed', error_message: 'request_error' })
    .eq('id', voiceoverId);
}

async function queueTtsRequest(params: {
  scene: SceneQueueItem;
  voiceId: string;
  speed: number;
  webhookBase: string;
  ttsModel: string;
}) {
  const callbackUrl = `${params.webhookBase}/api/webhook/kieai?step=GenerateTTS&voiceover_id=${params.scene.voiceover_id}`;

  try {
    const kieModel = KIE_TTS_MODELS[params.ttsModel] ?? DEFAULT_TTS_MODEL;

    const result = await createTask({
      model: kieModel,
      callbackUrl,
      input: {
        text: params.scene.text,
        voice: params.voiceId,
        speed: params.speed,
        previous_text: params.scene.previous_text,
        next_text: params.scene.next_text,
      },
    });

    return { requestId: result.taskId, error: null };
  } catch (error) {
    return {
      requestId: null,
      error:
        error instanceof Error
          ? `kie.ai request failed: ${error.message}`
          : 'kie.ai request failed',
    };
  }
}

async function processSceneTts(params: {
  db: ReturnType<typeof createServiceClient>;
  scene: SceneQueueItem;
  voiceId: string;
  speed: number;
  webhookBase: string;
  storyboardId: string;
  language: string;
  ttsModel: string;
}): Promise<TtsResult> {
  if (!params.scene.voiceover_id) {
    return {
      scene_id: params.scene.scene_id,
      voiceover_id: null,
      request_id: null,
      status: 'failed',
      error: 'No matching voiceover found for requested language',
    };
  }

  if (!params.scene.text) {
    await markVoiceoverFailed(params.db, params.scene.voiceover_id);

    await logVoiceoverGenerationAttempt({
      db: params.db,
      voiceoverId: params.scene.voiceover_id,
      storyboardId: params.storyboardId,
      prompt: null,
      status: 'skipped',
      feedback: 'Skipped: voiceover text empty',
    });

    return {
      scene_id: params.scene.scene_id,
      voiceover_id: params.scene.voiceover_id,
      request_id: null,
      status: 'skipped',
      error: 'Voiceover text is empty',
    };
  }

  await params.db
    .from('voiceovers')
    .update({ status: 'processing', error_message: null })
    .eq('id', params.scene.voiceover_id);

  const queued = await queueTtsRequest({
    scene: params.scene,
    voiceId: params.voiceId,
    speed: params.speed,
    webhookBase: params.webhookBase,
    ttsModel: params.ttsModel,
  });

  if (!queued.requestId) {
    await markVoiceoverFailed(params.db, params.scene.voiceover_id);

    await logVoiceoverGenerationAttempt({
      db: params.db,
      voiceoverId: params.scene.voiceover_id,
      storyboardId: params.storyboardId,
      prompt: params.scene.text,
      status: 'failed',
      feedback: queued.error ?? 'Unknown queue error',
    });

    return {
      scene_id: params.scene.scene_id,
      voiceover_id: params.scene.voiceover_id,
      request_id: null,
      status: 'failed',
      error: queued.error ?? 'Unknown queue error',
    };
  }

  const generationMeta = {
    provider: 'kie',
    model: KIE_TTS_MODELS[params.ttsModel] ?? DEFAULT_TTS_MODEL,
    tts_model: params.ttsModel,
    voice_id: params.voiceId,
    speed: params.speed,
    language: params.language,
    generated_at: new Date().toISOString(),
    generated_by: 'system',
  };

  await params.db
    .from('voiceovers')
    .update({
      request_id: queued.requestId,
      generation_meta: generationMeta,
    })
    .eq('id', params.scene.voiceover_id);

  await logVoiceoverGenerationAttempt({
    db: params.db,
    voiceoverId: params.scene.voiceover_id,
    storyboardId: params.storyboardId,
    prompt: params.scene.text,
    generationMeta,
    status: 'pending',
  });

  return {
    scene_id: params.scene.scene_id,
    voiceover_id: params.scene.voiceover_id,
    request_id: queued.requestId,
    status: 'queued',
  };
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: storyboardId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const input = parseInput(await req.json().catch(() => ({})));
    if ('error' in input) {
      return input.error;
    }

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    const providerResolution = await resolveProvider({
      service: 'tts',
      req,
      body: input.data,
    });

    const db = createServiceClient('studio');

    const { data: storyboard, error: storyboardError } = await db
      .from('storyboards')
      .select('id, project_id')
      .eq('id', storyboardId)
      .single();

    if (storyboardError || !storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    const { data: project, error: projectError } = await db
      .from('projects')
      .select('id')
      .eq('id', storyboard.project_id)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { data: scenesData, error: scenesError } = await db
      .from('scenes')
      .select('id, order, voiceovers (id, text, language)')
      .eq('storyboard_id', storyboardId)
      .order('order', { ascending: true });

    if (scenesError) {
      return NextResponse.json(
        { error: 'Failed to load scenes' },
        { status: 500 }
      );
    }

    const scenes = (scenesData ?? []) as SceneRow[];
    const queueItems = buildSceneQueueItems(scenes, input.data.language);

    const results: TtsResult[] = [];

    for (let index = 0; index < queueItems.length; index++) {
      if (index > 0) {
        await delay(1000);
      }

      const result = await processSceneTts({
        db,
        scene: queueItems[index],
        voiceId: input.data.voiceId,
        speed: input.data.speed,
        webhookBase,
        storyboardId,
        language: input.data.language,
        ttsModel: input.data.ttsModel,
      });

      results.push(result);
    }

    const queued = results.filter(
      (result) => result.status === 'queued'
    ).length;

    return NextResponse.json({
      provider: providerResolution.provider,
      results,
      summary: {
        total: queueItems.length,
        queued,
        failed: queueItems.length - queued,
      },
    });
  } catch (error) {
    if (isProviderRoutingError(error)) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          source: error.source,
          field: error.field,
          service: error.service,
          value: error.value,
        },
        { status: error.statusCode }
      );
    }

    console.error('[v2/storyboard/generate-tts] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
