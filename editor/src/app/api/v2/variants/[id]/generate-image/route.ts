import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { queueImageTask, resolveImageProvider } from '@/lib/image-provider';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/variants/{id}/generate-image
 *
 * Generates an image for an asset variant using Nano Banana 2 via kie.ai.
 * Always 1K resolution, 9:16 aspect ratio, JPG output.
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

    const { data: series } = await supabase
      .from('series')
      .select('id, genre, tone, image_model, image_provider, aspect_ratio')
      .eq('project_id', asset.project_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    if (!series.image_model) {
      return NextResponse.json(
        {
          error:
            'Series has no image_model configured. Set it in series settings first.',
        },
        { status: 400 }
      );
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
        if (series.genre) parts.push(`${series.genre} genre`);
        if (series.tone) parts.push(`${series.tone} tone`);
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

    // ── Resolve provider & webhook ────────────────────────────────────

    const provider = resolveImageProvider(series.image_provider);
    const webhookPath =
      provider === 'fal' ? '/api/webhook/fal' : '/api/webhook/kieai';
    const webhookUrl = new URL(`${webhookBase}${webhookPath}`);
    webhookUrl.searchParams.set('step', 'SeriesAssetImage');
    webhookUrl.searchParams.set('variant_id', variantId);

    const aspectRatio = series.aspect_ratio ?? '9:16';

    const queued = await queueImageTask({
      provider,
      prompt,
      webhookUrl: webhookUrl.toString(),
      aspectRatio,
      resolution: '1K',
      outputFormat: 'jpg',
    });

    // ── Mark variant as generating ─────────────────────────────────────

    await supabase
      .from('project_asset_variants')
      .update({
        image_gen_status: 'generating',
        image_task_id: queued.requestId,
      })
      .eq('id', variantId);

    return NextResponse.json({
      task_id: queued.requestId,
      model: queued.model,
      provider: queued.provider,
      variant_id: variantId,
      aspect_ratio: aspectRatio,
      resolution: '1K',
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
