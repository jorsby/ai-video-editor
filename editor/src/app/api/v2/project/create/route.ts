import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const description =
      typeof body?.description === 'string' ? body.description.trim() : '';

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const db = createServiceClient('studio');

    const { data: project, error: projectError } = await db
      .from('projects')
      .insert({
        user_id: user.id,
        name,
        settings: {
          description: description || null,
        },
      })
      .select('id')
      .single();

    if (projectError || !project?.id) {
      console.error(
        '[v2/project/create] Failed to create project:',
        projectError
      );
      return NextResponse.json(
        { error: 'Failed to create project' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { project_id: project.id as string },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v2/project/create] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
