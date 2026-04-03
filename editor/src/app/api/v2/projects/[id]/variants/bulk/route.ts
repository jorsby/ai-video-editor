import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { slugify as toSlug } from '@/lib/utils/slugify';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/projects/{id}/variants/bulk
 *
 * Create multiple variants across multiple assets in a single call.
 *
 * Body: Array of variant objects:
 * [
 *   {
 *     "asset_id": "uuid",           // required — which asset this variant belongs to
 *     "name": "Hero Variant",       // required
 *     "slug": "ali-hero",           // optional, auto-generated from name
 *     "prompt": "...",              // required — image generation prompt
 *     "where_to_use": "...",        // required — usage context
 *     "reasoning": "...",           // optional
 *     "is_main": false              // optional, default false
 *   },
 *   ...
 * ]
 *
 * Response 201: Array of created variants with full details
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id: projectId } = await ctx.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');

    // Verify project ownership
    const { data: project } = await db
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .maybeSingle();

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!Array.isArray(body) || body.length === 0) {
      return NextResponse.json(
        { error: 'Body must be a non-empty array of variant objects' },
        { status: 400 }
      );
    }

    if (body.length > 200) {
      return NextResponse.json(
        { error: 'Maximum 200 variants per request' },
        { status: 400 }
      );
    }

    // Collect unique asset IDs and verify they all belong to this project
    const assetIds = [...new Set(body.map((item) => item?.asset_id).filter(Boolean))];
    if (assetIds.length === 0) {
      return NextResponse.json(
        { error: 'Each variant must have an asset_id' },
        { status: 400 }
      );
    }

    const { data: assets, error: assetError } = await db
      .from('project_assets')
      .select('id')
      .eq('project_id', projectId)
      .in('id', assetIds);

    if (assetError) {
      return NextResponse.json(
        { error: 'Failed to verify assets' },
        { status: 500 }
      );
    }

    const validAssetIds = new Set((assets ?? []).map((a: { id: string }) => a.id));
    const invalidAssetIds = assetIds.filter((id) => !validAssetIds.has(id));
    if (invalidAssetIds.length > 0) {
      return NextResponse.json(
        {
          error: `Assets not found in this project: ${invalidAssetIds.join(', ')}`,
        },
        { status: 404 }
      );
    }

    // Build rows
    const rows: Array<Record<string, unknown>> = [];
    const mainAssetIds = new Set<string>();

    for (const item of body) {
      const assetId = item?.asset_id;
      if (!assetId || !validAssetIds.has(assetId)) {
        return NextResponse.json(
          { error: 'Each variant must have a valid asset_id' },
          { status: 400 }
        );
      }

      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      if (!name) {
        return NextResponse.json(
          { error: 'Each variant must have a non-empty name' },
          { status: 400 }
        );
      }

      const slug =
        typeof item?.slug === 'string' && item.slug.trim()
          ? item.slug.trim()
          : toSlug(name);

      const prompt = typeof item?.prompt === 'string' ? item.prompt.trim() : '';
      if (!prompt) {
        return NextResponse.json(
          { error: `"prompt" is required for variant "${name}"` },
          { status: 400 }
        );
      }

      const whereToUse =
        typeof item?.where_to_use === 'string' ? item.where_to_use.trim() : '';
      if (!whereToUse) {
        return NextResponse.json(
          { error: `"where_to_use" is required for variant "${name}"` },
          { status: 400 }
        );
      }

      if (item?.is_main === true) {
        mainAssetIds.add(assetId);
      }

      rows.push({
        asset_id: assetId,
        name,
        slug,
        prompt,
        where_to_use: whereToUse,
        reasoning: typeof item?.reasoning === 'string' ? item.reasoning.trim() : '',
        is_main: item?.is_main === true,
      });
    }

    // Clear is_main for assets that will get a new main variant
    if (mainAssetIds.size > 0) {
      for (const assetId of mainAssetIds) {
        await db
          .from('project_asset_variants')
          .update({ is_main: false })
          .eq('asset_id', assetId)
          .eq('is_main', true);
      }
    }

    // Insert all variants
    const { data: created, error: insertError } = await db
      .from('project_asset_variants')
      .insert(rows)
      .select(
        'id, asset_id, name, slug, prompt, image_url, is_main, where_to_use, reasoning, image_task_id, image_gen_status, created_at, updated_at'
      );

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'One or more variant slugs already exist for their asset' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to create variants' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        created: created?.length ?? 0,
        variants: created ?? [],
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v2/projects/:id/variants/bulk] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
