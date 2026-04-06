import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createTask } from '@/lib/kieai';
import {
  queueImageTask,
  resolveImageProvider,
  type ImageProvider,
} from '@/lib/image-provider';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const KIE_IMAGE_EDIT_MODEL = 'grok-imagine/image-to-image';

/**
 * POST /api/v2/variants/{id}/edit-image
 *
 * Edits a variant's existing image using Grok Imagine image-to-image via kie.ai.
 * Always 9:16 aspect ratio. The variant must already have an image_url.
 *
 * Body (required):
 *   prompt: string — Edit instructions describing the desired change
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
      .select('id, asset_id, slug, image_url, prompt')
      .eq('id', variantId)
      .maybeSingle();

    if (variantError || !variant) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    }

    if (!variant.image_url) {
      return NextResponse.json(
        {
          error: 'Variant has no image yet. Generate an image first.',
          hint: 'POST /api/v2/variants/{id}/generate-image',
        },
        { status: 400 }
      );
    }

    const { data: asset } = await supabase
      .from('project_assets')
      .select('id, project_id')
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
      .select('id, image_provider')
      .eq('project_id', asset.project_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // ── Parse body ──────────────────────────────────────────────────────

    const body = await req.json().catch(() => ({}));

    if (!body.prompt?.trim()) {
      return NextResponse.json(
        { error: 'prompt is required — describe the edit you want.' },
        { status: 400 }
      );
    }

    // ── Build webhook URL ───────────────────────────────────────────────

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    // ── Resolve provider & webhook ────────────────────────────────────

    const provider = resolveImageProvider(video.image_provider);
    const webhookPath =
      provider === 'fal' ? '/api/webhook/fal' : '/api/webhook/kieai';
    const webhookUrl = new URL(`${webhookBase}${webhookPath}`);
    webhookUrl.searchParams.set('step', 'VideoAssetImage');
    webhookUrl.searchParams.set('variant_id', variantId);

    // ── Submit edit task ────────────────────────────────────────────────

    let taskId: string;
    let model: string;

    if (provider === 'fal') {
      // FAL: use image_input for editing with nano-banana-2
      const queued = await queueImageTask({
        provider: 'fal',
        prompt: body.prompt.trim(),
        webhookUrl: webhookUrl.toString(),
        imageInput: [variant.image_url],
      });
      taskId = queued.requestId;
      model = queued.model;
    } else {
      // KIE: use grok-imagine image-to-image model
      const result = await createTask({
        model: KIE_IMAGE_EDIT_MODEL,
        callbackUrl: webhookUrl.toString(),
        input: {
          prompt: body.prompt.trim(),
          image_urls: [variant.image_url],
        },
      });
      taskId = result.taskId;
      model = KIE_IMAGE_EDIT_MODEL;
    }

    // ── Mark variant as generating ─────────────────────────────────────

    await supabase
      .from('project_asset_variants')
      .update({ image_gen_status: 'generating', image_task_id: taskId })
      .eq('id', variantId);

    return NextResponse.json({
      task_id: taskId,
      model,
      provider,
      variant_id: variantId,
      source_image: variant.image_url,
    });
  } catch (error) {
    console.error('[v2/variants/:id/edit-image] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
