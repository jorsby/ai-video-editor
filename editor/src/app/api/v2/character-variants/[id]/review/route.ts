import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v2/character-variants/{id}/review
 *
 * Body:
 *   is_reviewed: boolean
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id: variantId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    if (typeof body.is_reviewed !== 'boolean') {
      return NextResponse.json(
        { error: 'is_reviewed must be a boolean' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient('studio');

    const { data: variant } = await supabase
      .from('project_character_variants')
      .select('id, character_id')
      .eq('id', variantId)
      .maybeSingle();

    if (!variant) {
      return NextResponse.json(
        { error: 'Character variant not found' },
        { status: 404 }
      );
    }

    const { data: character } = await supabase
      .from('project_characters')
      .select('id, project_id')
      .eq('id', variant.character_id)
      .maybeSingle();

    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      );
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', character.project_id)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: updated, error } = await supabase
      .from('project_character_variants')
      .update({ is_reviewed: body.is_reviewed })
      .eq('id', variantId)
      .select('*')
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { error: 'Failed to update character variant review state' },
        { status: 500 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[v2/character-variants/:id/review] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
