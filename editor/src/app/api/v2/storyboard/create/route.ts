import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { klingO3PlanSchema } from '@/lib/schemas/kling-o3-plan';
import { createServiceClient } from '@/lib/supabase/admin';

const createStoryboardBodySchema = z.object({
  project_id: z.string().min(1),
  episode_id: z.string().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  mode: z.enum(['narrative', 'cinematic']),
  plan: klingO3PlanSchema.optional(),
  synopsis: z.string().optional(),
  episode_number: z.number().int().min(1).optional(),
});

function validatePlanConsistency(plan: z.infer<typeof klingO3PlanSchema>) {
  const sceneCount = plan.scene_prompts?.length ?? 0;

  // Grid consistency checks — only when grid fields are present (legacy plans)
  if (plan.objects_rows && plan.objects_cols && plan.objects) {
    if (plan.objects.length !== plan.objects_rows * plan.objects_cols) {
      return 'plan.objects length must equal objects_rows * objects_cols';
    }
  }

  if (plan.bg_rows && plan.bg_cols && plan.background_names) {
    if (plan.background_names.length !== plan.bg_rows * plan.bg_cols) {
      return 'plan.background_names length must equal bg_rows * bg_cols';
    }
  }

  // If no scene_prompts, this is a scene-based storyboard — skip array length checks
  if (sceneCount === 0) return null;

  if (plan.scene_bg_indices.length !== sceneCount) {
    return 'plan.scene_bg_indices length must equal scene_prompts length';
  }

  if (plan.scene_object_indices.length !== sceneCount) {
    return 'plan.scene_object_indices length must equal scene_prompts length';
  }

  if (
    plan.scene_first_frame_prompts &&
    plan.scene_first_frame_prompts.length !== sceneCount
  ) {
    return 'plan.scene_first_frame_prompts length must equal scene_prompts length';
  }

  if (plan.scene_durations && plan.scene_durations.length !== sceneCount) {
    return 'plan.scene_durations length must equal scene_prompts length';
  }

  if (
    plan.scene_shot_durations &&
    plan.scene_shot_durations.length !== sceneCount
  ) {
    return 'plan.scene_shot_durations length must equal scene_prompts length';
  }

  // Validate that multi-shot durations match multi-prompt array lengths
  if (plan.scene_shot_durations) {
    for (let i = 0; i < sceneCount; i++) {
      const prompt = plan.scene_prompts[i];
      const shotDurations = plan.scene_shot_durations[i];
      if (Array.isArray(prompt) && Array.isArray(shotDurations)) {
        if (prompt.length !== shotDurations.length) {
          return `scene_shot_durations[${i}] length must match scene_prompts[${i}] length`;
        }
      }
    }
  }

  for (const [lang, lines] of Object.entries(plan.voiceover_list)) {
    if (lines.length !== sceneCount) {
      return `plan.voiceover_list.${lang} length must equal scene_prompts length`;
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const parsed = createStoryboardBodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 }
      );
    }

    const {
      project_id,
      episode_id,
      title,
      mode,
      plan,
      synopsis,
      episode_number,
    } = parsed.data;

    if (plan) {
      const consistencyError = validatePlanConsistency(plan);
      if (consistencyError) {
        return NextResponse.json({ error: consistencyError }, { status: 400 });
      }
    }

    const db = createServiceClient('studio');

    const { data: project, error: projectError } = await db
      .from('projects')
      .select('id')
      .eq('id', project_id)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { data: maxSort } = await db
      .from('storyboards')
      .select('sort_order')
      .eq('project_id', project_id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSort = (maxSort?.sort_order ?? -1) + 1;

    let planWithMode: Record<string, unknown> | null = null;
    let voiceoverText: string | null = null;

    if (plan) {
      planWithMode = {
        ...plan,
        agent_mode: mode,
        video_mode:
          plan.video_mode ??
          (mode === 'cinematic' ? 'dialogue_scene' : 'narrative'),
      };

      const firstVoiceoverLanguage =
        Object.keys(plan.voiceover_list)[0] ?? 'en';
      voiceoverText = (plan.voiceover_list[firstVoiceoverLanguage] ?? []).join(
        '\n'
      );
    }

    const metadata: Record<string, unknown> = {};
    if (synopsis) metadata.synopsis = synopsis;
    if (episode_number) metadata.episode_number = episode_number;

    const { data: storyboard, error: storyboardError } = await db
      .from('storyboards')
      .insert({
        project_id,
        title: title ?? null,
        plan: planWithMode,
        plan_status: plan ? 'draft' : 'empty',
        mode: 'ref_to_video',
        model: 'klingo3',
        voiceover: voiceoverText,
        input_type:
          mode === 'cinematic' ? 'cinematic_flow' : 'voiceover_script',
        sort_order: nextSort,
        is_active: nextSort === 0,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
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

    if (episode_id) {
      const { data: episode, error: episodeError } = await db
        .from('series_episodes')
        .select('id, series_id')
        .eq('id', episode_id)
        .maybeSingle();

      if (episodeError || !episode) {
        return NextResponse.json(
          { error: 'Episode not found' },
          { status: 404 }
        );
      }

      const { data: ownedSeries, error: ownedSeriesError } = await db
        .from('series')
        .select('id')
        .eq('id', episode.series_id)
        .eq('user_id', user.id)
        .single();

      if (ownedSeriesError || !ownedSeries) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
      }

      const { error: linkError } = await db
        .from('series_episodes')
        .update({ storyboard_id: storyboardId })
        .eq('id', episode_id);

      if (linkError) {
        console.error(
          '[v2/storyboard/create] Failed to link episode:',
          linkError
        );
        return NextResponse.json(
          { error: 'Failed to link storyboard to episode' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        storyboard_id: storyboardId,
        status: plan ? 'draft' : 'empty',
      },
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
