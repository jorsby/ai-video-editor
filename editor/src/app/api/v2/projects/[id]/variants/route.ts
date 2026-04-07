import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v2/projects/{id}/variants
 *
 * Returns all asset variants for a project, grouped with their parent asset info.
 *
 * Query params (optional):
 *   type=character|location|prop — filter by asset type
 *
 * Response 200:
 * [
 *   {
 *     "id": "variant-uuid",
 *     "asset_id": "asset-uuid",
 *     "name": "Night Version",
 *     "slug": "night-version",
 *     "prompt": "...",
 *     "image_url": "...",
 *     "is_main": false,
 *     "where_to_use": "...",
 *     "image_gen_status": "idle",
 *     "asset": { "id": "...", "name": "Sultan Mehmed", "type": "character", "slug": "sultan-mehmed" }
 *   }
 * ]
 */
export async function GET(req: NextRequest, ctx: Ctx) {
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

    // Optional type filter
    const typeFilter = req.nextUrl.searchParams.get('type');
    const validTypes = ['character', 'location', 'prop'];

    let query = db
      .from('project_asset_variants')
      .select(
        'id, asset_id, name, slug, prompt, image_url, is_main, where_to_use, reasoning, image_gen_status, image_task_id, created_at, updated_at, asset:project_assets!inner(id, name, type, slug, description, project_id)'
      )
      .eq('project_assets.project_id', projectId);

    if (typeFilter && validTypes.includes(typeFilter)) {
      query = query.eq('project_assets.type', typeFilter);
    }

    const { data, error } = await query.order('created_at', {
      ascending: true,
    });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to load variants' },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error('[v2/projects/:id/variants] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
