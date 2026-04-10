import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

const createSceneBodySchema = z.object({
  sort_order: z.number().int().min(1),
  voiceover_text: z.string().optional(),
  visual_direction: z.string().optional(),
  shot_prompts: z.array(z.string()).min(1).max(3),
  shot_durations: z.array(z.number().int().min(3).max(15)).min(1).max(3),
  duration: z.number().int().min(3).max(15),
  background_name: z.string().min(1),
  object_names: z.array(z.string()).max(4).optional(),
  language: z.string().min(2).max(5).default('tr'),
});

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/storyboard/[id]/scenes — Create a single scene
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: storyboardId } = await context.params;
    const body = await req.json();
    const parsed = createSceneBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Validate shot_durations matches shot_prompts length
    if (data.shot_durations.length !== data.shot_prompts.length) {
      return NextResponse.json(
        { error: 'shot_durations length must match shot_prompts length' },
        { status: 400 }
      );
    }

    // Validate duration = sum of shot_durations
    const durationSum = data.shot_durations.reduce((a, b) => a + b, 0);
    if (data.duration !== durationSum) {
      return NextResponse.json(
        {
          error: `duration (${data.duration}) must equal sum of shot_durations (${durationSum})`,
        },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Fetch storyboard + series info
    const { data: storyboard, error: sbErr } = await supabase
      .schema('studio')
      .from('storyboards')
      .select('id, plan_status, project_id')
      .eq('id', storyboardId)
      .single();

    if (sbErr || !storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    if (storyboard.plan_status === 'approved') {
      return NextResponse.json(
        { error: 'Cannot add scenes to an approved storyboard' },
        { status: 400 }
      );
    }

    // Get series_id from project
    const { data: project } = await supabase
      .schema('studio')
      .from('projects')
      .select('id, series_id')
      .eq('id', storyboard.project_id)
      .single();

    const seriesId = project?.series_id;

    // Validate background_name exists as series asset
    if (seriesId) {
      const { data: bgAsset } = await supabase
        .schema('studio')
        .from('series_assets')
        .select('id')
        .eq('series_id', seriesId)
        .eq('name', data.background_name)
        .eq('type', 'location')
        .limit(1);

      if (!bgAsset || bgAsset.length === 0) {
        return NextResponse.json(
          {
            error: `Background "${data.background_name}" not found as a location asset in series`,
          },
          { status: 400 }
        );
      }

      // Validate object_names
      if (data.object_names && data.object_names.length > 0) {
        const { data: objAssets } = await supabase
          .schema('studio')
          .from('series_assets')
          .select('name')
          .eq('series_id', seriesId)
          .in('type', ['character', 'prop'])
          .in('name', data.object_names);

        const foundNames = new Set(
          (objAssets ?? []).map((a: { name: string }) => a.name)
        );
        const missing = data.object_names.filter((n) => !foundNames.has(n));
        if (missing.length > 0) {
          return NextResponse.json(
            {
              error: `Objects not found as series assets: ${missing.join(', ')}`,
            },
            { status: 400 }
          );
        }
      }
    }

    // Insert scene record
    const isMultiShot = data.shot_prompts.length > 1;
    const { data: scene, error: insertErr } = await supabase
      .schema('studio')
      .from('scenes')
      .insert({
        storyboard_id: storyboardId,
        order: data.sort_order,
        prompt: isMultiShot ? null : data.shot_prompts[0],
        multi_prompt: isMultiShot ? data.shot_prompts : null,
        duration: data.duration,
        voiceover_text: data.voiceover_text ?? null,
        visual_direction: data.visual_direction ?? null,
        shot_durations: data.shot_durations,
        background_name: data.background_name,
        object_names: data.object_names ?? [],
        language: data.language,
      })
      .select('id, storyboard_id, order')
      .single();

    if (insertErr) {
      console.error('[scenes/create] Insert error:', insertErr);
      return NextResponse.json(
        { error: 'Failed to create scene', details: insertErr.message },
        { status: 500 }
      );
    }

    // Auto-transition storyboard from empty → draft
    if (storyboard.plan_status === 'empty') {
      await supabase
        .schema('studio')
        .from('storyboards')
        .update({ plan_status: 'draft' })
        .eq('id', storyboardId)
        .eq('plan_status', 'empty'); // atomic gate
    }

    return NextResponse.json({
      scene_id: scene.id,
      storyboard_id: scene.storyboard_id,
      sort_order: scene.order,
      status: 'draft',
    });
  } catch (err) {
    console.error('[scenes/create] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v2/storyboard/[id]/scenes — List all scenes for a storyboard
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: storyboardId } = await context.params;
    const supabase = createServiceClient();

    const { data: scenes, error } = await supabase
      .schema('studio')
      .from('scenes')
      .select(
        'id, order, prompt, multi_prompt, duration, voiceover_text, visual_direction, shot_durations, background_name, object_names, language, video_status, video_url'
      )
      .eq('storyboard_id', storyboardId)
      .order('order', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch scenes' },
        { status: 500 }
      );
    }

    return NextResponse.json({ scenes: scenes ?? [] });
  } catch (err) {
    console.error('[scenes/list] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
