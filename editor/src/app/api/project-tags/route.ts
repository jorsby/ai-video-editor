import { createClient } from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

// GET - Fetch all tags for the user, grouped by project_id
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: rows, error } = await supabase
      .from('project_tags')
      .select('project_id, tag')
      .eq('user_id', user.id);

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch tags' },
        { status: 500 }
      );
    }

    const tags: Record<string, string[]> = {};
    for (const row of rows ?? []) {
      if (!tags[row.project_id]) {
        tags[row.project_id] = [];
      }
      tags[row.project_id].push(row.tag);
    }

    return NextResponse.json({ tags });
  } catch (error) {
    console.error('Fetch project tags error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Add a tag to a project
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { project_id, tag } = await req.json();

    if (!project_id || typeof project_id !== 'string') {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    if (!tag || typeof tag !== 'string' || tag.trim().length === 0) {
      return NextResponse.json(
        { error: 'tag is required' },
        { status: 400 }
      );
    }

    const { error } = await supabase.from('project_tags').insert({
      user_id: user.id,
      project_id,
      tag: tag.trim().toLowerCase(),
    });

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Tag already exists for this project' },
          { status: 409 }
        );
      }
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to add tag' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Add project tag error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Remove a tag from a project
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const project_id = searchParams.get('project_id');
    const tag = searchParams.get('tag');

    if (!project_id) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    if (!tag) {
      return NextResponse.json(
        { error: 'tag is required' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('project_tags')
      .delete()
      .eq('user_id', user.id)
      .eq('project_id', project_id)
      .eq('tag', tag);

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to remove tag' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Remove project tag error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
