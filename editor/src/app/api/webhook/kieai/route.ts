import type { NextRequest } from 'next/server';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger, type Logger } from '@/lib/logger';
import {
  parseResultJson,
  verifyWebhookSignature,
  type KieWebhookVerificationResult,
} from '@/lib/kieai';

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

interface SeriesGenerationJobMeta {
  prompt?: string | null;
  model?: string | null;
  config?: {
    cell_prompts?: Array<{ variant_id?: string; prompt?: string }>;
  } | null;
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

async function loadSeriesGenerationJob(
  supabase: any,
  taskId: string
): Promise<SeriesGenerationJobMeta | null> {
  const { data } = await supabase
    .from('series_generation_jobs')
    .select('prompt, model, config')
    .eq('request_id', taskId)
    .maybeSingle();

  return (data ?? null) as SeriesGenerationJobMeta | null;
}

async function clearVariantImages(supabase: any, variantId: string) {
  const { data: oldImages } = await supabase
    .from('series_asset_variant_images')
    .select('storage_path')
    .eq('variant_id', variantId);

  const oldPaths = (oldImages ?? [])
    .map((row: { storage_path?: string | null }) => row.storage_path)
    .filter(
      (p: string | null | undefined): p is string =>
        typeof p === 'string' && p.length > 0
    );

  if (oldPaths.length > 0) {
    await supabase.storage.from('series-assets').remove(oldPaths);
  }

  await supabase
    .from('series_asset_variant_images')
    .delete()
    .eq('variant_id', variantId);
}

async function uploadVariantImage(params: {
  supabase: any;
  variantId: string;
  imageBuffer: Buffer;
  contentType: string;
  suffix: string;
}): Promise<{ publicUrl: string; storagePath: string }> {
  const { supabase, variantId, imageBuffer, contentType, suffix } = params;

  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const storagePath = `generated/${variantId}/${Date.now()}_${suffix}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('series-assets')
    .upload(storagePath, imageBuffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from('series-assets').getPublicUrl(storagePath);

  return { publicUrl, storagePath };
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

  await supabase
    .from('scenes')
    .update({
      audio_url: audioUrl,
      tts_status: 'done',
      tts_task_id: null,
    })
    .eq('id', sceneId);

  return okResponse({
    success: true,
    step: 'GenerateSceneTTS',
    scene_id: sceneId,
    audio_url: audioUrl,
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
    step: 'GenerateSceneVideo',
    scene_id: sceneId,
    video_url: videoUrl,
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
      .from('series_asset_variants')
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
      .from('series_asset_variants')
      .update({ image_gen_status: 'failed', image_task_id: null })
      .eq('id', variantId);

    return okResponse({
      success: true,
      step: 'SeriesAssetImage',
      failed: true,
      reason: 'missing_image_url',
    });
  }

  const { data: existingImages } = await supabase
    .from('series_asset_variant_images')
    .select('id, metadata')
    .eq('variant_id', variantId)
    .order('created_at', { ascending: false })
    .limit(20);

  const duplicate = (existingImages ?? []).some(
    (row: { metadata?: unknown }) => {
      const metadata =
        row.metadata && typeof row.metadata === 'object'
          ? (row.metadata as Record<string, unknown>)
          : null;
      return metadata?.kie_task_id === taskId;
    }
  );

  if (duplicate) {
    return okResponse({
      success: true,
      step: 'SeriesAssetImage',
      variant_id: variantId,
      duplicate: true,
    });
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    return okResponse({
      success: true,
      step: 'SeriesAssetImage',
      failed: true,
      reason: 'image_download_failed',
    });
  }

  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const contentType = imageResponse.headers.get('content-type') ?? 'image/jpeg';
  const jobMeta = await loadSeriesGenerationJob(supabase, taskId);

  await clearVariantImages(supabase, variantId);

  const uploaded = await uploadVariantImage({
    supabase,
    variantId,
    imageBuffer,
    contentType,
    suffix: 'kie_single',
  });

  await supabase.from('series_asset_variant_images').insert({
    variant_id: variantId,
    angle: 'front',
    kind: 'frontal',
    url: uploaded.publicUrl,
    storage_path: uploaded.storagePath,
    source: 'generated',
    metadata: {
      provider: 'kie',
      kie_task_id: taskId,
      prompt: jobMeta?.prompt ?? null,
      model: jobMeta?.model ?? payload.data?.model ?? null,
    },
  });

  // Update canonical image_url + generation status on the variant
  await supabase
    .from('series_asset_variants')
    .update({
      image_url: uploaded.publicUrl,
      image_gen_status: 'done',
      image_task_id: null,
    })
    .eq('id', variantId);

  log.info('Series asset image persisted from kie webhook', {
    variant_id: variantId,
    task_id: taskId,
  });

  return okResponse({
    success: true,
    step: 'SeriesAssetImage',
    variant_id: variantId,
    url: uploaded.publicUrl,
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: grid cell loop
async function handleSeriesGridImage(params: {
  supabase: any;
  payload: KieWebhookPayload;
  taskId: string;
  variantIds: string[];
  cols: number;
  rows: number;
  log: Logger;
}): Promise<Response> {
  const { supabase, payload, taskId, variantIds, cols, rows, log } = params;

  const state = payload.data?.state ?? null;
  if (isInProgressState(state)) {
    return okResponse({
      success: true,
      pending: true,
      step: 'SeriesGridImage',
    });
  }

  if (isFailureState(state)) {
    return okResponse({ success: true, step: 'SeriesGridImage', failed: true });
  }

  const result = parseResultJson(payload.data?.resultJson);
  const imageUrl = extractImageUrl(result);

  if (!imageUrl) {
    return okResponse({
      success: true,
      step: 'SeriesGridImage',
      failed: true,
      reason: 'missing_image_url',
    });
  }

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    return okResponse({
      success: true,
      step: 'SeriesGridImage',
      failed: true,
      reason: 'image_download_failed',
    });
  }

  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? cols * 1024;
  const height = metadata.height ?? rows * 1024;
  const cellWidth = Math.floor(width / cols);
  const cellHeight = Math.floor(height / rows);
  const jobMeta = await loadSeriesGenerationJob(supabase, taskId);
  const model = jobMeta?.model ?? payload.data?.model ?? 'nano-banana-2';

  const cellPrompts = Array.isArray(jobMeta?.config?.cell_prompts)
    ? jobMeta?.config?.cell_prompts
    : [];

  const results: Array<{
    variant_id: string;
    success: boolean;
    url?: string;
  }> = [];

  for (let idx = 0; idx < variantIds.length; idx++) {
    const variantId = variantIds[idx];
    const col = idx % cols;
    const row = Math.floor(idx / cols);

    try {
      const cellBuffer = await sharp(imageBuffer)
        .extract({
          left: col * cellWidth,
          top: row * cellHeight,
          width: cellWidth,
          height: cellHeight,
        })
        .jpeg({ quality: 95 })
        .toBuffer();

      await clearVariantImages(supabase, variantId);

      const uploaded = await uploadVariantImage({
        supabase,
        variantId,
        imageBuffer: cellBuffer,
        contentType: 'image/jpeg',
        suffix: `kie_grid_${idx}`,
      });

      const cellPrompt =
        cellPrompts.find((item) => item?.variant_id === variantId)?.prompt ??
        null;

      await supabase.from('series_asset_variant_images').insert({
        variant_id: variantId,
        angle: 'front',
        kind: 'frontal',
        url: uploaded.publicUrl,
        storage_path: uploaded.storagePath,
        source: 'generated',
        metadata: {
          provider: 'kie',
          kie_task_id: taskId,
          grid_position: { row, col, index: idx },
          generation_mode: 'grid',
          prompt: cellPrompt ?? jobMeta?.prompt ?? null,
          cell_prompt: cellPrompt,
          grid_prompt: jobMeta?.prompt ?? null,
          model,
        },
      });

      results.push({
        variant_id: variantId,
        success: true,
        url: uploaded.publicUrl,
      });
    } catch (error) {
      log.warn('Failed to persist one grid cell', {
        variant_id: variantId,
        task_id: taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      results.push({ variant_id: variantId, success: false });
    }
  }

  return okResponse({
    success: true,
    step: 'SeriesGridImage',
    task_id: taskId,
    results,
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

    if (step === 'SeriesGridImage') {
      const variantIds = (req.nextUrl.searchParams.get('variant_ids') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      const cols = Number.parseInt(
        req.nextUrl.searchParams.get('cols') ?? '',
        10
      );
      const rows = Number.parseInt(
        req.nextUrl.searchParams.get('rows') ?? '',
        10
      );

      if (
        variantIds.length === 0 ||
        !Number.isFinite(cols) ||
        !Number.isFinite(rows) ||
        cols < 1 ||
        rows < 1
      ) {
        return okResponse({
          success: true,
          ignored: true,
          reason: 'invalid_grid_params',
        });
      }

      return await handleSeriesGridImage({
        supabase,
        payload,
        taskId: verification.taskId,
        variantIds,
        cols,
        rows,
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
