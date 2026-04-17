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
import {
  ASSET_FK_BY_TYPE,
  ASSET_TABLE_BY_TYPE,
  assetTypeFromVariantTable,
  getProjectVideoSettings,
  resolveVariantTable,
  updateVariantByIdSafe,
} from '@/lib/api/variant-table-resolver';

type RouteContext = { params: Promise<{ id: string }> };

function flattenStructuredPrompt(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return Object.values(value as Record<string, unknown>)
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => String(v).trim())
    .join('. ');
}

/**
 * POST /api/v2/variants/{id}/generate-image
 *
 * Generates an image for an asset variant using the configured model via kie.ai.
 * Resolves the typed variant table by variant_id, reads project settings from
 * projects.generation_settings, and queues the task with webhook callback.
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

    const variantTable = await resolveVariantTable(supabase, variantId);
    if (!variantTable) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    }

    const assetType = assetTypeFromVariantTable(variantTable);
    const parentFk = ASSET_FK_BY_TYPE[assetType];
    const parentTable = ASSET_TABLE_BY_TYPE[assetType];

    const { data: variant } = await supabase
      .from(variantTable)
      .select(
        `id, ${parentFk}, slug, structured_prompt, use_case, image_url, is_main`
      )
      .eq('id', variantId)
      .maybeSingle();

    if (!variant) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    }

    const parentId = variant[parentFk] as string | null;
    if (!parentId) {
      return NextResponse.json(
        { error: 'Variant has no parent asset' },
        { status: 500 }
      );
    }

    const { data: asset } = await supabase
      .from(parentTable)
      .select('id, project_id, name, structured_prompt, use_case')
      .eq('id', parentId)
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

    // ── Build prompt ────────────────────────────────────────────────────

    const body = await req.json().catch(() => ({}));
    let prompt: string;

    if (body.prompt_override) {
      prompt = body.prompt_override;
    } else {
      const parts: string[] = [];

      if (assetType === 'character') {
        parts.push(
          'Single character portrait, front-facing, well-lit, neutral background'
        );
      } else if (assetType === 'location') {
        parts.push(
          'Wide establishing shot, cinematic composition, atmospheric lighting, no people'
        );
      } else {
        parts.push(
          'Clean product shot, centered, neutral background, studio lighting'
        );
      }

      const variantPrompt = flattenStructuredPrompt(variant.structured_prompt);
      const assetPrompt = flattenStructuredPrompt(asset.structured_prompt);
      const desc = [assetPrompt, variantPrompt].filter(Boolean).join('. ');
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

    const settings = await getProjectVideoSettings(
      supabase,
      asset.project_id as string
    );
    const imageModels = settings.imageModels;

    // ── Resolve model: main → t2i, non-main → i2i ─────────────────────

    let model = getT2iModel(imageModels, assetType);
    let inputUrls: string[] | undefined;

    if (!variant.is_main) {
      // Non-main variant: use image-to-image with main variant's image
      const { data: mainVariant } = await supabase
        .from(variantTable)
        .select('image_url')
        .eq(parentFk, parentId)
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
      settings.aspectRatio
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

    const update = await updateVariantByIdSafe(supabase, variantId, {
      image_gen_status: 'generating',
      image_task_id: queued.requestId,
      image_url: null,
    });
    if (!update.ok) {
      console.error(
        '[v2/variants/:id/generate-image] Failed to mark variant generating:',
        update.error
      );
    }

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
