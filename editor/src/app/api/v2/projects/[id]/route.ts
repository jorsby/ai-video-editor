import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

type OwnedProjectLookup =
  | {
      project: {
        id: string;
        user_id: string;
      };
      error?: undefined;
    }
  | {
      project?: undefined;
      error: NextResponse;
    };

function parsePatchDescription(
  value: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, error: 'description must be a string or null' };
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

async function getOwnedProject(
  db: ReturnType<typeof createServiceClient>,
  projectId: string,
  userId: string
): Promise<OwnedProjectLookup> {
  const { data: project, error } = await db
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .maybeSingle();

  if (error || !project) {
    return {
      error: NextResponse.json({ error: 'Project not found' }, { status: 404 }),
    };
  }

  if (project.user_id !== userId) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  return { project };
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedProject(db, id, user.id);
    if (owned.error) return owned.error;

    const { data: project, error } = await db
      .from('projects')
      .select('id, name, description, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error('[v2/projects/:id][GET] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json(
          { error: 'name must be a non-empty string' },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }

    if (body?.description !== undefined) {
      const parsedDescription = parsePatchDescription(body.description);
      if (!parsedDescription.ok) {
        return NextResponse.json(
          { error: parsedDescription.error },
          { status: 400 }
        );
      }
      updates.description = parsedDescription.value;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedProject(db, id, user.id);
    if (owned.error) return owned.error;

    const { data: project, error } = await db
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select('id, name, description, created_at, updated_at')
      .single();

    if (error || !project) {
      console.error(
        '[v2/projects/:id][PATCH] Failed to update project:',
        error
      );
      return NextResponse.json(
        { error: 'Failed to update project' },
        { status: 500 }
      );
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error('[v2/projects/:id][PATCH] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/v2/projects/{id}
// Hard-deletes a project and everything under it (cascade: video → assets → variants → chapters → scenes).
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedProject(db, id, user.id);
    if (owned.error) return owned.error;

    const { error } = await db.from('projects').delete().eq('id', id);

    if (error) {
      console.error(
        '[v2/projects/:id][DELETE] Failed to delete project:',
        error
      );
      return NextResponse.json(
        { error: 'Failed to delete project' },
        { status: 500 }
      );
    }

    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    console.error('[v2/projects/:id][DELETE] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
