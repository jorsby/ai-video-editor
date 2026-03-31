import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

function parseOptionalDescription(
  value: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: null };
  }

  if (value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== 'string') {
    return { ok: false, error: 'description must be a string or null' };
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

export async function GET(req: NextRequest) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');

    const { data: projects, error } = await db
      .from('projects')
      .select('id, name, description, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[v2/projects][GET] Failed to list projects:', error);
      return NextResponse.json(
        { error: 'Failed to list projects' },
        { status: 500 }
      );
    }

    return NextResponse.json(projects ?? []);
  } catch (error) {
    console.error('[v2/projects][GET] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const descriptionResult = parseOptionalDescription(body?.description);
    if (!descriptionResult.ok) {
      return NextResponse.json(
        { error: descriptionResult.error },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');

    const { data: project, error } = await db
      .from('projects')
      .insert({
        user_id: user.id,
        name,
        description: descriptionResult.value,
      })
      .select('id, name, description, created_at, updated_at')
      .single();

    if (error || !project) {
      console.error('[v2/projects][POST] Failed to create project:', error);
      return NextResponse.json(
        { error: 'Failed to create project' },
        { status: 500 }
      );
    }

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('[v2/projects][POST] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
