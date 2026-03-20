import { createClient } from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

// GET - Fetch all tags for the user, grouped by account_uuid
export async function GET() {
  try {
    const supabase = await createClient('social_auth');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: rows, error } = await supabase
      .from('account_tags')
      .select('account_uuid, tag')
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
      if (!tags[row.account_uuid]) {
        tags[row.account_uuid] = [];
      }
      tags[row.account_uuid].push(row.tag);
    }

    return NextResponse.json({ tags });
  } catch (error) {
    console.error('Fetch tags error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Add a tag to an account
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient('social_auth');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { account_uuid, tag } = await req.json();

    if (!account_uuid || typeof account_uuid !== 'string') {
      return NextResponse.json(
        { error: 'account_uuid is required' },
        { status: 400 }
      );
    }

    if (!tag || typeof tag !== 'string' || tag.trim().length === 0) {
      return NextResponse.json({ error: 'tag is required' }, { status: 400 });
    }

    const { error } = await supabase.from('account_tags').insert({
      user_id: user.id,
      account_uuid,
      tag: tag.trim().toLowerCase(),
    });

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Tag already exists for this account' },
          { status: 409 }
        );
      }
      console.error('Database error:', error);
      return NextResponse.json({ error: 'Failed to add tag' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Add tag error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Remove a tag from an account
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient('social_auth');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const account_uuid = searchParams.get('account_uuid');
    const tag = searchParams.get('tag');

    if (!account_uuid) {
      return NextResponse.json(
        { error: 'account_uuid is required' },
        { status: 400 }
      );
    }

    if (!tag) {
      return NextResponse.json({ error: 'tag is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('account_tags')
      .delete()
      .eq('user_id', user.id)
      .eq('account_uuid', account_uuid)
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
    console.error('Remove tag error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
