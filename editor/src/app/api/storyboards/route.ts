import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/storyboards?project_id=<projectId>
 *
 * List all storyboards for a project, ordered by sort_order then created_at.
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    const apiKeyResult = !sessionUser ? validateApiKey(req) : { valid: false };
    const user =
      sessionUser ??
      (apiKeyResult.valid && apiKeyResult.userId
        ? { id: apiKeyResult.userId }
        : null);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get('project_id');
    if (!projectId) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');

    // Verify project ownership
    const { data: project } = await dbClient
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { data: storyboards, error } = await dbClient
      .from('storyboards')
      .select(
        'id, project_id, title, input_type, is_active, sort_order, mode, model, plan_status, aspect_ratio, voiceover, created_at'
      )
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('List storyboards error:', error);
      return NextResponse.json(
        { error: 'Failed to list storyboards' },
        { status: 500 }
      );
    }

    return NextResponse.json({ storyboards: storyboards ?? [] });
  } catch (error) {
    console.error('List storyboards error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/storyboards
 *
 * Create a new storyboard for a project.
 *
 * Body: {
 *   project_id: string,
 *   title?: string,
 *   input_type?: "voiceover_script" | "cinematic_flow",
 *   mode?: "ref_to_video" | "image_to_video" | "quick_video",
 *   aspect_ratio?: string,
 *   is_active?: boolean
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    const apiKeyResult = !sessionUser ? validateApiKey(req) : { valid: false };
    const user =
      sessionUser ??
      (apiKeyResult.valid && apiKeyResult.userId
        ? { id: apiKeyResult.userId }
        : null);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      project_id,
      title,
      input_type = 'voiceover_script',
      mode = 'ref_to_video',
      aspect_ratio = '9:16',
      is_active = false,
    } = body;

    if (!project_id) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    if (!['voiceover_script', 'cinematic_flow'].includes(input_type)) {
      return NextResponse.json(
        { error: 'input_type must be "voiceover_script" or "cinematic_flow"' },
        { status: 400 }
      );
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');

    // Verify project ownership
    const { data: project } = await dbClient
      .from('projects')
      .select('id')
      .eq('id', project_id)
      .eq('user_id', user.id)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Get next sort_order
    const { data: maxSort } = await dbClient
      .from('storyboards')
      .select('sort_order')
      .eq('project_id', project_id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSort = (maxSort?.sort_order ?? -1) + 1;

    // If setting as active, deactivate others
    if (is_active) {
      await dbClient
        .from('storyboards')
        .update({ is_active: false })
        .eq('project_id', project_id);
    }

    const { data: storyboard, error } = await dbClient
      .from('storyboards')
      .insert({
        project_id,
        title: title?.trim() || null,
        input_type,
        mode,
        aspect_ratio,
        is_active,
        sort_order: nextSort,
        voiceover: '',
        plan_status: 'draft',
      })
      .select()
      .single();

    if (error) {
      console.error('Create storyboard error:', error);
      return NextResponse.json(
        { error: 'Failed to create storyboard' },
        { status: 500 }
      );
    }

    return NextResponse.json({ storyboard }, { status: 201 });
  } catch (error) {
    console.error('Create storyboard error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
