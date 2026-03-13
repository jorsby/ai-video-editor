import { createClient } from '@/lib/supabase/server';
import {
  createCharacter,
  listCharacters,
} from '@/lib/supabase/character-service';
import { type NextRequest, NextResponse } from 'next/server';

// GET /api/characters — list all characters for the authenticated user
export async function GET() {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await listCharacters(supabase, user.id);
    return NextResponse.json({ characters });
  } catch (error) {
    console.error('List characters error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/characters — create a new character
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
    const { name, description, tags } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const character = await createCharacter(supabase, user.id, {
      name: name.trim(),
      description: description?.trim() || undefined,
      tags: Array.isArray(tags) ? tags : undefined,
    });

    return NextResponse.json({ character }, { status: 201 });
  } catch (error) {
    console.error('Create character error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
