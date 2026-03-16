import { createClient } from '@/lib/supabase/server';
import {
  bindCharacterToProject,
  getProjectCharacters,
  unbindCharacterFromProject,
} from '@/lib/supabase/character-service';
import { type NextRequest, NextResponse } from 'next/server';

// GET /api/characters/project?project_id=xxx — get characters bound to a project
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get('project_id');
    if (!projectId) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    const projectCharacters = await getProjectCharacters(supabase, projectId);
    return NextResponse.json({ project_characters: projectCharacters });
  } catch (error) {
    console.error('Get project characters error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/characters/project — bind a character to a project
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
    const { project_id, character_id, element_index, role } = body;

    if (!project_id || !character_id || element_index == null) {
      return NextResponse.json(
        {
          error: 'project_id, character_id, and element_index are required',
        },
        { status: 400 }
      );
    }

    if (!Number.isInteger(element_index) || element_index < 1) {
      return NextResponse.json(
        { error: 'element_index must be a positive integer' },
        { status: 400 }
      );
    }

    const binding = await bindCharacterToProject(supabase, {
      project_id,
      character_id,
      element_index,
      role,
    });

    return NextResponse.json({ project_character: binding }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    console.error('Bind character error:', error);
    return NextResponse.json(
      { error: message },
      { status: message.includes('not found') ? 404 : 500 }
    );
  }
}

// DELETE /api/characters/project — unbind a character from a project
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { project_id, character_id } = body;

    if (!project_id || !character_id) {
      return NextResponse.json(
        { error: 'project_id and character_id are required' },
        { status: 400 }
      );
    }

    await unbindCharacterFromProject(supabase, project_id, character_id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unbind character error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
