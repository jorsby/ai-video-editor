import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { toApiMusic } from '@/lib/api/v2-project-music';
import { createServiceClient } from '@/lib/supabase/admin';
import {
  MusicSPSchema,
  EXPECTED_MUSIC_SP,
  validateStructuredPrompt,
} from '@/lib/api/structured-prompt-schemas';

type RouteContext = { params: Promise<{ id: string }> };

const MUSIC_SELECT =
  'id, project_id, video_id, title, structured_prompt, audio_url, cover_image_url, duration, status, task_id, generation_metadata, sort_order, created_at, updated_at';

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

function _parseNullableText(
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
    .from('musics')
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

    return NextResponse.json(toApiMusic(owned.music as never));
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

    const currentSp =
      owned.music.structured_prompt &&
      typeof owned.music.structured_prompt === 'object' &&
      !Array.isArray(owned.music.structured_prompt)
        ? (owned.music.structured_prompt as Record<string, unknown>)
        : {};
    const nextSp: Record<string, unknown> = { ...currentSp };
    let spTouched = false;

    if (body.name !== undefined) {
      const parsed = parseRequiredText(body.name, 'name');
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      if (body.title === undefined) {
        updates.title = parsed.value;
      }
    }

    // Typed-field patches: overlay any MusicSP fields onto the existing SP,
    // then validate the merged object against the strict discriminated union.
    const MUSIC_SP_KEYS = new Set([
      'is_instrumental',
      'genre',
      'mood',
      'instrumentation',
      'tempo_bpm',
      'lyrics',
    ]);
    for (const key of MUSIC_SP_KEYS) {
      if (body[key] === undefined) continue;
      if (body[key] === null) delete nextSp[key];
      else nextSp[key] = body[key];
      spTouched = true;
    }

    if (body.title !== undefined) {
      const parsed = parseRequiredText(body.title, 'title');
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      updates.title = parsed.value;
    }

    if (spTouched) {
      const validation = validateStructuredPrompt(
        MusicSPSchema,
        nextSp,
        EXPECTED_MUSIC_SP,
        'structured_prompt'
      );
      if (!validation.ok) return validation.response;
      updates.structured_prompt = validation.value;
    }

    if (body.video_id !== undefined) {
      if (body.video_id !== null) {
        if (typeof body.video_id !== 'string') {
          return NextResponse.json(
            { error: 'video_id must be a UUID string or null' },
            { status: 400 }
          );
        }
        const { data: video } = await db
          .from('videos')
          .select('id, project_id')
          .eq('id', body.video_id)
          .maybeSingle();
        if (!video || video.project_id !== owned.music.project_id) {
          return NextResponse.json(
            { error: 'video_id must reference a video in the same project' },
            { status: 400 }
          );
        }
        updates.video_id = body.video_id;
      } else {
        updates.video_id = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await db
      .from('musics')
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

    return NextResponse.json(toApiMusic(updated as never));
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

    const { error } = await db.from('musics').delete().eq('id', id);

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
