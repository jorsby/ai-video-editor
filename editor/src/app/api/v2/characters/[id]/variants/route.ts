import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { slugify } from '@/lib/utils/slugify';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/characters/{id}/variants
 *
 * Creates one or many character variants.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: characterId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    const { data: character } = await supabase
      .from('project_characters')
      .select('id, project_id')
      .eq('id', characterId)
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

    const body = await req.json().catch(() => null);
    const isBatch = Array.isArray(body);
    const items: Array<{
      name?: unknown;
      slug?: unknown;
      prompt?: unknown;
      is_main?: unknown;
    }> = isBatch ? body : body ? [body] : [];

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'At least one variant is required' },
        { status: 400 }
      );
    }

    const createdRows: Array<Record<string, unknown>> = [];

    for (const item of items) {
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name) {
        return NextResponse.json(
          { error: 'Each variant must have a non-empty name' },
          { status: 400 }
        );
      }

      const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
      const slugSource = name || prompt;

      const slug =
        typeof item.slug === 'string' && item.slug.trim().length > 0
          ? item.slug.trim()
          : slugify(slugSource);

      if (!slug) {
        return NextResponse.json(
          { error: `Could not generate slug for variant "${name}"` },
          { status: 400 }
        );
      }

      const isMain = item.is_main === true;

      if (isMain) {
        await supabase
          .from('project_character_variants')
          .update({ is_main: false })
          .eq('character_id', characterId)
          .eq('is_main', true);
      }

      const { data: created, error: insertError } = await supabase
        .from('project_character_variants')
        .insert({
          character_id: characterId,
          name,
          slug,
          prompt,
          is_main: isMain,
        })
        .select('*')
        .single();

      if (insertError || !created) {
        if (insertError?.code === '23505') {
          return NextResponse.json(
            { error: 'Variant slug already exists' },
            { status: 409 }
          );
        }

        return NextResponse.json(
          { error: 'Failed to create variant(s)' },
          { status: 500 }
        );
      }

      createdRows.push(created as Record<string, unknown>);
    }

    return NextResponse.json(createdRows, { status: 201 });
  } catch (error) {
    console.error('[v2/characters/:id/variants] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
