import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger, type Logger } from '@/lib/logger';
import { parseResultJson, verifyWebhook } from '@/lib/kieai';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, x-client-info, apikey, x-webhook-signature, x-webhook-timestamp',
};

interface KieWebhookPayload {
  code?: number;
  msg?: string;
  data?: {
    task_id?: string;
    state?: string;
    resultJson?: string;
    model?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function okResponse(payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function staleWebhookResponse(
  reason: string,
  step: string,
  entityKey: string,
  entityId: string,
  log: Logger
): Response {
  log.warn('Ignoring stale kie webhook', {
    reason,
    step,
    [entityKey]: entityId,
  });

  return okResponse({ success: true, ignored: true, reason });
}

function isInProgressState(state: string | null | undefined): boolean {
  return state === 'waiting' || state === 'queuing' || state === 'generating';
}

function isFailureState(state: string | null | undefined): boolean {
  return state === 'fail';
}

function extractImageUrl(result: Record<string, unknown>): string | null {
  const direct = [
    result.image_url,
    result.imageUrl,
    result.url,
    result.output,
  ].find((candidate) => typeof candidate === 'string' && candidate.length > 0);

  if (typeof direct === 'string') {
    return direct;
  }

  const images = result.images;
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    if (typeof first === 'string' && first.length > 0) return first;
    if (first && typeof first === 'object' && 'url' in first) {
      const url = (first as { url?: unknown }).url;
      if (typeof url === 'string' && url.length > 0) return url;
    }
  }

  return null;
}

function extractVideoUrl(result: Record<string, unknown>): string | null {
  const direct = [result.video_url, result.videoUrl].find(
    (candidate) => typeof candidate === 'string' && candidate.length > 0
  );

  if (typeof direct === 'string') {
    return direct;
  }

  const video = result.video;
  if (typeof video === 'string' && video.length > 0) return video;
  if (Array.isArray(video) && video.length > 0) {
    const first = video[0];
    if (typeof first === 'string' && first.length > 0) return first;
    if (first && typeof first === 'object' && 'url' in first) {
      const url = (first as { url?: unknown }).url;
      if (typeof url === 'string' && url.length > 0) return url;
    }
  }

  return null;
}

function extractAudioUrl(result: Record<string, unknown>): string | null {
  const direct = [result.audio_url, result.audioUrl, result.url].find(
    (candidate) => typeof candidate === 'string' && candidate.length > 0
  );

  if (typeof direct === 'string') {
    return direct;
  }

  const audio = result.audio;
  if (audio && typeof audio === 'object' && 'url' in audio) {
    const url = (audio as { url?: unknown }).url;
    if (typeof url === 'string' && url.length > 0) {
      return url;
    }
  }

  return null;
}

async function guardRequest(params: {
  // biome-ignore lint/suspicious/noExplicitAny: Supabase client type is generated outside this repo.
  supabase: any;
  table: string;
  idColumn: string;
  id: string;
  statusColumn: string;
  requestIdColumn: string;
  allowedStatuses: string[];
  taskId: string;
  step: string;
  log: Logger;
}): Promise<{ ok: true } | { ok: false; response: Response }> {
  const {
    supabase,
    table,
    idColumn,
    id,
    statusColumn,
    requestIdColumn,
    allowedStatuses,
    taskId,
    step,
    log,
  } = params;

  const { data: row } = await supabase
    .from(table)
    .select(`${statusColumn}, ${requestIdColumn}`)
    .eq(idColumn, id)
    .maybeSingle();

  if (!row) {
    return {
      ok: false,
      response: staleWebhookResponse('row_missing', step, idColumn, id, log),
    };
  }

  const currentStatus =
    (row as Record<string, string | null | undefined>)[statusColumn] ?? null;
  const currentTaskId =
    (row as Record<string, string | null | undefined>)[requestIdColumn] ?? null;

  if (!allowedStatuses.includes(currentStatus ?? '')) {
    return {
      ok: false,
      response: staleWebhookResponse(
        'status_mismatch',
        step,
        idColumn,
        id,
        log
      ),
    };
  }

  if (currentTaskId && currentTaskId !== taskId) {
    return {
      ok: false,
      response: staleWebhookResponse(
        'task_id_mismatch',
        step,
        idColumn,
        id,
        log
      ),
    };
  }

  return { ok: true };
}

async function handleGenerateVideo(params: {
  // biome-ignore lint/suspicious/noExplicitAny: Supabase client type is generated outside this repo.
  supabase: any;
  payload: KieWebhookPayload;
  taskId: string;
  sceneId: string;
  log: Logger;
}): Promise<Response> {
  const { supabase, payload, taskId, sceneId, log } = params;

  const guard = await guardRequest({
    supabase,
    table: 'scenes',
    idColumn: 'id',
    id: sceneId,
    statusColumn: 'video_status',
    requestIdColumn: 'video_request_id',
    allowedStatuses: ['processing'],
    taskId,
    step: 'GenerateVideo',
    log,
  });

  if (!guard.ok) return guard.response;

  const state = payload.data?.state ?? null;
  if (isInProgressState(state)) {
    return okResponse({ success: true, pending: true, step: 'GenerateVideo' });
  }

  if (isFailureState(state)) {
    await supabase
      .from('scenes')
      .update({
        video_status: 'failed',
        video_error_message: `kie.ai task failed (${state})`,
      })
      .eq('id', sceneId)
      .eq('video_request_id', taskId)
      .eq('video_status', 'processing');

    return okResponse({ success: true, step: 'GenerateVideo', failed: true });
  }

  const result = parseResultJson(payload.data?.resultJson);
  const videoUrl = extractVideoUrl(result);

  if (!videoUrl) {
    await supabase
      .from('scenes')
      .update({
        video_status: 'failed',
        video_error_message: 'No video URL in kie.ai resultJson',
      })
      .eq('id', sceneId)
      .eq('video_request_id', taskId)
      .eq('video_status', 'processing');

    return okResponse({ success: true, step: 'GenerateVideo', failed: true });
  }

  await supabase
    .from('scenes')
    .update({
      video_status: 'success',
      video_url: videoUrl,
      video_error_message: null,
    })
    .eq('id', sceneId)
    .eq('video_request_id', taskId)
    .eq('video_status', 'processing');

  return okResponse({
    success: true,
    step: 'GenerateVideo',
    scene_id: sceneId,
    video_url: videoUrl,
  });
}

async function handleGenerateTts(params: {
  // biome-ignore lint/suspicious/noExplicitAny: Supabase client type is generated outside this repo.
  supabase: any;
  payload: KieWebhookPayload;
  taskId: string;
  voiceoverId: string;
  log: Logger;
}): Promise<Response> {
  const { supabase, payload, taskId, voiceoverId, log } = params;

  const guard = await guardRequest({
    supabase,
    table: 'voiceovers',
    idColumn: 'id',
    id: voiceoverId,
    statusColumn: 'status',
    requestIdColumn: 'request_id',
    allowedStatuses: ['processing'],
    taskId,
    step: 'GenerateTTS',
    log,
  });

  if (!guard.ok) return guard.response;

  const state = payload.data?.state ?? null;
  if (isInProgressState(state)) {
    return okResponse({ success: true, pending: true, step: 'GenerateTTS' });
  }

  if (isFailureState(state)) {
    await supabase
      .from('voiceovers')
      .update({
        status: 'failed',
        error_message: `kie.ai task failed (${state})`,
      })
      .eq('id', voiceoverId)
      .eq('request_id', taskId)
      .eq('status', 'processing');

    return okResponse({ success: true, step: 'GenerateTTS', failed: true });
  }

  const result = parseResultJson(payload.data?.resultJson);
  const audioUrl = extractAudioUrl(result);

  if (!audioUrl) {
    await supabase
      .from('voiceovers')
      .update({
        status: 'failed',
        error_message: 'No audio URL in kie.ai resultJson',
      })
      .eq('id', voiceoverId)
      .eq('request_id', taskId)
      .eq('status', 'processing');

    return okResponse({ success: true, step: 'GenerateTTS', failed: true });
  }

  await supabase
    .from('voiceovers')
    .update({
      status: 'success',
      audio_url: audioUrl,
      error_message: null,
    })
    .eq('id', voiceoverId)
    .eq('request_id', taskId)
    .eq('status', 'processing');

  return okResponse({
    success: true,
    step: 'GenerateTTS',
    voiceover_id: voiceoverId,
    audio_url: audioUrl,
  });
}

async function handleGenerateImage(params: {
  // biome-ignore lint/suspicious/noExplicitAny: Supabase client type is generated outside this repo.
  supabase: any;
  payload: KieWebhookPayload;
  taskId: string;
  gridImageId: string;
  log: Logger;
}): Promise<Response> {
  const { supabase, payload, taskId, gridImageId, log } = params;

  const guard = await guardRequest({
    supabase,
    table: 'grid_images',
    idColumn: 'id',
    id: gridImageId,
    statusColumn: 'status',
    requestIdColumn: 'request_id',
    allowedStatuses: ['processing'],
    taskId,
    step: 'GenGridImage',
    log,
  });

  if (!guard.ok) return guard.response;

  const state = payload.data?.state ?? null;
  if (isInProgressState(state)) {
    return okResponse({ success: true, pending: true, step: 'GenGridImage' });
  }

  if (isFailureState(state)) {
    await supabase
      .from('grid_images')
      .update({
        status: 'failed',
        error_message: `kie.ai task failed (${state})`,
      })
      .eq('id', gridImageId)
      .eq('request_id', taskId)
      .eq('status', 'processing');

    return okResponse({ success: true, step: 'GenGridImage', failed: true });
  }

  const result = parseResultJson(payload.data?.resultJson);
  const imageUrl = extractImageUrl(result);

  if (!imageUrl) {
    await supabase
      .from('grid_images')
      .update({
        status: 'failed',
        error_message: 'No image URL in kie.ai resultJson',
      })
      .eq('id', gridImageId)
      .eq('request_id', taskId)
      .eq('status', 'processing');

    return okResponse({ success: true, step: 'GenGridImage', failed: true });
  }

  await supabase
    .from('grid_images')
    .update({ status: 'generated', url: imageUrl, error_message: null })
    .eq('id', gridImageId)
    .eq('request_id', taskId)
    .eq('status', 'processing');

  return okResponse({
    success: true,
    step: 'GenGridImage',
    grid_image_id: gridImageId,
    image_url: imageUrl,
  });
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const log = createLogger();
  log.setContext({ step: 'KieWebhook' });

  try {
    const payload = (await req.json()) as KieWebhookPayload;
    const taskId = payload.data?.task_id ?? null;

    const signature = req.headers.get('x-webhook-signature');
    const timestamp = req.headers.get('x-webhook-timestamp');
    const verification = verifyWebhook({
      payload,
      signature,
      timestamp,
    });

    if (!verification.ok) {
      log.warn('Rejected webhook: invalid signature', {
        reason: verification.reason,
        task_id: taskId,
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: verification.reason ?? 'invalid_signature',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        }
      );
    }

    const supabase = createServiceClient();
    await supabase.from('debug_logs').insert({
      step: 'KieWebhook',
      payload,
    });

    const step = req.nextUrl.searchParams.get('step') ?? payload.data?.model;

    if (!verification.taskId) {
      return okResponse({
        success: true,
        ignored: true,
        reason: 'missing_task',
      });
    }

    if (step === 'GenerateVideo' || step === 'kling-3.0/video') {
      const sceneId = req.nextUrl.searchParams.get('scene_id');
      if (!sceneId) {
        return okResponse({
          success: true,
          ignored: true,
          reason: 'missing_scene_id',
        });
      }

      return await handleGenerateVideo({
        supabase,
        payload,
        taskId: verification.taskId,
        sceneId,
        log,
      });
    }

    if (
      step === 'GenerateTTS' ||
      step === 'elevenlabs/text-to-speech-turbo-2-5' ||
      step === 'elevenlabs/text-to-speech-multilingual-v2'
    ) {
      const voiceoverId = req.nextUrl.searchParams.get('voiceover_id');
      if (!voiceoverId) {
        return okResponse({
          success: true,
          ignored: true,
          reason: 'missing_voiceover_id',
        });
      }

      return await handleGenerateTts({
        supabase,
        payload,
        taskId: verification.taskId,
        voiceoverId,
        log,
      });
    }

    if (step === 'GenGridImage' || step === 'nano-banana-2') {
      const gridImageId = req.nextUrl.searchParams.get('grid_image_id');
      if (!gridImageId) {
        return okResponse({
          success: true,
          ignored: true,
          reason: 'missing_grid_image_id',
        });
      }

      return await handleGenerateImage({
        supabase,
        payload,
        taskId: verification.taskId,
        gridImageId,
        log,
      });
    }

    log.warn('Unhandled kie webhook step/model', {
      step,
      task_id: verification.taskId,
    });

    return okResponse({
      success: true,
      ignored: true,
      reason: 'unhandled_step',
      step,
    });
  } catch (error) {
    log.error('Unhandled kie webhook exception', {
      error: error instanceof Error ? error.message : String(error),
    });

    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      }
    );
  }
}
