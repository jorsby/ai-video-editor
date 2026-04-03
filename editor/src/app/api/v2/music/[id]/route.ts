import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

const MUSIC_SELECT =
  'id, project_id, name, music_type, prompt, style, title, audio_url, cover_image_url, duration, status, task_id, suno_track_id, generation_metadata, sort_order, created_at, updated_at';

type OwnedMusic = {
  id: string;
  project_id: string;
} & Record<string, unknown>;

type OwnedMusicLookup =
  | {
      music: OwnedMusic;
      error?: undefined;
    }
  | {
      music?: undefined;
      error: NextResponse;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseRequiredText(
  value: unknown,
  fieldName: string
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== 'string') {
    return { ok: false, error: `${fieldName} must be a non-empty string` };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: `${fieldName} must be a non-empty string` };
  }

  return { ok: true, value: trimmed };
}

function parseNullableText(
  value: unknown,
  fieldName: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== 'string') {
    return { ok: false, error: `${fieldName} must be a string or null` };
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

async function getOwnedMusic(
  db: ReturnType<typeof createServiceClient>,
  musicId: string,
  userId: string
): Promise<OwnedMusicLookup> {
  const { data: music, error: musicError } = await db
    .from('project_music')
    .select(MUSIC_SELECT)
    .eq('id', musicId)
    .maybeSingle();

  if (musicError || !music) {
    return {
      error: NextResponse.json(
        { error: 'Music track not found' },
        { status: 404 }
      ),
    };
  }

  const { data: project, error: projectError } = await db
    .from('projects')
    .select('id, user_id')
    .eq('id', music.project_id)
    .maybeSingle();

  if (projectError || !project) {
    return {
      error: NextResponse.json({ error: 'Project not found' }, { status: 404 }),
    };
  }

  if (project.user_id !== userId) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  return { music: music as OwnedMusic };
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedMusic(db, id, user.id);
    if (owned.error) return owned.error;

    return NextResponse.json(owned.music);
  } catch (error) {
    console.error('[v2/music/:id][GET] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: partial update validation
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json(
        { error: 'Body must be a JSON object' },
        { status: 400 }
      );
    }

    const { id } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedMusic(db, id, user.id);
    if (owned.error) return owned.error;

    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const parsed = parseRequiredText(body.name, 'name');
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      updates.name = parsed.value;
    }

    if (body.prompt !== undefined) {
      const parsed = parseNullableText(body.prompt, 'prompt');
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      updates.prompt = parsed.value;
    }

    if (body.style !== undefined) {
      const parsed = parseRequiredText(body.style, 'style');
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      updates.style = parsed.value;
    }

    if (body.title !== undefined) {
      const parsed = parseRequiredText(body.title, 'title');
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      updates.title = parsed.value;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await db
      .from('project_music')
      .update(updates)
      .eq('id', id)
      .select(MUSIC_SELECT)
      .single();

    if (updateError || !updated) {
      console.error(
        '[v2/music/:id][PATCH] Failed to update track:',
        updateError
      );
      return NextResponse.json(
        { error: 'Failed to update music track' },
        { status: 500 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[v2/music/:id][PATCH] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedMusic(db, id, user.id);
    if (owned.error) return owned.error;

    const { error } = await db.from('project_music').delete().eq('id', id);

    if (error) {
      console.error('[v2/music/:id][DELETE] Failed to delete track:', error);
      return NextResponse.json(
        { error: 'Failed to delete music track' },
        { status: 500 }
      );
    }

    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    console.error('[v2/music/:id][DELETE] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
