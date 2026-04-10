import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

const updateSceneBodySchema = z.object({
  sort_order: z.number().int().min(1).optional(),
  voiceover_text: z.string().optional(),
  visual_direction: z.string().optional(),
  shot_prompts: z.array(z.string()).min(1).max(3).optional(),
  shot_durations: z
    .array(z.number().int().min(3).max(15))
    .min(1)
    .max(3)
    .optional(),
  duration: z.number().int().min(3).max(15).optional(),
  background_name: z.string().min(1).optional(),
  object_names: z.array(z.string()).max(4).optional(),
  language: z.string().min(2).max(5).optional(),
});

type RouteContext = { params: Promise<{ id: string; sceneId: string }> };

/**
 * PUT /api/v2/storyboard/[id]/scenes/[sceneId] — Update a scene
 */
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: storyboardId, sceneId } = await context.params;
    const body = await req.json();
    const parsed = updateSceneBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const supabase = createServiceClient();

    // Check storyboard is not approved
    const { data: storyboard } = await supabase
      .schema('studio')
      .from('storyboards')
      .select('plan_status')
      .eq('id', storyboardId)
      .single();

    if (!storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    if (storyboard.plan_status === 'approved') {
      return NextResponse.json(
        { error: 'Cannot edit scenes in an approved storyboard' },
        { status: 400 }
      );
    }

    // Validate shot_durations + shot_prompts consistency
    if (data.shot_durations && data.shot_prompts) {
      if (data.shot_durations.length !== data.shot_prompts.length) {
        return NextResponse.json(
          { error: 'shot_durations length must match shot_prompts length' },
          { status: 400 }
        );
      }
    }

    if (data.duration && data.shot_durations) {
      const sum = data.shot_durations.reduce((a, b) => a + b, 0);
      if (data.duration !== sum) {
        return NextResponse.json(
          {
            error: `duration (${data.duration}) must equal sum of shot_durations (${sum})`,
          },
          { status: 400 }
        );
      }
    }

    // Build update payload
    const update: Record<string, unknown> = {};
    if (data.sort_order !== undefined) update.order = data.sort_order;
    if (data.voiceover_text !== undefined)
      update.voiceover_text = data.voiceover_text;
    if (data.visual_direction !== undefined)
      update.visual_direction = data.visual_direction;
    if (data.duration !== undefined) update.duration = data.duration;
    if (data.shot_durations !== undefined)
      update.shot_durations = data.shot_durations;
    if (data.background_name !== undefined)
      update.background_name = data.background_name;
    if (data.object_names !== undefined)
      update.object_names = data.object_names;
    if (data.language !== undefined) update.language = data.language;

    if (data.shot_prompts) {
      const isMultiShot = data.shot_prompts.length > 1;
      update.prompt = isMultiShot ? null : data.shot_prompts[0];
      update.multi_prompt = isMultiShot ? data.shot_prompts : null;
    }

    const { data: scene, error: updateErr } = await supabase
      .schema('studio')
      .from('scenes')
      .update(update)
      .eq('id', sceneId)
      .eq('storyboard_id', storyboardId)
      .select('id, order')
      .single();

    if (updateErr || !scene) {
      return NextResponse.json(
        { error: 'Scene not found or update failed' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      scene_id: scene.id,
      sort_order: scene.order,
      status: 'updated',
    });
  } catch (err) {
    console.error('[scenes/update] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/v2/storyboard/[id]/scenes/[sceneId] — Delete a scene
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: storyboardId, sceneId } = await context.params;
    const supabase = createServiceClient();

    // Check storyboard is draft
    const { data: storyboard } = await supabase
      .schema('studio')
      .from('storyboards')
      .select('plan_status')
      .eq('id', storyboardId)
      .single();

    if (!storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    if (storyboard.plan_status === 'approved') {
      return NextResponse.json(
        { error: 'Cannot delete scenes from an approved storyboard' },
        { status: 400 }
      );
    }

    const { error: deleteErr } = await supabase
      .schema('studio')
      .from('scenes')
      .delete()
      .eq('id', sceneId)
      .eq('storyboard_id', storyboardId);

    if (deleteErr) {
      return NextResponse.json(
        { error: 'Failed to delete scene' },
        { status: 500 }
      );
    }

    // Check if storyboard still has scenes — if not, revert to empty
    const { count } = await supabase
      .schema('studio')
      .from('scenes')
      .select('id', { count: 'exact', head: true })
      .eq('storyboard_id', storyboardId);

    if (count === 0) {
      await supabase
        .schema('studio')
        .from('storyboards')
        .update({ plan_status: 'empty' })
        .eq('id', storyboardId)
        .eq('plan_status', 'draft');
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[scenes/delete] Error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
