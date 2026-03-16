/**
 * POST /api/v2/storyboard/create
 *
 * Creates a storyboard from an agent-provided plan.
 * No LLM call — the agent IS the LLM; the plan is accepted verbatim.
 *
 * Body: {
 *   project_id: string,
 *   episode_id?: string,   // optional, links series_episodes.storyboard_id
 *   title?: string,
 *   mode?: string,         // default "narrative" (stored in storyboard.voiceover field)
 *   plan: { ... }          // KlingO3 plan shape
 * }
 *
 * Response: { storyboard_id, status: "draft" }
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    const projectId =
      typeof body?.project_id === 'string' ? body.project_id.trim() : '';
    const episodeId =
      typeof body?.episode_id === 'string' ? body.episode_id.trim() : null;
    const title = typeof body?.title === 'string' ? body.title.trim() : null;
    const mode =
      typeof body?.mode === 'string' ? body.mode.trim() : 'narrative';
    const plan = body?.plan;

    if (!projectId) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
      return NextResponse.json(
        { error: 'plan is required and must be an object' },
        { status: 400 }
      );
    }

    // Verify plan has the minimum required shape for a ref_to_video / klingo3 storyboard
    const requiredPlanFields = [
      'objects_rows',
      'objects_cols',
      'objects_grid_prompt',
      'objects',
      'bg_rows',
      'bg_cols',
      'backgrounds_grid_prompt',
      'background_names',
      'scene_prompts',
      'scene_bg_indices',
      'scene_object_indices',
      'voiceover_list',
    ];
    const missing = requiredPlanFields.filter(
      (f) => !(f in (plan as Record<string, unknown>))
    );
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `plan is missing required fields: ${missing.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');

    // Verify project ownership
    const { data: project, error: projectError } = await db
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Determine sort_order (append after existing storyboards)
    const { data: maxSort } = await db
      .from('storyboards')
      .select('sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSort = (maxSort?.sort_order ?? -1) + 1;

    // Normalize voiceover_list – the existing system expects
    // { en: ["...", "..."] } or just an array (we wrap it as "en")
    const rawVoiceover = (plan as Record<string, unknown>).voiceover_list;
    let voiceoverList: Record<string, string[]>;
    if (Array.isArray(rawVoiceover)) {
      voiceoverList = { en: rawVoiceover as string[] };
    } else if (
      rawVoiceover &&
      typeof rawVoiceover === 'object' &&
      !Array.isArray(rawVoiceover)
    ) {
      voiceoverList = rawVoiceover as Record<string, string[]>;
    } else {
      voiceoverList = { en: [] };
    }

    // Build the full plan object as expected by existing approve-ref-grid logic
    const normalizedPlan = {
      ...(plan as Record<string, unknown>),
      voiceover_list: voiceoverList,
    };

    // Build a short voiceover text from the first language for the storyboard.voiceover field
    const firstLang = Object.keys(voiceoverList)[0] ?? 'en';
    const voiceoverText = (voiceoverList[firstLang] ?? []).join('\n');

    const { data: storyboard, error: storyboardError } = await db
      .from('storyboards')
      .insert({
        project_id: projectId,
        title,
        plan: normalizedPlan,
        plan_status: 'draft',
        mode: 'ref_to_video',
        model: 'klingo3',
        voiceover: voiceoverText,
        is_active: nextSort === 0,
        sort_order: nextSort,
        input_type: 'voiceover_script',
      })
      .select('id')
      .single();

    if (storyboardError || !storyboard) {
      console.error(
        '[v2/storyboard/create] Failed to create storyboard:',
        storyboardError
      );
      return NextResponse.json(
        { error: 'Failed to create storyboard' },
        { status: 500 }
      );
    }

    const storyboardId = storyboard.id as string;

    // If an episode_id was provided, link the storyboard to it
    if (episodeId) {
      const { error: episodeLinkError } = await db
        .from('series_episodes')
        .update({ storyboard_id: storyboardId })
        .eq('id', episodeId);

      if (episodeLinkError) {
        // Non-fatal — storyboard is created; caller can relink manually
        console.warn(
          '[v2/storyboard/create] Failed to link episode to storyboard:',
          episodeLinkError.message
        );
      }
    }

    return NextResponse.json(
      { storyboard_id: storyboardId, status: 'draft' },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v2/storyboard/create] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
