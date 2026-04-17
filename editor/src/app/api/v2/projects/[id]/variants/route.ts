import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import {
  ASSET_FK_BY_TYPE,
  ASSET_TABLE_BY_TYPE,
  VARIANT_TABLE_BY_TYPE,
  type AssetType,
} from '@/lib/api/variant-table-resolver';

type Ctx = { params: Promise<{ id: string }> };

type VariantJoinedRow = Record<string, unknown> & {
  id: string;
  name: string | null;
  slug: string;
  structured_prompt: Record<string, unknown> | null;
  image_url: string | null;
  is_main: boolean | null;
  image_gen_status: string | null;
  image_task_id: string | null;
  created_at: string;
  updated_at: string;
};

type ParentJoinedRow = {
  id: string;
  name: string;
  slug: string;
  use_case: string | null;
  project_id: string;
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

function extractReasoning(
  sp: Record<string, unknown> | null | undefined
): string {
  if (!sp || typeof sp !== 'object') return '';
  const r = sp.reasoning;
  return typeof r === 'string' ? r : '';
}

/**
 * GET /api/v2/projects/{id}/variants
 *
 * Returns all asset variants for a project across the three typed tables
 * (character_variants, location_variants, prop_variants), each with its
 * parent asset info attached as `asset`.
 *
 * Query params (optional):
 *   type=character|location|prop — restrict to one typed pair
 */
export async function GET(req: NextRequest, ctx: Ctx) {
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

    const typeParam = req.nextUrl.searchParams.get('type');
    const validTypes: AssetType[] = ['character', 'location', 'prop'];
    const types: AssetType[] =
      typeParam && validTypes.includes(typeParam as AssetType)
        ? [typeParam as AssetType]
        : validTypes;

    const results = await Promise.all(
      types.map(async (t) => {
        const variantTable = VARIANT_TABLE_BY_TYPE[t];
        const parentTable = ASSET_TABLE_BY_TYPE[t];
        const parentFk = ASSET_FK_BY_TYPE[t];

        const { data, error } = await db
          .from(variantTable)
          .select(
            `id, ${parentFk}, name, slug, structured_prompt, image_url, is_main, image_gen_status, image_task_id, created_at, updated_at, asset:${parentTable}!inner(id, name, slug, use_case, project_id)`
          )
          .eq(`${parentTable}.project_id`, projectId)
          .order('created_at', { ascending: true });

        if (error || !data) return [];

        return (data as VariantJoinedRow[]).map((row) => {
          const asset = row.asset as unknown as ParentJoinedRow | null;
          return {
            id: row.id,
            asset_id: (row[parentFk] as string) ?? asset?.id ?? '',
            name: row.name,
            slug: row.slug,
            prompt: flattenPrompt(row.structured_prompt),
            image_url: row.image_url,
            is_main: !!row.is_main,
            reasoning: extractReasoning(row.structured_prompt),
            image_gen_status: row.image_gen_status,
            image_task_id: row.image_task_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            asset: asset
              ? {
                  id: asset.id,
                  name: asset.name,
                  type: t,
                  slug: asset.slug,
                  description: asset.use_case ?? null,
                  project_id: asset.project_id,
                }
              : null,
          };
        });
      })
    );

    return NextResponse.json(results.flat());
  } catch (error) {
    console.error('[v2/projects/:id/variants] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
