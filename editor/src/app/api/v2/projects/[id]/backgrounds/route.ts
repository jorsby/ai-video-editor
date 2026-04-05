import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { slugify } from '@/lib/utils/slugify';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v2/projects/{id}/backgrounds
 *
 * Lists all backgrounds for a project.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    const { data: project } = await supabase
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

    const { data: backgrounds, error } = await supabase
      .from('project_backgrounds')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return NextResponse.json(backgrounds ?? []);
  } catch (error) {
    console.error('[v2/projects/:id/backgrounds GET]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v2/projects/{id}/backgrounds
 *
 * Creates backgrounds for a project.
 *
 * Body (bare array):
 * [
 *   {
 *     "name": "Madrid Stadium Daytime",
 *     "slug": "madrid-stadium-daytime",  // optional
 *     "description": "Santiago Bernabéu under golden hour light",
 *     "prompt": "Wide establishing shot of Santiago Bernabéu stadium..."
 *   }
 * ]
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    const { data: project } = await supabase
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

    const body = await req.json();
    const items: Array<{
      name: string;
      slug?: string;
      description?: string;
      prompt?: string;
    }> = Array.isArray(body) ? body : [body];

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'At least one background required' },
        { status: 400 }
      );
    }

    const results = [];

    for (const item of items) {
      if (!item.name?.trim()) {
        results.push({ error: 'Name is required', input: item });
        continue;
      }

      const slug = item.slug?.trim() || slugify(item.name);

      const { data: bg, error: insertError } = await supabase
        .from('project_backgrounds')
        .upsert(
          {
            project_id: projectId,
            name: item.name.trim(),
            slug,
            description: item.description?.trim() || null,
            prompt: item.prompt?.trim() || '',
          },
          { onConflict: 'project_id,slug' }
        )
        .select()
        .single();

      if (insertError || !bg) {
        results.push({
          error: insertError?.message ?? 'Insert failed',
          input: item,
        });
        continue;
      }

      results.push(bg);
    }

    return NextResponse.json(results, { status: 201 });
  } catch (error) {
    console.error('[v2/projects/:id/backgrounds POST]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
