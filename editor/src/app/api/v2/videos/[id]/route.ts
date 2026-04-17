import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

const VIDEO_SELECT =
  'id, project_id, user_id, name, synopsis, created_at, updated_at';

// Keys in `projects.generation_settings` that callers address through this route.
const GENERATION_SETTINGS_KEYS = [
  'language',
  'voice_id',
  'tts_speed',
  'video_model',
  'video_resolution',
  'aspect_ratio',
  'image_models',
  'creative_brief',
  'visual_style',
  'genre',
  'tone',
  'content_mode',
  'plan_status',
  'bible',
] as const;

type OwnedVideoLookup =
  | {
      video: { id: string; user_id: string; project_id: string };
      error?: undefined;
    }
  | { video?: undefined; error: NextResponse };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function getOwnedVideo(
  db: ReturnType<typeof createServiceClient>,
  videoId: string,
  userId: string
): Promise<OwnedVideoLookup> {
  const { data: video, error } = await db
    .from('videos')
    .select('id, user_id, project_id')
    .eq('id', videoId)
    .maybeSingle();

  if (error || !video) {
    return {
      error: NextResponse.json({ error: 'Video not found' }, { status: 404 }),
    };
  }

  if (video.user_id !== userId) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  return { video };
}

async function loadGenerationSettings(
  db: ReturnType<typeof createServiceClient>,
  projectId: string
): Promise<Record<string, unknown>> {
  const { data } = await db
    .from('projects')
    .select('generation_settings')
    .eq('id', projectId)
    .maybeSingle();
  return isRecord(data?.generation_settings) ? data.generation_settings : {};
}

function mergeVideoWithSettings(
  video: Record<string, unknown>,
  settings: Record<string, unknown>
) {
  const flat: Record<string, unknown> = { ...video };
  for (const key of GENERATION_SETTINGS_KEYS) {
    if (settings[key] !== undefined) flat[key] = settings[key];
  }
  return flat;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedVideo(db, id, user.id);
    if (owned.error) return owned.error;

    const { data: video, error } = await db
      .from('videos')
      .select(VIDEO_SELECT)
      .eq('id', id)
      .single();

    if (error || !video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const settings = await loadGenerationSettings(db, owned.video.project_id);
    return NextResponse.json(
      mergeVideoWithSettings(video as Record<string, unknown>, settings)
    );
  } catch (error) {
    console.error('[v2/video/:id][GET] Unexpected error:', error);
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

    // Split incoming fields: video columns vs. project.generation_settings keys.
    const videoUpdates: Record<string, unknown> = {};
    const settingsPatch: Record<string, unknown> = {};

    if (body?.project_id !== undefined) {
      if (
        typeof body.project_id !== 'string' ||
        body.project_id.trim() === ''
      ) {
        return NextResponse.json(
          { error: 'project_id must be a non-empty string' },
          { status: 400 }
        );
      }
      videoUpdates.project_id = body.project_id.trim();
    }

    if (body?.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json(
          { error: 'name must be a non-empty string' },
          { status: 400 }
        );
      }
      videoUpdates.name = body.name.trim();
    }

    if (body?.synopsis !== undefined) {
      if (body.synopsis !== null && typeof body.synopsis !== 'string') {
        return NextResponse.json(
          { error: 'synopsis must be a string or null' },
          { status: 400 }
        );
      }
      videoUpdates.synopsis =
        typeof body.synopsis === 'string' ? body.synopsis.trim() : null;
    }

    // Everything else that matches a generation_settings key goes into
    // projects.generation_settings (merge semantics, null deletes).
    for (const key of GENERATION_SETTINGS_KEYS) {
      if (body?.[key] === undefined) continue;
      settingsPatch[key] = body[key];
    }

    if (
      Object.keys(videoUpdates).length === 0 &&
      Object.keys(settingsPatch).length === 0
    ) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedVideo(db, id, user.id);
    if (owned.error) return owned.error;

    if (videoUpdates.project_id) {
      const { data: project, error: projectError } = await db
        .from('projects')
        .select('id')
        .eq('id', videoUpdates.project_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (projectError || !project) {
        return NextResponse.json(
          { error: 'Project not found' },
          { status: 404 }
        );
      }
    }

    if (Object.keys(settingsPatch).length > 0) {
      const targetProjectId =
        (videoUpdates.project_id as string | undefined) ??
        owned.video.project_id;
      const current = await loadGenerationSettings(db, targetProjectId);
      const next: Record<string, unknown> = { ...current };
      for (const [k, v] of Object.entries(settingsPatch)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      const { error: settingsErr } = await db
        .from('projects')
        .update({ generation_settings: next })
        .eq('id', targetProjectId);
      if (settingsErr) {
        console.error(
          '[v2/video/:id][PATCH] Failed to update generation_settings:',
          settingsErr
        );
        return NextResponse.json(
          { error: 'Failed to update project settings' },
          { status: 500 }
        );
      }
    }

    if (Object.keys(videoUpdates).length > 0) {
      const { error } = await db
        .from('videos')
        .update(videoUpdates)
        .eq('id', id);

      if (error) {
        console.error('[v2/video/:id][PATCH] Failed to update video:', error);
        return NextResponse.json(
          { error: 'Failed to update video' },
          { status: 500 }
        );
      }
    }

    // Return the merged shape (old clients expect the legacy fields).
    const { data: video } = await db
      .from('videos')
      .select(VIDEO_SELECT)
      .eq('id', id)
      .single();

    const projectIdForSettings =
      (video?.project_id as string | undefined) ?? owned.video.project_id;
    const settings = await loadGenerationSettings(db, projectIdForSettings);

    return NextResponse.json(
      mergeVideoWithSettings((video ?? {}) as Record<string, unknown>, settings)
    );
  } catch (error) {
    console.error('[v2/video/:id][PATCH] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/v2/videos/{id} — hard-deletes a video (cascade handles chapters/scenes).
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedVideo(db, id, user.id);
    if (owned.error) return owned.error;

    const { error } = await db.from('videos').delete().eq('id', id);

    if (error) {
      console.error('[v2/video/:id][DELETE] Failed to delete video:', error);
      return NextResponse.json(
        { error: 'Failed to delete video' },
        { status: 500 }
      );
    }

    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    console.error('[v2/video/:id][DELETE] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
