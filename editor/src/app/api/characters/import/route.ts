import { createClient } from '@/lib/supabase/server';
import { importCharacterFromObject } from '@/lib/supabase/character-service';
import { type NextRequest, NextResponse } from 'next/server';

// POST /api/characters/import — import a character from a project object
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { object_id, name, description, tags } = body;

    if (!object_id) {
      return NextResponse.json(
        { error: 'object_id is required' },
        { status: 400 }
      );
    }

    const character = await importCharacterFromObject(supabase, user.id, {
      object_id,
      name: name?.trim() || undefined,
      description: description?.trim() || undefined,
      tags: Array.isArray(tags) ? tags : undefined,
    });

    return NextResponse.json({ character }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    console.error('Import character error:', error);
    return NextResponse.json(
      { error: message },
      { status: message.includes('not found') ? 404 : 500 }
    );
  }
}
