import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createTask } from '@/lib/kieai';
import { submitFalVideoJob, FAL_MAX_DURATION } from '@/lib/fal-provider';
import { compileForGrok } from '@/lib/storyboard/prompt-compiler';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';
import {
  getProjectVideoSettings,
  listVariantsBySlugs,
} from '@/lib/api/variant-table-resolver';

type RouteContext = { params: Promise<{ id: string }> };

const DEFAULT_VIDEO_MODEL = 'grok-imagine/image-to-video';

const MIN_DURATION = 6;
const MAX_DURATION = 30;

function readShotTiming(
  shot: Record<string, unknown>
): { from: number; to: number } | null {
  const from = shot.duration_from;
  const to = shot.duration_to;
  if (
    typeof from !== 'number' ||
    typeof to !== 'number' ||
    !Number.isFinite(from) ||
    !Number.isFinite(to)
  ) {
    return null;
  }
  return { from, to };
}

function formatTimingPrefix(t: { from: number; to: number }): string {
  const fmt = (n: number) =>
    Number.isInteger(n) ? `${n}s` : `${n.toFixed(1)}s`;
  return `${fmt(t.from)}-${fmt(t.to)}`;
}

/**
 * Compose the scene video prompt from typed shot fields (one line per shot).
 *
 * When every shot has valid `duration_from`/`duration_to`, each line is
 * prefixed with "Xs-Ys: " and `totalDuration = max(duration_to)`.
 * Otherwise the untimed path is used and `totalDuration` is null.
 *
 * Falls back to flattening legacy free-form shot objects for rows written
 * before the typed shape landed.
 */
function composeSceneVideoPrompt(
  input: unknown
): { prompt: string; totalDuration: number | null } | null {
  if (!Array.isArray(input)) return null;

  // Detect if every shot has timing — validator guarantees all-or-none
  // contiguous ranges, but guard against bad rows.
  const timings: Array<{ from: number; to: number } | null> = input.map(
    (raw) =>
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? readShotTiming(raw as Record<string, unknown>)
        : null
  );
  const allTimed =
    input.length > 0 &&
    timings.every((t): t is { from: number; to: number } => t !== null);

  const lines: string[] = [];
  input.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const shot = raw as Record<string, unknown>;
    const typedParts: string[] = [];
    const shotType =
      typeof shot.shot_type === 'string' ? shot.shot_type.trim() : '';
    const cameraMovement =
      typeof shot.camera_movement === 'string'
        ? shot.camera_movement.trim()
        : '';
    const action = typeof shot.action === 'string' ? shot.action.trim() : '';
    const lighting =
      typeof shot.lighting === 'string' ? shot.lighting.trim() : '';
    const mood = typeof shot.mood === 'string' ? shot.mood.trim() : '';
    const settingNotes =
      typeof shot.setting_notes === 'string' ? shot.setting_notes.trim() : '';

    if (shotType || cameraMovement) {
      typedParts.push([shotType, cameraMovement].filter(Boolean).join(', '));
    }
    if (action) typedParts.push(action);
    if (lighting) typedParts.push(lighting);
    if (mood) typedParts.push(mood);
    if (settingNotes) typedParts.push(settingNotes);

    let line: string;
    if (typedParts.length > 0) {
      line = typedParts.join('. ');
    } else {
      // Legacy row: join any string values as the shot line.
      const legacy = Object.values(shot)
        .filter(
          (v): v is string => typeof v === 'string' && v.trim().length > 0
        )
        .map((v) => v.trim())
        .join(', ');
      if (!legacy) return;
      line = legacy;
    }

    if (allTimed) {
      const t = timings[i]!;
      lines.push(`${formatTimingPrefix(t)}: ${line}`);
    } else {
      lines.push(line);
    }
  });

  if (lines.length === 0) return null;

  const totalDuration = allTimed
    ? timings.reduce((max, t) => (t && t.to > max ? t.to : max), 0 as number)
    : null;

  return { prompt: lines.join('\n'), totalDuration };
}

/** Normalize string/number input and clamp to 6–30 range. */
function normalizeDuration(
  raw: unknown,
  fallback: number = MIN_DURATION
): number {
  const n =
    typeof raw === 'string'
      ? Number.parseInt(raw, 10)
      : typeof raw === 'number'
        ? raw
        : Number.NaN;
  if (Number.isNaN(n) || n < MIN_DURATION)
    return fallback < MIN_DURATION
      ? MIN_DURATION
      : Math.min(fallback, MAX_DURATION);
  return Math.min(Math.max(Math.round(n), MIN_DURATION), MAX_DURATION);
}

/**
 * POST /api/v2/scenes/{id}/generate-video
 *
 * Generates video for a scene using Grok Imagine ref-to-video via kie.ai.
 * 480p or 720p, 9:16 aspect ratio, 6–30 seconds.
 *
 * The endpoint compiles @variant-slug → @imageN refs and builds image_urls[]
 * from variant images in DB.
 *
 * Body (optional):
 *   duration?: 6–30              — Video duration in seconds (default 6, clamped)
 *   resolution?: "480p"|"720p"   — Video resolution (default "480p")
 *   provider?: "kie"|"fal"       — Video generation provider (default "kie")
 *   prompt_override?: string      — Custom prompt (bypasses compileForGrok)
 *   image_urls_override?: string[] — Custom image URLs (bypasses DB lookup)
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: sceneId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    // ── Fetch scene ─────────────────────────────────────────────────────

    const { data: scene, error: sceneError } = await supabase
      .from('scenes')
      .select(
        'id, chapter_id, structured_prompt, video_duration, audio_text, audio_url, audio_duration, location_variant_slug, character_variant_slugs, prop_variant_slugs, status'
      )
      .eq('id', sceneId)
      .maybeSingle();

    if (sceneError || !scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    // Compose structured_prompt (array of typed shot objects) into one string
    // for the video compiler. When every shot has duration_from/duration_to,
    // lines are prefixed "Xs-Ys:" and scene duration derives from the shots.
    // Untimed rows fall back to plain joined lines.
    const composed = composeSceneVideoPrompt(scene.structured_prompt);

    if (!composed || !composed.prompt.trim()) {
      return NextResponse.json(
        { error: 'Scene has no visual prompt.' },
        { status: 400 }
      );
    }
    const scenePrompt = composed.prompt;
    const shotTotalDuration = composed.totalDuration;

    // ── Narrative guard: require TTS before video ───────────────────────

    const isNarrative = !!scene.audio_text?.trim();
    if (isNarrative && !scene.audio_url) {
      return NextResponse.json(
        {
          error:
            'Narrative scene requires voice-over first. Generate TTS before video.',
          code: 'TTS_REQUIRED',
        },
        { status: 400 }
      );
    }

    // ── Fetch chapter + video ──────────────────────────────────────────

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
      .select('id, project_id')
      .eq('id', chapter.video_id)
      .maybeSingle();

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', video.project_id)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Video generation settings moved from videos → projects.generation_settings
    const settings = await getProjectVideoSettings(
      supabase,
      video.project_id as string
    );
    const settingsVideoModel = settings.videoModel;
    const settingsVideoResolution = settings.videoResolution.toLowerCase();
    const settingsAspectRatio = settings.aspectRatio;

    // ── Parse body ──────────────────────────────────────────────────────

    const body = await req.json().catch(() => ({}));

    // Duration priority (shots-win policy):
    // 1. Timed shots present  → max(duration_to) (authoritative)
    // 2. body.duration        → explicit caller override
    // 3. Narrative audio      → ceil(audio_duration)
    // 4. scene.video_duration → persisted scene length
    // 5. MIN_DURATION (6)
    // All paths normalize + clamp 6–30.
    type DurationSource = 'shots' | 'body' | 'audio' | 'video' | 'default';
    let duration: number;
    let durationSource: DurationSource;
    let rawDuration: number;

    if (shotTotalDuration != null && shotTotalDuration > 0) {
      rawDuration = Math.ceil(shotTotalDuration);
      duration = normalizeDuration(rawDuration);
      durationSource = 'shots';

      if (
        isNarrative &&
        typeof scene.audio_duration === 'number' &&
        scene.audio_duration > shotTotalDuration + 0.05
      ) {
        return NextResponse.json(
          {
            error: 'Shot timing total is shorter than voiceover.',
            code: 'SHOT_DURATION_TOO_SHORT',
            audio_duration: scene.audio_duration,
            shots_total: shotTotalDuration,
            hint: "Extend the last shot's duration_to so the scene covers the voiceover.",
          },
          { status: 400 }
        );
      }
    } else if (body.duration != null) {
      rawDuration =
        typeof body.duration === 'number'
          ? body.duration
          : Number.parseInt(String(body.duration), 10);
      duration = normalizeDuration(body.duration);
      durationSource = 'body';
    } else if (
      isNarrative &&
      typeof scene.audio_duration === 'number' &&
      scene.audio_duration > 0
    ) {
      rawDuration = Math.ceil(scene.audio_duration);
      duration = normalizeDuration(rawDuration);
      durationSource = 'audio';
    } else if (
      typeof scene.video_duration === 'number' &&
      scene.video_duration > 0
    ) {
      rawDuration = scene.video_duration;
      duration = normalizeDuration(scene.video_duration);
      durationSource = 'video';
    } else {
      rawDuration = MIN_DURATION;
      duration = MIN_DURATION;
      durationSource = 'default';
    }

    const durationClamped =
      Number.isFinite(rawDuration) && rawDuration !== duration;

    // Resolution: body override → video settings → default 480p
    // Provider: kie (default) or fal
    const VALID_PROVIDERS = new Set(['kie', 'fal']);
    const provider =
      typeof body.provider === 'string' &&
      VALID_PROVIDERS.has(body.provider.toLowerCase())
        ? body.provider.toLowerCase()
        : 'kie';

    // Resolution: accept 480p or 720p, default from video settings
    const VALID_RESOLUTIONS = new Set(['480p', '720p']);
    const requestedRes =
      typeof body.resolution === 'string'
        ? body.resolution.trim().toLowerCase()
        : '';
    const resolution = VALID_RESOLUTIONS.has(requestedRes)
      ? requestedRes
      : VALID_RESOLUTIONS.has(settingsVideoResolution)
        ? settingsVideoResolution
        : '480p';

    let compiledPrompt: string;
    let imageUrls: string[];

    if (body.prompt_override && body.image_urls_override) {
      // Manual override — skip compilation
      compiledPrompt = body.prompt_override;
      imageUrls = body.image_urls_override;
    } else {
      // Resolve variant slugs → image URLs from typed variant tables.
      const locationSlug = scene.location_variant_slug;
      const characterSlugs = scene.character_variant_slugs ?? [];
      const propSlugs = scene.prop_variant_slugs ?? [];

      const allSlugs = [locationSlug, ...characterSlugs, ...propSlugs].filter(
        (s): s is string => typeof s === 'string' && s.length > 0
      );

      const variantMap = await listVariantsBySlugs(
        supabase,
        video.project_id as string,
        { locationSlug, characterSlugs, propSlugs }
      );
      const slugToImageUrl = new Map<string, string>();
      for (const [slug, v] of variantMap) {
        if (v.image_url) slugToImageUrl.set(slug, v.image_url);
      }

      // Check all refs have images
      const missingSlugs = allSlugs.filter((s) => !slugToImageUrl.has(s));
      if (missingSlugs.length > 0) {
        return NextResponse.json(
          {
            error: 'Some asset variants have no generated image yet.',
            missing_slugs: missingSlugs,
            hint: 'Generate variant images first via POST /api/v2/variants/{id}/generate-image',
          },
          { status: 400 }
        );
      }

      // ── Compile prompt ────────────────────────────────────────────────

      const compiled = compileForGrok({
        prompt: scenePrompt,
        locationVariantSlug: scene.location_variant_slug,
        characterVariantSlugs: scene.character_variant_slugs ?? [],
        propVariantSlugs: scene.prop_variant_slugs ?? [],
        slugToImageUrl,
      });

      compiledPrompt = compiled.prompt;
      imageUrls = compiled.imageUrls;
    }

    // ── Build webhook URL ───────────────────────────────────────────────

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    const videoModel =
      settingsVideoModel.length > 0 ? settingsVideoModel : DEFAULT_VIDEO_MODEL;
    const aspectRatio =
      settingsAspectRatio.length > 0 ? settingsAspectRatio : '9:16';

    let taskId: string;

    if (provider === 'fal') {
      // ── Submit to fal.ai ────────────────────────────────────────────
      const falWebhookUrl = new URL(`${webhookBase}/api/webhook/fal`);
      falWebhookUrl.searchParams.set('step', 'GenerateSceneVideo');
      falWebhookUrl.searchParams.set('scene_id', sceneId);

      // fal.ai Grok Imagine max 10s — clamp handled inside provider
      const falResult = await submitFalVideoJob({
        prompt: compiledPrompt,
        imageUrls,
        duration,
        aspectRatio,
        resolution,
        webhookUrl: falWebhookUrl.toString(),
      });
      taskId = falResult.requestId;
    } else {
      // ── Submit to kie.ai (default) ──────────────────────────────────
      const kieWebhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
      kieWebhookUrl.searchParams.set('step', 'GenerateSceneVideo');
      kieWebhookUrl.searchParams.set('scene_id', sceneId);

      const kieResult = await createTask({
        model: videoModel,
        callbackUrl: kieWebhookUrl.toString(),
        input: {
          prompt: compiledPrompt,
          image_urls: imageUrls,
          duration,
          aspect_ratio: aspectRatio,
          resolution,
        },
      });
      taskId = kieResult.taskId;
    }

    // ── Mark video as generating ───────────────────────────────────────

    await supabase
      .from('scenes')
      .update({
        video_status: 'generating',
        video_task_id: taskId,
        video_url: null,
        video_duration: null,
        video_transcription: null,
        has_speech: null,
      })
      .eq('id', sceneId);

    return NextResponse.json({
      task_id: taskId,
      provider,
      model: videoModel,
      scene_id: sceneId,
      duration:
        provider === 'fal' ? Math.min(duration, FAL_MAX_DURATION) : duration,
      duration_source: durationSource,
      duration_clamped: durationClamped,
      aspect_ratio: aspectRatio,
      resolution,
      image_count: imageUrls.length,
    });
  } catch (error) {
    console.error('[v2/scenes/:id/generate-video] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
