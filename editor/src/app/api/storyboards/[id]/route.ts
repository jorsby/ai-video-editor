import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import { klingO3PlanSchema } from '@/lib/schemas/kling-o3-plan';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/storyboards/[id]
 *
 * Get a storyboard by ID with its scenes.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
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

    const { data: storyboard, error } = await dbClient
      .from('storyboards')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ storyboard });
  } catch (error) {
    console.error('Get storyboard error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/storyboards/[id]
 *
 * Update a storyboard.
 *
 * Body: { title?, input_type?, is_active?, sort_order? }
 */
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
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

    // Get the storyboard to verify it exists
    const { data: existing } = await dbClient
      .from('storyboards')
      .select('id, project_id, plan_status, plan')
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.title !== undefined) updates.title = body.title?.trim() || null;
    if (body.input_type !== undefined) {
      if (!['voiceover_script', 'cinematic_flow'].includes(body.input_type)) {
        return NextResponse.json(
          {
            error: 'input_type must be "voiceover_script" or "cinematic_flow"',
          },
          { status: 400 }
        );
      }
      updates.input_type = body.input_type;
    }
    if (body.sort_order !== undefined) updates.sort_order = body.sort_order;

    // Handle plan update (fill empty storyboard or update existing plan)
    if (body.plan !== undefined) {
      const planParsed = klingO3PlanSchema.safeParse(body.plan);
      if (!planParsed.success) {
        return NextResponse.json(
          {
            error: `Invalid plan: ${planParsed.error.issues[0]?.message ?? 'validation failed'}`,
          },
          { status: 400 }
        );
      }
      updates.plan = planParsed.data;
      // Move from 'empty' to 'draft' when plan is provided
      if (existing.plan_status === 'empty' || !existing.plan) {
        updates.plan_status = 'draft';
      }
      // Update voiceover text from plan
      const firstLang = Object.keys(planParsed.data.voiceover_list)[0] ?? 'en';
      updates.voiceover = (
        planParsed.data.voiceover_list[firstLang] ?? []
      ).join('\n');
    }

    // Handle is_active (deactivate others first)
    if (body.is_active === true) {
      await dbClient
        .from('storyboards')
        .update({ is_active: false })
        .eq('project_id', existing.project_id);
      updates.is_active = true;
    } else if (body.is_active === false) {
      updates.is_active = false;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data: storyboard, error } = await dbClient
      .from('storyboards')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Update storyboard error:', error);
      return NextResponse.json(
        { error: 'Failed to update storyboard' },
        { status: 500 }
      );
    }

    return NextResponse.json({ storyboard });
  } catch (error) {
    console.error('Update storyboard error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/storyboards/[id]
 *
 * Delete a storyboard and all its scenes.
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
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

    const { error } = await dbClient.from('storyboards').delete().eq('id', id);

    if (error) {
      console.error('Delete storyboard error:', error);
      return NextResponse.json(
        { error: 'Failed to delete storyboard' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete storyboard error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
