import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createTask } from '@/lib/kieai';
import { compileForGrok } from '@/lib/storyboard/prompt-compiler';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const DEFAULT_VIDEO_MODEL = 'grok-imagine/image-to-video';
const VALID_DURATIONS = new Set([6, 10]);

/**
 * POST /api/v2/scenes/{id}/generate-video
 *
 * Generates video for a scene using Grok Imagine ref-to-video via kie.ai.
 * Always 480p, 9:16 aspect ratio, 6 or 10 seconds.
 *
 * The endpoint compiles @variant-slug → @imageN refs and builds image_urls[]
 * from variant images in DB.
 *
 * Body (optional):
 *   duration?: 6 | 10            — Video duration in seconds (default 6)
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
        'id, episode_id, prompt, video_duration, audio_text, audio_url, audio_duration, location_variant_slug, character_variant_slugs, prop_variant_slugs, status'
      )
      .eq('id', sceneId)
      .maybeSingle();

    if (sceneError || !scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    if (!scene.prompt?.trim()) {
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

    // ── Fetch episode + series ──────────────────────────────────────────

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
      .select('id, project_id, video_model, aspect_ratio')
      .eq('id', episode.series_id)
      .maybeSingle();

    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', series.project_id)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (!series.video_model) {
      return NextResponse.json(
        {
          error:
            'Series has no video_model configured. Set it in series settings first.',
        },
        { status: 400 }
      );
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Parse body ──────────────────────────────────────────────────────

    const body = await req.json().catch(() => ({}));

    // Duration logic:
    // Narrative scenes: derive from audio_duration (≤6→6, ≤10→10, >10→10)
    // Non-narrative: body override > video_duration > default 6
    let duration: number;
    if (
      isNarrative &&
      typeof scene.audio_duration === 'number' &&
      scene.audio_duration > 0
    ) {
      duration = scene.audio_duration <= 6 ? 6 : 10;
    } else {
      const rawDuration = body.duration ?? scene.video_duration ?? 6;
      duration = VALID_DURATIONS.has(rawDuration) ? rawDuration : 6;
    }

    let compiledPrompt: string;
    let imageUrls: string[];

    if (body.prompt_override && body.image_urls_override) {
      // Manual override — skip compilation
      compiledPrompt = body.prompt_override;
      imageUrls = body.image_urls_override;
    } else {
      // ── Resolve variant slugs → image URLs from DB ────────────────────

      const allSlugs = [
        scene.location_variant_slug,
        ...(scene.character_variant_slugs ?? []),
        ...(scene.prop_variant_slugs ?? []),
      ].filter(Boolean) as string[];

      const slugToImageUrl = new Map<string, string>();

      if (allSlugs.length > 0) {
        const { data: variants } = await supabase
          .from('project_asset_variants')
          .select('slug, image_url')
          .in('slug', allSlugs);

        for (const v of variants ?? []) {
          if (v.image_url) {
            slugToImageUrl.set(v.slug, v.image_url);
          }
        }
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
        prompt: scene.prompt,
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

    const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
    webhookUrl.searchParams.set('step', 'GenerateSceneVideo');
    webhookUrl.searchParams.set('scene_id', sceneId);

    // ── Submit to kie.ai ────────────────────────────────────────────────

    const videoModel = series.video_model;
    const aspectRatio = series.aspect_ratio ?? '9:16';

    const result = await createTask({
      model: videoModel,
      callbackUrl: webhookUrl.toString(),
      input: {
        prompt: compiledPrompt,
        image_urls: imageUrls,
        duration,
        aspect_ratio: aspectRatio,
        resolution: '480p',
      },
    });

    // ── Mark video as generating ───────────────────────────────────────

    await supabase
      .from('scenes')
      .update({ video_status: 'generating', video_task_id: result.taskId })
      .eq('id', sceneId);

    return NextResponse.json({
      task_id: result.taskId,
      model: videoModel,
      scene_id: sceneId,
      duration,
      aspect_ratio: aspectRatio,
      resolution: '480p',
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
