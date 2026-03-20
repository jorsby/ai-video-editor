import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import { createLogger } from '@/lib/logger';
import {
  resolveForKling,
  type CharacterImage,
} from '@/lib/supabase/character-service';
import { resolveSeriesAssetsForProject } from '@/lib/supabase/series-asset-resolver';

const FAL_API_KEY = process.env.FAL_KEY!;
const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL!;

// ── Model configuration ───────────────────────────────────────────────

interface ModelConfig {
  endpoint: string;
  mode: 'image_to_video' | 'ref_to_video';
  validResolutions: string[];
  bucketDuration: (rawCeil: number) => number;
  buildPayload:
    | ((opts: {
        prompt: string;
        image_url: string;
        resolution: string;
        duration: number;
        aspect_ratio?: string;
        image_urls?: string[];
        elements?: Array<{
          frontal_image_url: string;
          reference_image_urls: string[];
        }>;
        multi_prompt?: string[];
        multi_shots?: boolean;
        video_urls?: string[];
        enable_audio?: boolean;
      }) => Record<string, unknown>)
    | null;
}

function splitMultiPromptDurations(
  prompts: string[],
  totalDuration: number
): { prompt: string; duration: string }[] {
  const count = prompts.length;
  const base = Math.floor(totalDuration / count);
  const remainder = totalDuration - base * count;

  return prompts.map((p, i) => {
    const shotDuration = Math.max(
      3,
      Math.min(15, base + (i < remainder ? 1 : 0))
    );
    return { prompt: p, duration: String(shotDuration) };
  });
}

const MODEL_CONFIG: Record<string, ModelConfig> = {
  klingo3: {
    endpoint: 'fal-ai/kling-video/o3/standard/reference-to-video',
    mode: 'ref_to_video',
    validResolutions: ['720p', '1080p'],
    bucketDuration: (raw) => Math.max(3, Math.min(15, raw)),
    buildPayload: ({
      prompt,
      elements,
      image_urls,
      duration,
      aspect_ratio,
      multi_prompt,
      enable_audio,
    }) => {
      const base: Record<string, unknown> = {
        elements: elements || [],
        image_urls: image_urls || [],
        aspect_ratio: aspect_ratio ?? '16:9',
        generate_audio: enable_audio ?? false,
      };
      if (multi_prompt && multi_prompt.length > 1) {
        base.multi_prompt = splitMultiPromptDurations(multi_prompt, duration);
      } else {
        base.prompt =
          multi_prompt && multi_prompt.length === 1 ? multi_prompt[0] : prompt;
        base.duration = String(duration);
      }
      return base;
    },
  },
};

const DEFAULT_MODEL = 'klingo3';
const ACTIVE_VIDEO_MODELS = ['klingo3'] as const;

type ModelKey = keyof typeof MODEL_CONFIG;

function isModelKey(value: string): value is ModelKey {
  return value in MODEL_CONFIG;
}

// ── Prompt resolution ─────────────────────────────────────────────────

function resolvePrompt(
  scenePrompt: string,
  _model: string,
  _objectCount: number
): string {
  return scenePrompt;
}

function resolveMultiPrompt(
  shots: string[],
  model: string,
  objectCount: number
): string[] {
  return shots.map((shot) => resolvePrompt(shot, model, objectCount));
}

async function logSceneGenerationAttempt(params: {
  db: ReturnType<typeof createServiceClient>;
  sceneId: string;
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
    sceneId,
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
      .eq('entity_type', 'scene')
      .eq('entity_id', sceneId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    await db.from('generation_logs').insert({
      entity_type: 'scene',
      entity_id: sceneId,
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
      scene_id: sceneId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Types ─────────────────────────────────────────────────────────────

interface GenerateVideoInput {
  scene_ids: string[];
  resolution: '480p' | '720p' | '1080p';
  model?: string;
  generation_path?: 'i2v';
  aspect_ratio?: string;
  fallback_duration?: number;
  storyboard_id?: string;
  enable_audio?: boolean;
  duration_overrides?: Record<string, number>;
}

interface VideoContext {
  scene_id: string;
  storyboard_id: string;
  final_url: string;
  visual_prompt: string;
  duration: number;
}

interface LibraryElement {
  frontal_image_url: string;
  reference_image_urls: string[];
}

interface RefVideoContext {
  scene_id: string;
  storyboard_id: string;
  prompt: string;
  prompt_for_log: string;
  multi_prompt?: string[];
  multi_shots?: boolean;
  object_urls: string[];
  background_url: string;
  duration: number;
  /** When set, these replace the naive single-image elements for Kling. */
  library_elements?: LibraryElement[];
}

// ── Helpers ───────────────────────────────────────────────────────────

async function getVideoContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sceneId: string,
  bucketDuration: (raw: number) => number,
  log: ReturnType<typeof createLogger>,
  fallbackDuration?: number
): Promise<VideoContext | null> {
  const { data: scene, error: sceneError } = await supabase
    .from('scenes')
    .select(
      `id, storyboard_id, video_status, first_frames (id, final_url, visual_prompt), voiceovers (duration)`
    )
    .eq('id', sceneId)
    .single();

  if (sceneError || !scene) {
    log.error('Failed to fetch scene', {
      scene_id: sceneId,
      error: sceneError?.message,
    });
    return null;
  }

  const firstFrame = (
    scene.first_frames as Array<{
      id: string;
      final_url: string | null;
      visual_prompt: string | null;
    }>
  )?.[0];
  if (!firstFrame) {
    log.error('No first_frame found for scene', { scene_id: sceneId });
    return null;
  }
  if (!firstFrame.final_url) {
    log.warn('No final_url for first_frame', { scene_id: sceneId });
    return null;
  }
  if (scene.video_status === 'processing') {
    log.warn('Video already processing, skipping', { scene_id: sceneId });
    return null;
  }

  const visualPrompt = firstFrame.visual_prompt?.trim();
  if (!visualPrompt) {
    log.warn('No visual prompt on first_frame', { scene_id: sceneId });
    return null;
  }

  const maxDuration = Math.max(
    0,
    ...((scene.voiceovers as Array<{ duration?: number }>) || []).map(
      (v) => v.duration ?? 0
    )
  );
  if (maxDuration === 0) {
    if (fallbackDuration && fallbackDuration > 0) {
      log.info('Using fallback duration', {
        scene_id: sceneId,
        fallback_duration: fallbackDuration,
      });
    } else {
      log.warn('No voiceover duration found', { scene_id: sceneId });
      return null;
    }
  }

  const raw = maxDuration > 0 ? Math.ceil(maxDuration) : fallbackDuration!;
  return {
    scene_id: sceneId,
    storyboard_id: scene.storyboard_id,
    final_url: firstFrame.final_url,
    visual_prompt: visualPrompt,
    duration: bucketDuration(raw),
  };
}

async function getRefVideoContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sceneId: string,
  model: string,
  bucketDuration: (raw: number) => number,
  log: ReturnType<typeof createLogger>,
  fallbackDuration?: number,
  durationOverride?: number
): Promise<RefVideoContext | null> {
  const { data: scene, error: sceneError } = await supabase
    .from('scenes')
    .select(
      `id, storyboard_id, prompt, multi_prompt, multi_shots, video_status, voiceovers (duration)`
    )
    .eq('id', sceneId)
    .single();

  if (sceneError || !scene) {
    log.error('Failed to fetch scene', {
      scene_id: sceneId,
      error: sceneError?.message,
    });
    return null;
  }
  const scenePrompt = scene.prompt?.trim() ?? '';
  const multiPromptValues = Array.isArray(scene.multi_prompt)
    ? (scene.multi_prompt as string[])
        .map((prompt) => prompt.trim())
        .filter((prompt) => prompt.length > 0)
    : [];

  if (!scenePrompt && multiPromptValues.length === 0) {
    log.error('No prompt on scene', { scene_id: sceneId });
    return null;
  }
  if (scene.video_status === 'processing') {
    log.warn('Video already processing, skipping', { scene_id: sceneId });
    return null;
  }

  const { data: objects } = await supabase
    .from('objects')
    .select('final_url, character_id, series_asset_variant_id')
    .eq('scene_id', sceneId)
    .order('scene_order', { ascending: true });

  // Resolve element images: prefer live series asset image, fallback to static final_url
  const resolvedObjects: Array<{ url: string; variantId: string | null }> = [];
  for (const obj of objects || []) {
    let url = obj.final_url;
    // Try live series asset image if variant linked
    if (obj.series_asset_variant_id) {
      const { data: liveImg } = await supabase
        .from('series_asset_variant_images')
        .select('url')
        .eq('variant_id', obj.series_asset_variant_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (liveImg?.url) url = liveImg.url;
    }
    if (url)
      resolvedObjects.push({ url, variantId: obj.series_asset_variant_id });
  }
  const objectUrls: string[] = resolvedObjects.map((o) => o.url);

  // Check for library characters (via project_characters)
  let libraryElements: LibraryElement[] | undefined;
  if (model === 'klingo3') {
    // Find the project via scene → storyboard → project chain
    const { data: sceneProject } = await supabase
      .from('scenes')
      .select('storyboards!inner(project_id)')
      .eq('id', sceneId)
      .single();

    const projectId = sceneProject?.storyboards?.project_id;
    if (projectId) {
      const { data: projectChars } = await supabase
        .from('project_characters')
        .select('element_index, character_id')
        .eq('project_id', projectId)
        .order('element_index', { ascending: true });

      if (projectChars && projectChars.length > 0) {
        // Fetch character images for each bound character
        const charIds = projectChars.map(
          (pc: { character_id: string }) => pc.character_id
        );
        const { data: charImages } = await supabase
          .from('character_images')
          .select('*')
          .in('character_id', charIds);

        if (charImages && charImages.length > 0) {
          const imagesByChar = new Map<string, CharacterImage[]>();
          for (const img of charImages as CharacterImage[]) {
            const existing = imagesByChar.get(img.character_id) || [];
            existing.push(img);
            imagesByChar.set(img.character_id, existing);
          }

          const resolved: LibraryElement[] = [];
          for (const pc of projectChars) {
            const images = imagesByChar.get(pc.character_id);
            if (images) {
              const payload = resolveForKling(images);
              if (payload) resolved.push(payload);
            }
          }

          if (resolved.length > 0) {
            libraryElements = resolved;
          }
        }
      }

      // Series asset fallback: if no project_characters found, try series assets
      if (!libraryElements && projectId) {
        try {
          const seriesAssetMap = await resolveSeriesAssetsForProject(
            supabase,
            projectId as string
          );

          if (seriesAssetMap && seriesAssetMap.characters.size > 0) {
            // Load series_assets (character type) with variants and images for this project's series
            const { data: seriesRow } = await supabase
              .from('series')
              .select('id')
              .eq('project_id', projectId)
              .maybeSingle();

            const seriesId = seriesRow?.id;

            if (seriesId) {
              const { data: seriesCharacterAssets } = await supabase
                .from('series_assets')
                .select(
                  'id, name, series_asset_variants (id, is_default, is_finalized, series_asset_variant_images (id, url, storage_path))'
                )
                .eq('series_id', seriesId)
                .eq('type', 'character')
                .order('sort_order', { ascending: true });

              if (seriesCharacterAssets && seriesCharacterAssets.length > 0) {
                const resolved: LibraryElement[] = [];

                for (const asset of seriesCharacterAssets) {
                  const variants: Array<{
                    is_finalized: boolean;
                    is_default: boolean;
                    series_asset_variant_images: Array<{
                      url: string | null;
                      storage_path: string | null;
                    }>;
                  }> = asset.series_asset_variants ?? [];

                  if (variants.length === 0) continue;

                  // Priority: finalized → default → first with image
                  const orderedVariants = [
                    ...variants.filter((v) => v.is_finalized),
                    ...variants.filter((v) => v.is_default && !v.is_finalized),
                    ...variants.filter((v) => !v.is_finalized && !v.is_default),
                  ];

                  let frontalUrl: string | null = null;
                  const referenceUrls: string[] = [];

                  for (const variant of orderedVariants) {
                    const images = variant.series_asset_variant_images ?? [];
                    for (const img of images) {
                      const url = img.url;
                      if (!url) continue;
                      if (!frontalUrl) {
                        frontalUrl = url;
                      } else if (referenceUrls.length < 3) {
                        referenceUrls.push(url);
                      }
                    }
                    if (frontalUrl && referenceUrls.length >= 3) break;
                  }

                  if (frontalUrl) {
                    resolved.push({
                      frontal_image_url: frontalUrl,
                      reference_image_urls:
                        referenceUrls.length > 0 ? referenceUrls : [frontalUrl],
                    });
                  }
                }

                if (resolved.length > 0) {
                  libraryElements = resolved;
                  log.info('Using series character assets as Kling elements', {
                    scene_id: sceneId,
                    series_id: seriesId,
                    element_count: resolved.length,
                  });
                }
              }
            }
          }
        } catch (seriesErr) {
          // Non-fatal: log and fall through to naive single-image elements
          log.warn('Series asset lookup for Kling failed (non-fatal)', {
            scene_id: sceneId,
            error:
              seriesErr instanceof Error
                ? seriesErr.message
                : String(seriesErr),
          });
        }
      }
    }
  }

  const { data: bg } = await supabase
    .from('backgrounds')
    .select('final_url')
    .eq('scene_id', sceneId)
    .limit(1)
    .single();
  if (!bg?.final_url) {
    log.error('No background found for scene', { scene_id: sceneId });
    return null;
  }

  const objectCount = objectUrls.length;
  if (objectCount > 4) {
    log.error('Kling O3 max 4 elements exceeded', { scene_id: sceneId });
    return null;
  }

  const maxDuration = Math.max(
    0,
    ...((scene.voiceovers as Array<{ duration?: number }>) || []).map(
      (v) => v.duration ?? 0
    )
  );

  const hasDurationOverride =
    typeof durationOverride === 'number' && durationOverride > 0;

  if (
    maxDuration === 0 &&
    !hasDurationOverride &&
    (!fallbackDuration || fallbackDuration <= 0)
  ) {
    log.warn('No voiceover duration found', { scene_id: sceneId });
    return null;
  }

  let raw: number;

  if (hasDurationOverride) {
    raw = durationOverride;
  } else {
    raw = maxDuration > 0 ? Math.ceil(maxDuration) : fallbackDuration!;
  }

  const durationInt = bucketDuration(raw);

  let multiPromptShots: string[] | undefined;
  if (multiPromptValues.length > 0) {
    multiPromptShots = multiPromptValues;
  } else if (scenePrompt.startsWith('[')) {
    try {
      const parsed = JSON.parse(scenePrompt);
      if (
        Array.isArray(parsed) &&
        parsed.every((s: unknown) => typeof s === 'string')
      ) {
        multiPromptShots = parsed
          .map((shot) => shot.trim())
          .filter((shot) => shot.length > 0);
      }
    } catch {
      /* not JSON */
    }
  }

  if (multiPromptShots && multiPromptShots.length > 0) {
    const resolvedShots = resolveMultiPrompt(
      multiPromptShots,
      model,
      objectCount
    );
    return {
      scene_id: sceneId,
      storyboard_id: scene.storyboard_id,
      prompt: '',
      prompt_for_log: resolvedShots[0] ?? scenePrompt,
      multi_prompt: resolvedShots,
      multi_shots: scene.multi_shots ?? undefined,
      object_urls: objectUrls,
      background_url: bg.final_url,
      duration: durationInt,
      library_elements: libraryElements,
    };
  }

  return {
    scene_id: sceneId,
    storyboard_id: scene.storyboard_id,
    prompt: resolvePrompt(scenePrompt, model, objectCount),
    prompt_for_log: scenePrompt,
    multi_shots: scene.multi_shots ?? undefined,
    object_urls: objectUrls,
    background_url: bg.final_url,
    duration: durationInt,
    library_elements: libraryElements,
  };
}

async function sendRefVideoRequest(
  context: RefVideoContext,
  resolution: string,
  model: string,
  modelConfig: ModelConfig,
  aspect_ratio: string | undefined,
  enableAudio: boolean,
  log: ReturnType<typeof createLogger>
): Promise<{ requestId: string | null; error: string | null }> {
  const webhookParams = new URLSearchParams({
    step: 'GenerateVideo',
    scene_id: context.scene_id,
  });
  const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/fal?${webhookParams.toString()}`;

  const falUrl = new URL(`https://queue.fal.run/${modelConfig.endpoint}`);
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  log.api('fal.ai', modelConfig.endpoint, {
    scene_id: context.scene_id,
    model,
    resolution,
    duration: context.duration,
    aspect_ratio,
    enable_audio: enableAudio,
  });
  log.startTiming('fal_video_request');

  try {
    // Use per-scene object URLs — each scene already has the correct elements
    // linked via series_asset_variant_id. Don't use library_elements which
    // sends ALL series characters regardless of which scene needs them.
    const elements = context.object_urls.map((url) => ({
      frontal_image_url: url,
      reference_image_urls: [url],
    }));
    const payload = modelConfig.buildPayload!({
      prompt: context.prompt,
      image_url: '',
      resolution,
      elements,
      image_urls: [context.background_url],
      duration: context.duration,
      aspect_ratio,
      multi_prompt: context.multi_prompt,
      multi_shots: context.multi_shots,
      enable_audio: enableAudio,
    });

    const isKlingRef = model === 'klingo3';
    const falResponse = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...payload,
        // web_search is WAN-specific; Kling API doesn't support it
        ...(!isKlingRef ? { web_search: true } : {}),
      }),
    });
    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      log.error('fal.ai ref video request failed', {
        status: falResponse.status,
        error: errorText,
        time_ms: log.endTiming('fal_video_request'),
      });
      return {
        requestId: null,
        error: `fal.ai request failed: ${falResponse.status}`,
      };
    }
    const falResult = await falResponse.json();
    log.success('fal.ai ref video request accepted', {
      request_id: falResult.request_id,
      time_ms: log.endTiming('fal_video_request'),
    });
    return { requestId: falResult.request_id, error: null };
  } catch (err) {
    log.error('fal.ai ref video request exception', {
      error: err instanceof Error ? err.message : String(err),
      time_ms: log.endTiming('fal_video_request'),
    });
    return { requestId: null, error: 'Request exception' };
  }
}

async function sendVideoRequest(
  context: VideoContext,
  resolution: string,
  modelConfig: ModelConfig,
  aspect_ratio: string | undefined,
  log: ReturnType<typeof createLogger>
): Promise<{ requestId: string | null; error: string | null }> {
  const webhookParams = new URLSearchParams({
    step: 'GenerateVideo',
    scene_id: context.scene_id,
  });
  const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/fal?${webhookParams.toString()}`;

  const falUrl = new URL(`https://queue.fal.run/${modelConfig.endpoint}`);
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  log.api('fal.ai', modelConfig.endpoint, {
    scene_id: context.scene_id,
    resolution,
    duration: context.duration,
  });
  log.startTiming('fal_video_request');

  try {
    const payload = modelConfig.buildPayload!({
      prompt: context.visual_prompt,
      image_url: context.final_url,
      resolution,
      duration: context.duration,
      aspect_ratio,
    });
    const falResponse = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, web_search: true }),
    });
    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      log.error('fal.ai video request failed', {
        status: falResponse.status,
        error: errorText,
        time_ms: log.endTiming('fal_video_request'),
      });
      return {
        requestId: null,
        error: `fal.ai request failed: ${falResponse.status}`,
      };
    }
    const falResult = await falResponse.json();
    log.success('fal.ai video request accepted', {
      request_id: falResult.request_id,
      time_ms: log.endTiming('fal_video_request'),
    });
    return { requestId: falResult.request_id, error: null };
  } catch (err) {
    log.error('fal.ai video request exception', {
      error: err instanceof Error ? err.message : String(err),
      time_ms: log.endTiming('fal_video_request'),
    });
    return { requestId: null, error: 'Request exception' };
  }
}

async function queueDirectRefVideo(
  supabase: ReturnType<typeof createServiceClient>,
  sceneId: string,
  resolution: string,
  model: ModelKey,
  modelConfig: ModelConfig,
  aspect_ratio: string | undefined,
  enableAudio: boolean,
  durationOverride: number | undefined,
  log: ReturnType<typeof createLogger>,
  fallback_duration: number | undefined
): Promise<{
  scene_id: string;
  request_id: string | null;
  status: 'queued' | 'skipped' | 'failed';
  error?: string;
}> {
  const refContext = await getRefVideoContext(
    supabase,
    sceneId,
    model,
    modelConfig.bucketDuration,
    log,
    fallback_duration,
    durationOverride
  );

  if (!refContext) {
    return {
      scene_id: sceneId,
      request_id: null,
      status: 'skipped',
      error: 'Prerequisites not met',
    };
  }

  await supabase
    .from('scenes')
    .update({
      video_status: 'processing',
      video_resolution: resolution,
      video_model: model,
    })
    .eq('id', refContext.scene_id);

  const { requestId, error } = await sendRefVideoRequest(
    refContext,
    resolution,
    model,
    modelConfig,
    aspect_ratio,
    enableAudio,
    log
  );

  if (error || !requestId) {
    await supabase
      .from('scenes')
      .update({
        video_status: 'failed',
        video_error_message: 'request_error',
      })
      .eq('id', refContext.scene_id);

    await logSceneGenerationAttempt({
      db: supabase,
      sceneId: refContext.scene_id,
      storyboardId: refContext.storyboard_id,
      prompt: refContext.prompt_for_log,
      status: 'failed',
      feedback: error || 'Unknown error',
      log,
    });

    return {
      scene_id: sceneId,
      request_id: null,
      status: 'failed',
      error: error || 'Unknown error',
    };
  }

  await supabase
    .from('scenes')
    .update({ video_request_id: requestId })
    .eq('id', refContext.scene_id);

  await logSceneGenerationAttempt({
    db: supabase,
    sceneId: refContext.scene_id,
    storyboardId: refContext.storyboard_id,
    prompt: refContext.prompt_for_log,
    generationMeta: {
      model: modelConfig.endpoint,
      resolution,
      aspect_ratio,
      duration_seconds: refContext.duration,
      generated_at: new Date().toISOString(),
      generated_by: 'system',
      audio: enableAudio,
      mode: 'ref_to_video',
    },
    status: 'pending',
    log,
  });

  return {
    scene_id: sceneId,
    request_id: requestId,
    status: 'queued',
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const log = createLogger();
  log.setContext({ step: 'GenerateVideo' });

  try {
    const authClient = await createClient();
    const {
      data: { user: sessionUser },
    } = await authClient.auth.getUser();

    const apiKeyResult = !sessionUser ? validateApiKey(req) : { valid: false };
    const user =
      sessionUser ??
      (apiKeyResult.valid && apiKeyResult.userId
        ? { id: apiKeyResult.userId }
        : null);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    log.info('Request received');
    const input: GenerateVideoInput = await req.json();
    const {
      scene_ids,
      resolution = '720p',
      model = DEFAULT_MODEL,
      generation_path,
      aspect_ratio,
      fallback_duration,
      storyboard_id,
      enable_audio = true,
      duration_overrides,
    } = input;

    if (!scene_ids || !Array.isArray(scene_ids) || scene_ids.length === 0) {
      return NextResponse.json(
        { success: false, error: 'scene_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    if (generation_path && generation_path !== 'i2v') {
      return NextResponse.json(
        {
          success: false,
          error: 'generation_path only supports i2v override',
        },
        { status: 400 }
      );
    }

    const modelConfig = MODEL_CONFIG[model];
    if (!modelConfig) {
      return NextResponse.json(
        {
          success: false,
          error: `model must be one of: ${Object.keys(MODEL_CONFIG).join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (
      !ACTIVE_VIDEO_MODELS.includes(
        model as (typeof ACTIVE_VIDEO_MODELS)[number]
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `Model "${model}" is disabled. Active model: klingo3`,
        },
        { status: 400 }
      );
    }

    if (typeof enable_audio !== 'boolean') {
      return NextResponse.json(
        {
          success: false,
          error: 'enable_audio must be a boolean',
        },
        { status: 400 }
      );
    }

    if (
      duration_overrides !== undefined &&
      (typeof duration_overrides !== 'object' || duration_overrides === null)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'duration_overrides must be an object when provided',
        },
        { status: 400 }
      );
    }

    if (
      duration_overrides &&
      Object.entries(duration_overrides).some(
        ([sceneId, seconds]) =>
          typeof sceneId !== 'string' ||
          !sceneId ||
          (seconds !== 5 && seconds !== 10)
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'duration_overrides values must be 5 or 10 seconds',
        },
        { status: 400 }
      );
    }

    const usesResolution = model !== 'klingo3';
    if (usesResolution && !modelConfig.validResolutions.includes(resolution)) {
      return NextResponse.json(
        {
          success: false,
          error: `resolution must be one of: ${modelConfig.validResolutions.join(', ')} for model ${model}`,
        },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    let storyboardMode: string | null = null;
    let storyboardModel: string | null = null;
    let storyboardVideoMode: 'narrative' | 'dialogue_scene' | null = null;

    if (storyboard_id) {
      const { data: sb } = await supabase
        .from('storyboards')
        .select('mode, model, plan')
        .eq('id', storyboard_id)
        .single();

      storyboardMode = sb?.mode ?? null;
      storyboardModel = sb?.model ?? null;
      if (
        sb?.plan &&
        typeof sb.plan === 'object' &&
        'video_mode' in sb.plan &&
        (sb.plan.video_mode === 'narrative' ||
          sb.plan.video_mode === 'dialogue_scene')
      ) {
        storyboardVideoMode = sb.plan.video_mode;
      }
    }

    const isStoryboardRefMode = storyboardMode === 'ref_to_video';
    const forceI2v = generation_path === 'i2v';

    if (forceI2v && modelConfig.mode !== 'image_to_video') {
      return NextResponse.json(
        {
          success: false,
          error: 'i2v override requires an image_to_video model',
        },
        { status: 400 }
      );
    }

    const directStoryboardRefModel: ModelKey | null =
      storyboardModel &&
      isModelKey(storyboardModel) &&
      MODEL_CONFIG[storyboardModel].mode === 'ref_to_video'
        ? storyboardModel
        : null;

    const requestedRefModel: ModelKey | null =
      isModelKey(model) && MODEL_CONFIG[model].mode === 'ref_to_video'
        ? model
        : null;

    const isRefMode = isStoryboardRefMode
      ? !forceI2v
      : modelConfig.mode === 'ref_to_video';

    const effectiveDirectRefModel: ModelKey | null = isRefMode
      ? isStoryboardRefMode
        ? directStoryboardRefModel
        : requestedRefModel
      : null;

    const isNarrativeMode = storyboardVideoMode === 'narrative';
    const effectiveEnableAudio =
      isNarrativeMode && effectiveDirectRefModel === 'klingo3'
        ? false
        : enable_audio;

    if (isRefMode && !effectiveDirectRefModel) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Direct ref_to_video path requires an active ref model (klingo3)',
        },
        { status: 400 }
      );
    }

    log.info('Processing video requests', {
      scene_count: scene_ids.length,
      resolution,
      model,
      mode: isRefMode
        ? 'ref_to_video'
        : forceI2v
          ? 'i2v_override'
          : 'image_to_video',
      enable_audio: effectiveEnableAudio,
      storyboard_video_mode: storyboardVideoMode,
    });

    const results: Array<{
      scene_id: string;
      request_id: string | null;
      status: 'queued' | 'skipped' | 'failed';
      error?: string;
    }> = [];

    for (let i = 0; i < scene_ids.length; i++) {
      const sceneId = scene_ids[i];
      if (i > 0) {
        log.info('Waiting before next request', { delay_ms: 1000, index: i });
        await delay(1000);
      }

      if (forceI2v) {
        const i2vContext = await getVideoContext(
          supabase,
          sceneId,
          modelConfig.bucketDuration,
          log,
          fallback_duration
        );

        if (!i2vContext) {
          results.push({
            scene_id: sceneId,
            request_id: null,
            status: 'skipped',
            error: 'Prerequisites not met (missing first frame)',
          });
          continue;
        }

        await supabase
          .from('scenes')
          .update({
            video_status: 'processing',
            video_resolution: resolution,
            video_model: model,
          })
          .eq('id', i2vContext.scene_id);

        const { requestId, error } = await sendVideoRequest(
          i2vContext,
          resolution,
          modelConfig,
          aspect_ratio,
          log
        );

        if (error || !requestId) {
          await supabase
            .from('scenes')
            .update({
              video_status: 'failed',
              video_error_message: 'request_error',
            })
            .eq('id', i2vContext.scene_id);

          await logSceneGenerationAttempt({
            db: supabase,
            sceneId: i2vContext.scene_id,
            storyboardId: i2vContext.storyboard_id,
            prompt: i2vContext.visual_prompt,
            status: 'failed',
            feedback: error || 'Unknown error',
            log,
          });

          results.push({
            scene_id: sceneId,
            request_id: null,
            status: 'failed',
            error: error || 'Unknown error',
          });
          continue;
        }

        await supabase
          .from('scenes')
          .update({ video_request_id: requestId })
          .eq('id', i2vContext.scene_id);

        await logSceneGenerationAttempt({
          db: supabase,
          sceneId: i2vContext.scene_id,
          storyboardId: i2vContext.storyboard_id,
          prompt: i2vContext.visual_prompt,
          generationMeta: {
            model: modelConfig.endpoint,
            resolution,
            aspect_ratio,
            duration_seconds: i2vContext.duration,
            generated_at: new Date().toISOString(),
            generated_by: 'system',
            mode: 'image_to_video',
          },
          status: 'pending',
          log,
        });

        results.push({
          scene_id: sceneId,
          request_id: requestId,
          status: 'queued',
        });

        continue;
      }

      if (isRefMode && effectiveDirectRefModel) {
        const durationOverrideForScene = duration_overrides?.[sceneId];

        const directResult = await queueDirectRefVideo(
          supabase,
          sceneId,
          resolution,
          effectiveDirectRefModel,
          MODEL_CONFIG[effectiveDirectRefModel],
          aspect_ratio,
          effectiveEnableAudio,
          durationOverrideForScene,
          log,
          fallback_duration
        );
        results.push(directResult);
        continue;
      }

      const context = await getVideoContext(
        supabase,
        sceneId,
        modelConfig.bucketDuration,
        log,
        fallback_duration
      );
      if (!context) {
        results.push({
          scene_id: sceneId,
          request_id: null,
          status: 'skipped',
          error: 'Prerequisites not met',
        });
        continue;
      }

      await supabase
        .from('scenes')
        .update({
          video_status: 'processing',
          video_resolution: resolution,
          video_model: model,
        })
        .eq('id', context.scene_id);
      const { requestId, error } = await sendVideoRequest(
        context,
        resolution,
        modelConfig,
        aspect_ratio,
        log
      );
      if (error || !requestId) {
        await supabase
          .from('scenes')
          .update({
            video_status: 'failed',
            video_error_message: 'request_error',
          })
          .eq('id', context.scene_id);

        await logSceneGenerationAttempt({
          db: supabase,
          sceneId: context.scene_id,
          storyboardId: context.storyboard_id,
          prompt: context.visual_prompt,
          status: 'failed',
          feedback: error || 'Unknown error',
          log,
        });

        results.push({
          scene_id: sceneId,
          request_id: null,
          status: 'failed',
          error: error || 'Unknown error',
        });
        continue;
      }
      await supabase
        .from('scenes')
        .update({ video_request_id: requestId })
        .eq('id', context.scene_id);

      await logSceneGenerationAttempt({
        db: supabase,
        sceneId: context.scene_id,
        storyboardId: context.storyboard_id,
        prompt: context.visual_prompt,
        generationMeta: {
          model: modelConfig.endpoint,
          resolution,
          aspect_ratio,
          duration_seconds: context.duration,
          generated_at: new Date().toISOString(),
          generated_by: 'system',
          mode: 'image_to_video',
        },
        status: 'pending',
        log,
      });

      results.push({
        scene_id: sceneId,
        request_id: requestId,
        status: 'queued',
      });
    }

    const queuedCount = results.filter((r) => r.status === 'queued').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;

    log.summary('success', {
      total: scene_ids.length,
      queued: queuedCount,
      skipped: skippedCount,
      failed: failedCount,
    });

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: scene_ids.length,
        queued: queuedCount,
        skipped: skippedCount,
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
