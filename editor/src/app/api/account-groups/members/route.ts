import { createClient } from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

// POST - Add an account to a group
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { group_id, account_uuid } = await req.json();

    if (!group_id || !account_uuid) {
      return NextResponse.json(
        { error: 'group_id and account_uuid are required' },
        { status: 400 }
      );
    }

    // Verify the group belongs to this user
    const { data: group } = await supabase
      .from('account_groups')
      .select('id')
      .eq('id', group_id)
      .eq('user_id', user.id)
      .single();

    if (!group) {
      return NextResponse.json(
        { error: 'Group not found' },
        { status: 404 }
      );
    }

    const { data: member, error } = await supabase
      .from('account_group_members')
      .insert({ group_id, account_uuid })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Account already in group' },
          { status: 409 }
        );
      }
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to add account to group' },
        { status: 500 }
      );
    }

    return NextResponse.json({ member });
  } catch (error) {
    console.error('Add member error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Remove an account from a group
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
    const group_id = searchParams.get('group_id');
    const account_uuid = searchParams.get('account_uuid');

    if (!group_id || !account_uuid) {
      return NextResponse.json(
        { error: 'group_id and account_uuid are required' },
        { status: 400 }
      );
    }

    // Verify ownership through the group
    const { data: group } = await supabase
      .from('account_groups')
      .select('id')
      .eq('id', group_id)
      .eq('user_id', user.id)
      .single();

    if (!group) {
      return NextResponse.json(
        { error: 'Group not found' },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from('account_group_members')
      .delete()
      .eq('group_id', group_id)
      .eq('account_uuid', account_uuid);

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to remove account from group' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Remove member error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
