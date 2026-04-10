import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import {
  queueImageTask,
  getT2iModel,
  getI2iModel,
  getImageAspectRatio,
  getImageResolution,
} from '@/lib/image-provider';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/variants/{id}/generate-image
 *
 * Generates an image for an asset variant using Flux 2 Pro via kie.ai.
 * Uses per-model aspect ratio and resolution from image_models settings.
 *
 * Uses variant.prompt + asset context to build the generation prompt.
 *
 * Body (optional):
 *   prompt_override?: string — Custom prompt instead of auto-built prompt
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: variantId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    // ── Fetch variant + asset + project ─────────────────────────────────

    const { data: variant, error: variantError } = await supabase
      .from('project_asset_variants')
      .select('id, asset_id, slug, prompt, image_url, is_main')
      .eq('id', variantId)
      .maybeSingle();

    if (variantError || !variant) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    }

    const { data: asset } = await supabase
      .from('project_assets')
      .select('id, project_id, name, type, description')
      .eq('id', variant.asset_id)
      .maybeSingle();

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', asset.project_id)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: video } = await supabase
      .from('videos')
      .select('id, genre, tone, aspect_ratio, image_models')
      .eq('project_id', asset.project_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // ── Build prompt ────────────────────────────────────────────────────

    const body = await req.json().catch(() => ({}));
    let prompt: string;

    if (body.prompt_override) {
      prompt = body.prompt_override;
    } else {
      const parts: string[] = [];

      if (asset.type === 'character') {
        parts.push(
          'Single character portrait, front-facing, well-lit, neutral background'
        );
      } else if (asset.type === 'location') {
        parts.push(
          'Wide establishing shot, cinematic composition, atmospheric lighting, no people'
        );
        if (video.genre) parts.push(`${video.genre} genre`);
        if (video.tone) parts.push(`${video.tone} tone`);
      } else {
        parts.push(
          'Clean product shot, centered, neutral background, studio lighting'
        );
      }

      const desc = [asset.description, variant.prompt]
        .filter(Boolean)
        .join('. ');
      if (desc) parts.push(desc);

      parts.push(
        'Absolutely no text, no words, no letters, no writing, no labels'
      );
      prompt = parts.join('. ');
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
    webhookUrl.searchParams.set('step', 'VideoAssetImage');
    webhookUrl.searchParams.set('variant_id', variantId);

    const globalAspectRatio = video.aspect_ratio ?? '9:16';

    // ── Resolve model: main → t2i, non-main → i2i ─────────────────────

    const imageModels = video.image_models as Record<string, string> | null;
    const assetType = asset.type as string;
    let model = getT2iModel(imageModels, assetType);
    let inputUrls: string[] | undefined;

    if (!variant.is_main) {
      // Non-main variant: use image-to-image with main variant's image
      const { data: mainVariant } = await supabase
        .from('project_asset_variants')
        .select('image_url')
        .eq('asset_id', variant.asset_id)
        .eq('is_main', true)
        .maybeSingle();

      if (mainVariant?.image_url) {
        model = getI2iModel(imageModels, assetType);
        inputUrls = [mainVariant.image_url as string];
      }
      // If main has no image yet, fall back to t2i
    }

    const isI2i = !!inputUrls;
    const aspectRatio = getImageAspectRatio(
      imageModels,
      assetType,
      isI2i,
      globalAspectRatio
    );
    const resolution = getImageResolution(imageModels, assetType, isI2i);

    const queued = await queueImageTask({
      prompt,
      webhookUrl: webhookUrl.toString(),
      model,
      inputUrls,
      aspectRatio,
      resolution,
    });

    // ── Mark variant as generating ─────────────────────────────────────

    await supabase
      .from('project_asset_variants')
      .update({
        image_gen_status: 'generating',
        image_task_id: queued.requestId,
        image_url: null,
      })
      .eq('id', variantId);

    return NextResponse.json({
      task_id: queued.requestId,
      model: queued.model,
      variant_id: variantId,
      aspect_ratio: aspectRatio,
      prompt,
    });
  } catch (error) {
    console.error('[v2/variants/:id/generate-image] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
