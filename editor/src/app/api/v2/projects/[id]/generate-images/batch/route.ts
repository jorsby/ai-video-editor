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
  type AssetType,
  type VariantTableName,
} from '@/lib/api/variant-table-resolver';

type Ctx = { params: Promise<{ id: string }> };

type LoadedVariant = {
  id: string;
  table: VariantTableName;
  type: AssetType;
  parentId: string;
  slug: string;
  is_main: boolean;
  image_gen_status: string | null;
  structured_prompt: Record<string, unknown> | null;
  asset: {
    id: string;
    name: string;
    description: string | null;
    project_id: string;
  };
};

function flattenPrompt(
  sp: Record<string, unknown> | null | undefined
): string | null {
  if (!sp || typeof sp !== 'object') return null;
  const direct = sp.prompt;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const parts = Object.values(sp)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
  return parts.length > 0 ? parts.join('. ') : null;
}

/**
 * POST /api/v2/projects/{id}/generate-images/batch
 *
 * Queue image generation for multiple variants across the three typed tables
 * (character_variants / location_variants / prop_variants) in a single call.
 *
 * Body:
 * {
 *   "variant_ids": ["uuid1", "uuid2", ...],
 *   "prompt_overrides": { "uuid1": "custom prompt" }
 * }
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id: projectId } = await ctx.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');

    const { data: project } = await db
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const variantIds: string[] = Array.isArray(body?.variant_ids)
      ? body.variant_ids.filter(
          (id: unknown) => typeof id === 'string' && id.trim()
        )
      : [];

    if (variantIds.length === 0) {
      return NextResponse.json(
        { error: 'variant_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    if (variantIds.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 variants per batch' },
        { status: 400 }
      );
    }

    const promptOverrides: Record<string, string> =
      typeof body?.prompt_overrides === 'object' && body.prompt_overrides
        ? body.prompt_overrides
        : {};

    const settings = await getProjectVideoSettings(db, projectId);
    const globalAspectRatio = settings.aspectRatio;
    const imageModels = settings.imageModels;

    // Resolve each variant to its typed table (parallel), then load the
    // variant + parent asset (scoped by project) from that typed pair.
    const resolvedVariants = await Promise.all(
      variantIds.map(async (id) => {
        const table = await resolveVariantTable(db, id);
        if (!table) return null;
        const type = assetTypeFromVariantTable(table);
        const parentTable = ASSET_TABLE_BY_TYPE[type];
        const parentFk = ASSET_FK_BY_TYPE[type];

        const { data } = await db
          .from(table)
          .select(
            `id, ${parentFk}, slug, structured_prompt, is_main, image_gen_status, asset:${parentTable}!inner(id, project_id, name, use_case)`
          )
          .eq('id', id)
          .eq(`${parentTable}.project_id`, projectId)
          .maybeSingle();

        if (!data) return null;

        const asset = data.asset as unknown as {
          id: string;
          project_id: string;
          name: string;
          use_case: string | null;
        } | null;

        if (!asset) return null;

        return {
          id: data.id as string,
          table,
          type,
          parentId: (data[parentFk] as string) ?? asset.id,
          slug: data.slug as string,
          is_main: !!data.is_main,
          image_gen_status: (data.image_gen_status as string | null) ?? null,
          structured_prompt:
            (data.structured_prompt as Record<string, unknown> | null) ?? null,
          asset: {
            id: asset.id,
            name: asset.name,
            description: asset.use_case ?? null,
            project_id: asset.project_id,
          },
        } satisfies LoadedVariant;
      })
    );

    const variantMap = new Map<string, LoadedVariant>();
    for (const v of resolvedVariants) {
      if (v) variantMap.set(v.id, v);
    }

    // Resolve webhook base
    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    // Pre-fetch main variant image URLs for i2i lookups, grouped by (table, parentId).
    type MainKey = `${VariantTableName}:${string}`;
    const mainImageMap = new Map<MainKey, string>();

    const nonMainByTable = new Map<VariantTableName, Set<string>>();
    for (const v of variantMap.values()) {
      if (!v.is_main) {
        const set = nonMainByTable.get(v.table) ?? new Set<string>();
        set.add(v.parentId);
        nonMainByTable.set(v.table, set);
      }
    }

    await Promise.all(
      Array.from(nonMainByTable.entries()).map(async ([table, parentIds]) => {
        if (parentIds.size === 0) return;
        const type = assetTypeFromVariantTable(table);
        const parentFk = ASSET_FK_BY_TYPE[type];
        const { data: mains } = await db
          .from(table)
          .select(`${parentFk}, image_url`)
          .in(parentFk, Array.from(parentIds))
          .eq('is_main', true);
        for (const m of (mains ?? []) as Array<Record<string, unknown>>) {
          const pid = m[parentFk] as string | undefined;
          const url = m.image_url as string | null;
          if (pid && url) mainImageMap.set(`${table}:${pid}`, url);
        }
      })
    );

    type BatchResult = {
      variant_id: string;
      task_id?: string;
      model?: string;
      status: 'queued' | 'skipped' | 'failed';
      reason?: string;
    };

    const results: BatchResult[] = [];
    let queued = 0;
    let skipped = 0;

    for (const variantId of variantIds) {
      const variant = variantMap.get(variantId);

      if (!variant) {
        results.push({
          variant_id: variantId,
          status: 'skipped',
          reason: 'not found in this project',
        });
        skipped++;
        continue;
      }

      if (variant.image_gen_status === 'generating') {
        results.push({
          variant_id: variantId,
          status: 'skipped',
          reason: 'already generating',
        });
        skipped++;
        continue;
      }

      const assetType = variant.type;
      const variantPrompt = flattenPrompt(variant.structured_prompt);

      let prompt: string;
      if (promptOverrides[variantId]) {
        prompt = promptOverrides[variantId];
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

        const desc = [variant.asset.description, variantPrompt]
          .filter(Boolean)
          .join('. ');
        if (desc) parts.push(desc);
        parts.push(
          'Absolutely no text, no words, no letters, no writing, no labels'
        );
        prompt = parts.join('. ');
      }

      let model = getT2iModel(imageModels, assetType);
      let inputUrls: string[] | undefined;

      if (!variant.is_main) {
        const mainImageUrl = mainImageMap.get(
          `${variant.table}:${variant.parentId}`
        );
        if (mainImageUrl) {
          model = getI2iModel(imageModels, assetType);
          inputUrls = [mainImageUrl];
        }
      }

      try {
        const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
        webhookUrl.searchParams.set('step', 'VideoAssetImage');
        webhookUrl.searchParams.set('variant_id', variantId);

        const isI2i = !!inputUrls;
        const aspectRatio = getImageAspectRatio(
          imageModels,
          assetType,
          isI2i,
          globalAspectRatio
        );
        const resolution = getImageResolution(imageModels, assetType, isI2i);

        const taskResult = await queueImageTask({
          prompt,
          webhookUrl: webhookUrl.toString(),
          model,
          inputUrls,
          aspectRatio,
          resolution,
        });

        const update = await updateVariantByIdSafe(db, variantId, {
          image_gen_status: 'generating',
          image_task_id: taskResult.requestId,
        });
        if (!update.ok) {
          console.warn(
            '[v2/projects/:id/generate-images/batch] variant status update failed:',
            update.error
          );
        }

        results.push({
          variant_id: variantId,
          task_id: taskResult.requestId,
          model: taskResult.model,
          status: 'queued',
        });
        queued++;
      } catch (err) {
        results.push({
          variant_id: variantId,
          status: 'failed',
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      queued,
      skipped,
      failed: results.filter((r) => r.status === 'failed').length,
      total: variantIds.length,
      aspect_ratio: globalAspectRatio,
      results,
    });
  } catch (error) {
    console.error('[v2/projects/:id/generate-images/batch] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
