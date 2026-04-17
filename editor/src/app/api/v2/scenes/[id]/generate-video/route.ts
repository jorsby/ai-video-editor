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

    // Flatten structured_prompt jsonb into a plain string for the compiler.
    // Matches the shape produced in storyboard-panel.tsx and video-roadmap-panel.tsx.
    const scenePrompt = Array.isArray(scene.structured_prompt)
      ? (scene.structured_prompt as Record<string, unknown>[])
          .map((s) =>
            Object.values(s)
              .filter((v) => typeof v === 'string' && v.trim())
              .join(', ')
          )
          .join('\n')
      : null;

    if (!scenePrompt?.trim()) {
      return NextResponse.json(
        { error: 'Scene has no visual prompt.' },
        { status: 400 }
      );
    }

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

    // Duration logic (manual-first policy):
    // 1. body.duration provided → use it (normalize + clamp 6–30)
    // 2. Narrative scene with audio_duration → ceil to nearest int, clamp 6–30
    // 3. scene.video_duration from DB → normalize + clamp
    // 4. Fallback: 6
    let duration: number;
    if (body.duration != null) {
      duration = normalizeDuration(body.duration);
    } else if (
      isNarrative &&
      typeof scene.audio_duration === 'number' &&
      scene.audio_duration > 0
    ) {
      duration = normalizeDuration(Math.ceil(scene.audio_duration));
    } else {
      duration = normalizeDuration(scene.video_duration ?? MIN_DURATION);
    }

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
