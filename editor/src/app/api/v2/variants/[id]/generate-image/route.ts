import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { queueKieImageTask } from '@/lib/kie-image';
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

    // ── Fetch variant + asset + series ──────────────────────────────────

    const { data: variant, error: variantError } = await supabase
      .from('series_asset_variants')
      .select('id, asset_id, slug, prompt, image_url, is_main')
      .eq('id', variantId)
      .maybeSingle();

    if (variantError || !variant) {
      return NextResponse.json(
        { error: 'Variant not found' },
        { status: 404 }
      );
    }

    const { data: asset } = await supabase
      .from('series_assets')
      .select('id, series_id, name, type, description')
      .eq('id', variant.asset_id)
      .maybeSingle();

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    const { data: series } = await supabase
      .from('series')
      .select('id, user_id, genre, tone')
      .eq('id', asset.series_id)
      .maybeSingle();

    if (!series) {
      return NextResponse.json(
        { error: 'Series not found' },
        { status: 404 }
      );
    }

    if (series.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

    const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
    webhookUrl.searchParams.set('step', 'SeriesAssetImage');
    webhookUrl.searchParams.set('variant_id', variantId);

    // ── Submit to kie.ai — always 1K, 9:16, JPG ────────────────────────

    const queued = await queueKieImageTask({
      prompt,
      callbackUrl: webhookUrl.toString(),
      aspectRatio: '9:16',
      resolution: '1K',
      outputFormat: 'jpg',
    });

    // ── Mark variant as generating ─────────────────────────────────────

    await supabase
      .from('series_asset_variants')
      .update({ image_gen_status: 'generating', image_task_id: queued.requestId })
      .eq('id', variantId);

    return NextResponse.json({
      task_id: queued.requestId,
      model: queued.model,
      variant_id: variantId,
      aspect_ratio: '9:16',
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
