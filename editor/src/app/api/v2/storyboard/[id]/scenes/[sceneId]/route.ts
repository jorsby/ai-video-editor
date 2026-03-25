import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

const updateSceneBodySchema = z.object({
  sort_order: z.number().int().min(1).optional(),
  audio_text: z.string().optional(),
  visual_direction: z.string().optional(),
  prompt: z.string().optional(),
  duration: z.literal(6).or(z.literal(10)).optional(),
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

    // Build update payload
    const update: Record<string, unknown> = {};
    if (data.sort_order !== undefined) update.order = data.sort_order;
    if (data.audio_text !== undefined) update.audio_text = data.audio_text;
    if (data.visual_direction !== undefined)
      update.visual_direction = data.visual_direction;
    if (data.prompt !== undefined) update.prompt = data.prompt;
    if (data.duration !== undefined) update.duration = data.duration;
    if (data.background_name !== undefined)
      update.background_name = data.background_name;
    if (data.object_names !== undefined)
      update.object_names = data.object_names;
    if (data.language !== undefined) update.language = data.language;

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
        { error: 'Cannot delete scenes from approved storyboard' },
        { status: 409 }
      );
    }

    if (
      storyboard.plan_status !== 'draft' &&
      storyboard.plan_status !== 'empty'
    ) {
      return NextResponse.json(
        {
          error: 'Scenes can only be deleted when storyboard is draft or empty',
        },
        { status: 409 }
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
