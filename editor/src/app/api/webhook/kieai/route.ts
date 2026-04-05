import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger, type Logger } from '@/lib/logger';
import {
  parseResultJson,
  verifyWebhookSignature,
  type KieWebhookVerificationResult,
} from '@/lib/kieai';
import { probeMediaDuration } from '@/lib/media-probe';

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
    taskId?: string;
    state?: string;
    resultJson?: string;
    model?: string;
    callbackType?: string;
    data?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

type DebugLogClient = {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => Promise<unknown>;
  };
};

function extractTraceId(url: URL): string | null {
  return url.searchParams.get('trace_id') || null;
}

async function logTraceEvent(
  supabase: DebugLogClient,
  event: {
    traceId: string;
    step: string;
    kind:
      | 'request_start'
      | 'request_complete'
      | 'task_queued'
      | 'webhook_received';
    storyboardId?: string;
    data?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await supabase.from('debug_logs').insert({
      step: event.step,
      payload: {
        trace_id: event.traceId,
        trace_kind: event.kind,
        storyboard_id: event.storyboardId ?? null,
        ...event.data,
        logged_at: new Date().toISOString(),
      },
    });
  } catch {
    // Trace logging should never break webhook processing.
  }
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

  // kie.ai returns image URLs in "resultUrls" array
  const resultUrls = result.resultUrls;
  if (Array.isArray(resultUrls) && resultUrls.length > 0) {
    const first = resultUrls[0];
    if (typeof first === 'string' && first.length > 0) return first;
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
  const direct = [result.video_url, result.videoUrl, result.url].find(
    (candidate) => typeof candidate === 'string' && candidate.length > 0
  );

  if (typeof direct === 'string') {
    return direct;
  }

  const resultUrls = result.resultUrls;
  if (Array.isArray(resultUrls) && resultUrls.length > 0) {
    const first = resultUrls[0];
    if (typeof first === 'string' && first.length > 0) return first;
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

  const resultUrls = result.resultUrls;
  if (Array.isArray(resultUrls) && resultUrls.length > 0) {
    const first = resultUrls[0];
    if (typeof first === 'string' && first.length > 0) return first;
    if (first && typeof first === 'object' && 'url' in first) {
      const url = (first as { url?: unknown }).url;
      if (typeof url === 'string' && url.length > 0) return url;
    }
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

interface SunoTrack {
  id?: unknown;
  audio_url?: unknown;
  image_url?: unknown;
  duration?: unknown;
  title?: unknown;
  tags?: unknown;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function parseSunoTracks(payload: KieWebhookPayload): SunoTrack[] {
  const rawTracks = payload.data?.data;
  if (!Array.isArray(rawTracks)) return [];

  return rawTracks.filter(
    (item): item is SunoTrack => !!item && typeof item === 'object'
  );
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

type RuntimeTaskKey = 'tts_tasks' | 'video_tasks';

async function consumeEpisodeRuntimeTask(params: {
  supabase: any;
  episodeId: string;
  sceneId: string;
  taskId: string;
  taskKey: RuntimeTaskKey;
}): Promise<
  { ok: true } | { ok: false; reason: 'episode_missing' | 'task_mismatch' }
> {
  const { supabase, episodeId, sceneId, taskId, taskKey } = params;

  const { data: episode } = await supabase
    .from('episodes')
    .select('id, plan_json')
    .eq('id', episodeId)
    .maybeSingle();

  if (!episode) {
    return { ok: false, reason: 'episode_missing' };
  }

  const planJson = toRecord(episode.plan_json);
  const runtime = toRecord(planJson.generation_runtime);
  const tasks = toRecord(runtime[taskKey]);
  const task = toRecord(tasks[sceneId]);
  const expectedTaskId =
    typeof task.task_id === 'string' && task.task_id.length > 0
      ? task.task_id
      : null;

  if (expectedTaskId && expectedTaskId !== taskId) {
    return { ok: false, reason: 'task_mismatch' };
  }

  if (sceneId in tasks) {
    delete tasks[sceneId];
    runtime[taskKey] = tasks;
    planJson.generation_runtime = runtime;

    await supabase
      .from('episodes')
      .update({ plan_json: planJson })
      .eq('id', episodeId);
  }

  return { ok: true };
}

async function guardRequest(params: {
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
  supabase: any;
  payload: KieWebhookPayload;
  taskId: string;
  sceneId: string;
  log: Logger;
}): Promise<Response> {
  const { supabase, payload, taskId, sceneId, log } = params;

  const state = payload.data?.state ?? null;
  if (isInProgressState(state)) {
    return okResponse({ success: true, pending: true, step: 'GenerateVideo' });
  }

  if (isFailureState(state)) {
    await supabase
      .from('scenes')
      .update({ video_status: 'failed', video_task_id: null })
      .eq('id', sceneId);

    return okResponse({ success: true, step: 'GenerateVideo', failed: true });
  }

  const result = parseResultJson(payload.data?.resultJson);
  const videoUrl = extractVideoUrl(result);

  if (!videoUrl) {
    await supabase
      .from('scenes')
      .update({ video_status: 'failed', video_task_id: null })
      .eq('id', sceneId);

    return okResponse({ success: true, step: 'GenerateVideo', failed: true });
  }

  await supabase
    .from('scenes')
    .update({
      video_url: videoUrl,
      video_status: 'done',
      video_task_id: null,
    })
    .eq('id', sceneId);

  return okResponse({
    success: true,
    step: 'GenerateVideo',
    scene_id: sceneId,
    video_url: videoUrl,
  });
}

async function handleGenerateTts(params: {
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

async function handleGenerateSceneTts(params: {
  supabase: any;
  payload: KieWebhookPayload;
  taskId: string;
  sceneId: string;
  log: Logger;
}): Promise<Response> {
  const { supabase, payload, taskId, sceneId, log } = params;

  const { data: scene } = await supabase
    .from('scenes')
    .select('id, episode_id, video_url')
    .eq('id', sceneId)
    .maybeSingle();

  if (!scene) {
    return staleWebhookResponse(
      'scene_missing',
      'GenerateSceneTTS',
      'scene_id',
      sceneId,
      log
    );
  }

  const state = payload.data?.state ?? null;
  if (isInProgressState(state)) {
    return okResponse({
      success: true,
      pending: true,
      step: 'GenerateSceneTTS',
    });
  }

  const taskGuard = await consumeEpisodeRuntimeTask({
    supabase,
    episodeId: scene.episode_id,
    sceneId,
    taskId,
    taskKey: 'tts_tasks',
  });

  if (!taskGuard.ok && taskGuard.reason === 'task_mismatch') {
    return staleWebhookResponse(
      'task_id_mismatch',
      'GenerateSceneTTS',
      'scene_id',
      sceneId,
      log
    );
  }

  if (isFailureState(state)) {
    await supabase
      .from('scenes')
      .update({ tts_status: 'failed', tts_task_id: null })
      .eq('id', sceneId);

    return okResponse({
      success: true,
      step: 'GenerateSceneTTS',
      failed: true,
    });
  }

  const result = parseResultJson(payload.data?.resultJson);
  const audioUrl = extractAudioUrl(result);

  if (!audioUrl) {
    await supabase
      .from('scenes')
      .update({ tts_status: 'failed', tts_task_id: null })
      .eq('id', sceneId);

    return okResponse({
      success: true,
      step: 'GenerateSceneTTS',
      failed: true,
    });
  }

  // Probe the actual audio file for exact duration
  const audioDuration = await probeMediaDuration(audioUrl);

  await supabase
    .from('scenes')
    .update({
      audio_url: audioUrl,
      ...(audioDuration != null ? { audio_duration: audioDuration } : {}),
      tts_status: 'done',
      tts_task_id: null,
    })
    .eq('id', sceneId);

  return okResponse({
    success: true,
    step: 'GenerateSceneTTS',
    scene_id: sceneId,
    audio_url: audioUrl,
    audio_duration: audioDuration,
  });
}

async function handleGenerateSceneVideo(params: {
  supabase: any;
  payload: KieWebhookPayload;
  taskId: string;
  sceneId: string;
  log: Logger;
}): Promise<Response> {
  const { supabase, payload, taskId, sceneId, log } = params;

  const { data: scene } = await supabase
    .from('scenes')
    .select('id, episode_id, audio_url')
    .eq('id', sceneId)
    .maybeSingle();

  if (!scene) {
    return staleWebhookResponse(
      'scene_missing',
      'GenerateSceneVideo',
      'scene_id',
      sceneId,
      log
    );
  }

  const state = payload.data?.state ?? null;
  if (isInProgressState(state)) {
    return okResponse({
      success: true,
      pending: true,
      step: 'GenerateSceneVideo',
    });
  }

  const taskGuard = await consumeEpisodeRuntimeTask({
    supabase,
    episodeId: scene.episode_id,
    sceneId,
    taskId,
    taskKey: 'video_tasks',
  });

  if (!taskGuard.ok && taskGuard.reason === 'task_mismatch') {
    return staleWebhookResponse(
      'task_id_mismatch',
      'GenerateSceneVideo',
      'scene_id',
      sceneId,
      log
    );
  }

  if (isFailureState(state)) {
    await supabase
      .from('scenes')
      .update({ video_status: 'failed', video_task_id: null })
      .eq('id', sceneId);

    return okResponse({
      success: true,
      step: 'GenerateSceneVideo',
      failed: true,
    });
  }

  const result = parseResultJson(payload.data?.resultJson);
  const videoUrl = extractVideoUrl(result);

  if (!videoUrl) {
    await supabase
      .from('scenes')
      .update({ video_status: 'failed', video_task_id: null })
      .eq('id', sceneId);

    return okResponse({
      success: true,
      step: 'GenerateSceneVideo',
      failed: true,
    });
  }

  // Probe the actual video file for exact duration
  const videoDuration = await probeMediaDuration(videoUrl);

  await supabase
    .from('scenes')
    .update({
      video_url: videoUrl,
      ...(videoDuration != null ? { video_duration: videoDuration } : {}),
      video_status: 'done',
      video_task_id: null,
    })
    .eq('id', sceneId);

  return okResponse({
    success: true,
    step: 'GenerateSceneVideo',
    scene_id: sceneId,
    video_url: videoUrl,
    video_duration: videoDuration,
  });
}

async function handleGenerateFaceGrid(params: {
  supabase: any;
  payload: KieWebhookPayload;
  taskId: string;
  characterId: string;
  log: Logger;
}): Promise<Response> {
  const { supabase, payload, taskId, characterId, log } = params;

  const state = payload.data?.state ?? null;
  if (isInProgressState(state)) {
    return okResponse({
      success: true,
      pending: true,
      step: 'GenerateFaceGrid',
    });
  }

  if (isFailureState(state)) {
    await supabase
      .from('project_characters')
      .update({ face_grid_status: 'failed', face_grid_task_id: null })
      .eq('id', characterId)
      .eq('face_grid_task_id', taskId);

    return okResponse({
      success: true,
      step: 'GenerateFaceGrid',
      failed: true,
    });
  }

  const result = parseResultJson(payload.data?.resultJson);
  const imageUrl = extractImageUrl(result);

  if (!imageUrl) {
    await supabase
      .from('project_characters')
      .update({ face_grid_status: 'failed', face_grid_task_id: null })
      .eq('id', characterId)
      .eq('face_grid_task_id', taskId);

    return okResponse({
      success: true,
      step: 'GenerateFaceGrid',
      failed: true,
    });
  }

  await supabase
    .from('project_characters')
    .update({
      face_grid_url: imageUrl,
      face_grid_status: 'done',
      face_grid_task_id: null,
    })
    .eq('id', characterId)
    .eq('face_grid_task_id', taskId);

  log.info('Face grid generated', { characterId, imageUrl });

  return okResponse({
    success: true,
    step: 'GenerateFaceGrid',
    character_id: characterId,
    image_url: imageUrl,
  });
}

async function handleGenerateImage(params: {
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

async function handleSeriesAssetImage(params: {
  supabase: any;
  payload: KieWebhookPayload;
  taskId: string;
  variantId: string;
  log: Logger;
}): Promise<Response> {
  const { supabase, payload, taskId, variantId, log } = params;

  const state = payload.data?.state ?? null;
  if (isInProgressState(state)) {
    return okResponse({
      success: true,
      pending: true,
      step: 'SeriesAssetImage',
    });
  }

  if (isFailureState(state)) {
    await supabase
      .from('project_asset_variants')
      .update({ image_gen_status: 'failed', image_task_id: null })
      .eq('id', variantId);

    return okResponse({
      success: true,
      step: 'SeriesAssetImage',
      failed: true,
    });
  }

  const result = parseResultJson(payload.data?.resultJson);
  const imageUrl = extractImageUrl(result);

  if (!imageUrl) {
    await supabase
      .from('project_asset_variants')
      .update({ image_gen_status: 'failed', image_task_id: null })
      .eq('id', variantId);

    return okResponse({
      success: true,
      step: 'SeriesAssetImage',
      failed: true,
      reason: 'missing_image_url',
    });
  }

  // Use kie.ai URL directly — no download/upload to Storage
  await supabase
    .from('project_asset_variants')
    .update({
      image_url: imageUrl,
      image_gen_status: 'done',
      image_task_id: null,
    })
    .eq('id', variantId);

  log.info('Project asset image URL saved from kie webhook', {
    variant_id: variantId,
    task_id: taskId,
    image_url: imageUrl,
  });

  return okResponse({
    success: true,
    step: 'SeriesAssetImage',
    variant_id: variantId,
    url: imageUrl,
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: webhook completion and alt-track handling
async function handleGenerateMusic(params: {
  supabase: any;
  payload: KieWebhookPayload;
  taskId: string;
  musicId: string;
  log: Logger;
}): Promise<Response> {
  const { supabase, payload, taskId, musicId, log } = params;
  const callbackType = payload.data?.callbackType ?? null;

  if (callbackType !== 'complete') {
    return okResponse({
      success: true,
      pending: true,
      step: 'GenerateMusic',
      callback_type: callbackType,
    });
  }

  const tracks = parseSunoTracks(payload);
  const primaryTrack = tracks[0];
  if (!primaryTrack) {
    await supabase
      .from('project_music')
      .update({
        status: 'failed',
        generation_metadata: payload,
      })
      .eq('id', musicId)
      .eq('task_id', taskId)
      .eq('status', 'generating');

    return okResponse({
      success: true,
      step: 'GenerateMusic',
      failed: true,
      reason: 'missing_primary_track',
    });
  }

  const primaryAudioUrl = normalizeNonEmptyString(primaryTrack.audio_url);
  const primaryImageUrl = normalizeNonEmptyString(primaryTrack.image_url);
  const primaryDuration = normalizeNullableNumber(primaryTrack.duration);
  const primaryTrackId = normalizeNonEmptyString(primaryTrack.id);

  if (!primaryAudioUrl) {
    await supabase
      .from('project_music')
      .update({
        status: 'failed',
        generation_metadata: payload,
      })
      .eq('id', musicId)
      .eq('task_id', taskId)
      .eq('status', 'generating');

    return okResponse({
      success: true,
      step: 'GenerateMusic',
      failed: true,
      reason: 'missing_audio_url',
    });
  }

  const { data: updatedMusic, error: updateError } = await supabase
    .from('project_music')
    .update({
      audio_url: primaryAudioUrl,
      cover_image_url: primaryImageUrl,
      duration: primaryDuration,
      suno_track_id: primaryTrackId,
      status: 'done',
      generation_metadata: payload,
    })
    .eq('id', musicId)
    .eq('task_id', taskId)
    .eq('status', 'generating')
    .select(
      'id, project_id, name, music_type, prompt, style, title, sort_order'
    )
    .maybeSingle();

  if (updateError) {
    log.error('Failed to update project_music from GenerateMusic webhook', {
      music_id: musicId,
      task_id: taskId,
      error: updateError,
    });
    return okResponse({
      success: true,
      step: 'GenerateMusic',
      failed: true,
      reason: 'update_failed',
    });
  }

  if (!updatedMusic) {
    return staleWebhookResponse(
      'status_mismatch',
      'GenerateMusic',
      'music_id',
      musicId,
      log
    );
  }

  const altTrack = tracks[1];
  let altTrackId: string | null = null;

  if (altTrack) {
    const altAudioUrl = normalizeNonEmptyString(altTrack.audio_url);
    if (altAudioUrl) {
      const altImageUrl = normalizeNonEmptyString(altTrack.image_url);
      const altDuration = normalizeNullableNumber(altTrack.duration);
      const altSunoTrackId = normalizeNonEmptyString(altTrack.id);
      const altTitle =
        normalizeNonEmptyString(altTrack.title) ??
        normalizeNonEmptyString(updatedMusic.title) ??
        null;

      const { data: maxSortRow } = await supabase
        .from('project_music')
        .select('sort_order')
        .eq('project_id', updatedMusic.project_id)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextSortOrder =
        typeof maxSortRow?.sort_order === 'number'
          ? maxSortRow.sort_order + 1
          : typeof updatedMusic.sort_order === 'number'
            ? updatedMusic.sort_order + 1
            : 0;

      const { data: altRow, error: altInsertError } = await supabase
        .from('project_music')
        .insert({
          project_id: updatedMusic.project_id,
          name: `${updatedMusic.name} (Alt)`,
          music_type: updatedMusic.music_type,
          prompt: updatedMusic.prompt,
          style: updatedMusic.style,
          title: altTitle,
          audio_url: altAudioUrl,
          cover_image_url: altImageUrl,
          duration: altDuration,
          status: 'done',
          task_id: taskId,
          suno_track_id: altSunoTrackId,
          generation_metadata: payload,
          sort_order: nextSortOrder,
        })
        .select('id')
        .maybeSingle();

      if (altInsertError) {
        log.error('Failed to insert alternate project_music row', {
          music_id: musicId,
          task_id: taskId,
          error: altInsertError,
        });
      } else if (altRow?.id) {
        altTrackId = altRow.id as string;
      }
    }
  }

  return okResponse({
    success: true,
    step: 'GenerateMusic',
    music_id: musicId,
    audio_url: primaryAudioUrl,
    ...(altTrackId ? { alt_music_id: altTrackId } : {}),
  });
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: webhook router
export async function POST(req: NextRequest) {
  const log = createLogger();
  log.setContext({ step: 'KieWebhook' });

  try {
    const payload = (await req.json()) as KieWebhookPayload;
    const taskId = payload.data?.task_id ?? payload.data?.taskId ?? null;

    const signature = req.headers.get('x-webhook-signature');
    const timestamp = req.headers.get('x-webhook-timestamp');
    const hmacKey = process.env.KIE_WEBHOOK_HMAC_KEY?.trim() ?? '';

    // HMAC verification — skip if no key configured or kie.ai didn't send headers
    let verification: KieWebhookVerificationResult;
    if (hmacKey && signature && timestamp) {
      verification = verifyWebhookSignature({
        payload,
        signature,
        timestamp,
        hmacKey,
        nowSeconds: Math.floor(Date.now() / 1000),
      });

      if (!verification.ok) {
        log.warn('Rejected webhook: invalid signature', {
          reason: verification.reason,
          task_id: verification.taskId ?? taskId,
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
    } else {
      // No HMAC headers — accept but extract taskId from payload
      verification = {
        ok: true,
        taskId: typeof taskId === 'string' ? taskId : null,
      };
    }

    const supabase = createServiceClient();
    const traceId = extractTraceId(req.nextUrl);

    await supabase.from('debug_logs').insert({
      step: 'KieWebhook',
      payload: {
        ...payload,
        ...(traceId ? { trace_id: traceId } : {}),
      },
    });

    const step = req.nextUrl.searchParams.get('step') ?? payload.data?.model;

    if (traceId && verification.taskId && typeof step === 'string') {
      await logTraceEvent(supabase, {
        traceId,
        step,
        kind: 'webhook_received',
        data: {
          provider: 'kie',
          provider_task_id: verification.taskId,
          status: payload.data?.status ?? payload.data?.state ?? null,
        },
      });
    }

    if (!verification.taskId) {
      return okResponse({
        success: true,
        ignored: true,
        reason: 'missing_task',
      });
    }

    if (step === 'GenerateSceneVideo') {
      const sceneId = req.nextUrl.searchParams.get('scene_id');
      if (!sceneId) {
        return okResponse({
          success: true,
          ignored: true,
          reason: 'missing_scene_id',
        });
      }

      return await handleGenerateSceneVideo({
        supabase,
        payload,
        taskId: verification.taskId,
        sceneId,
        log,
      });
    }

    if (step === 'GenerateSceneTTS') {
      const sceneId = req.nextUrl.searchParams.get('scene_id');
      if (!sceneId) {
        return okResponse({
          success: true,
          ignored: true,
          reason: 'missing_scene_id',
        });
      }

      return await handleGenerateSceneTts({
        supabase,
        payload,
        taskId: verification.taskId,
        sceneId,
        log,
      });
    }

    if (step === 'GenerateVideo' || step === 'grok-imagine/image-to-video') {
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

    if (step === 'GenerateMusic') {
      const musicId = req.nextUrl.searchParams.get('music_id');
      if (!musicId) {
        return okResponse({
          success: true,
          ignored: true,
          reason: 'missing_music_id',
        });
      }

      return await handleGenerateMusic({
        supabase,
        payload,
        taskId: verification.taskId,
        musicId,
        log,
      });
    }

    if (step === 'SeriesAssetImage') {
      const variantId = req.nextUrl.searchParams.get('variant_id');
      if (!variantId) {
        return okResponse({
          success: true,
          ignored: true,
          reason: 'missing_variant_id',
        });
      }

      return await handleSeriesAssetImage({
        supabase,
        payload,
        taskId: verification.taskId,
        variantId,
        log,
      });
    }

    if (step === 'GenerateFaceGrid') {
      const characterId = req.nextUrl.searchParams.get('character_id');
      if (!characterId) {
        return okResponse({
          success: true,
          ignored: true,
          reason: 'missing_character_id',
        });
      }

      return await handleGenerateFaceGrid({
        supabase,
        payload,
        taskId: verification.taskId,
        characterId,
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
