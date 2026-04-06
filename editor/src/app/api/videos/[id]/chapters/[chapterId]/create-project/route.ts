import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import { getVideo } from '@/lib/supabase/video-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = {
  params: Promise<{ id: string; chapterId: string }>;
};

/**
 * POST /api/videos/{id}/chapters/{chapterId}/create-project
 *
 * Creates (or reuses) a single shared project for the video, then creates a
 * storyboard inside that project for this chapter.
 *
 * Architecture: 1 project per video — all chapters share the same project_id.
 * Each chapter gets its own storyboard inside the shared project.
 * Characters are only bound on the first (project-creation) call.
 *
 * Returns: { project_id, storyboard_id, created_project, created_storyboard, characters_bound }
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: videoId, chapterId } = await context.params;
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

    const dbClient = sessionUser ? supabase : createServiceClient('studio');

    // Verify video ownership
    const video = await getVideo(dbClient, videoId, user.id);
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Get this chapter
    const { data: chapter, error: epErr } = await dbClient
      .from('chapters')
      .select('*')
      .eq('id', chapterId)
      .eq('video_id', videoId)
      .single();

    if (epErr || !chapter) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }

    // ── Step 1: Resolve the shared project for this video ─────────────────
    // Look for any chapter in this video that already has a project_id.
    const { data: sibling } = await dbClient
      .from('chapters')
      .select('project_id')
      .eq('video_id', videoId)
      .not('project_id', 'is', null)
      .limit(1)
      .maybeSingle();

    // The shared project_id (may already exist from a sibling chapter)
    const existingProjectId: string | null =
      chapter.project_id ?? sibling?.project_id ?? null;

    let projectId: string;
    let createdProject = false;
    const charactersBound = 0;

    if (existingProjectId) {
      // Reuse the existing shared project
      projectId = existingProjectId;
    } else {
      // First chapter for this video — create ONE shared project named after the video
      const { data: project, error: projErr } = await dbClient
        .from('projects')
        .insert({
          user_id: user.id,
          name: video.name,
          settings: {
            video_id: videoId,
          },
        })
        .select('id')
        .single();

      if (projErr || !project) {
        console.error('Create project error:', projErr);
        return NextResponse.json(
          { error: 'Failed to create project' },
          { status: 500 }
        );
      }

      projectId = project.id;
      createdProject = true;

      // Characters now live entirely in series_assets — no legacy character binding needed
    }

    // ── Step 2: Link this chapter to the shared project ────────────────────
    if (!chapter.project_id) {
      const { error: linkErr } = await dbClient
        .from('chapters')
        .update({ project_id: projectId })
        .eq('id', chapterId);

      if (linkErr) {
        console.error('Link chapter to project error:', linkErr);
      }
    }

    // ── Step 3: Create a storyboard for this chapter ───────────────────────
    // Check if a storyboard already exists for this chapter (identified by title)
    const storyboardTitle = `EP${chapter.episode_number}: ${chapter.title ?? 'Untitled'}`;

    const { data: existingStoryboard } = await dbClient
      .from('storyboards')
      .select('id')
      .eq('project_id', projectId)
      .eq('title', storyboardTitle)
      .maybeSingle();

    if (existingStoryboard) {
      // Already created — return existing
      return NextResponse.json({
        project_id: projectId,
        storyboard_id: existingStoryboard.id,
        created_project: createdProject,
        created_storyboard: false,
        characters_bound: charactersBound,
      });
    }

    // Get next sort_order for the new storyboard
    const { data: maxSort } = await dbClient
      .from('storyboards')
      .select('sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSort = (maxSort?.sort_order ?? -1) + 1;

    const { data: storyboard, error: sbErr } = await dbClient
      .from('storyboards')
      .insert({
        project_id: projectId,
        title: storyboardTitle,
        plan_status: 'draft',
        mode: 'ref_to_video',
        voiceover: chapter.synopsis ?? chapter.title ?? '',
        is_active: nextSort === 0, // First storyboard is active
        sort_order: nextSort,
        input_type: 'voiceover_script',
      })
      .select('id')
      .single();

    if (sbErr || !storyboard) {
      console.error('Create storyboard error:', sbErr);
      return NextResponse.json(
        { error: 'Failed to create storyboard' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        project_id: projectId,
        storyboard_id: storyboard.id,
        created_project: createdProject,
        created_storyboard: true,
        characters_bound: charactersBound,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create chapter project error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
