import { createClient } from '@/lib/supabase/server';
import {
  deleteCharacter,
  getCharacter,
  updateCharacter,
} from '@/lib/supabase/character-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/characters/[id] — get character with all images
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const character = await getCharacter(supabase, id, user.id);
    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ character });
  } catch (error) {
    console.error('Get character error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/characters/[id] — update character name/description/tags
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Name cannot be empty' },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }
    if (body.description !== undefined) {
      updates.description = body.description?.trim() || null;
    }
    if (body.tags !== undefined) {
      updates.tags = Array.isArray(body.tags) ? body.tags : [];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const character = await updateCharacter(supabase, id, user.id, updates);
    return NextResponse.json({ character });
  } catch (error) {
    console.error('Update character error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/characters/[id] — delete character and all images
export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify ownership before deleting storage assets
    const character = await getCharacter(supabase, id, user.id);
    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      );
    }

    // Delete storage folder for this character
    const storagePath = `${user.id}/${id}`;
    const { data: files } = await supabase.storage
      .from('character-assets')
      .list(storagePath);

    if (files && files.length > 0) {
      const paths = files.map(
        (f: { name: string }) => `${storagePath}/${f.name}`
      );
      await supabase.storage.from('character-assets').remove(paths);
    }

    // Delete character (cascades to images + project_characters)
    await deleteCharacter(supabase, id, user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete character error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
