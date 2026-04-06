import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

type ContentMode = 'narrative' | 'cinematic' | 'hybrid';
type PlanStatus = 'draft' | 'finalized';

const CONTENT_MODES: ContentMode[] = ['narrative', 'cinematic', 'hybrid'];
const PLAN_STATUSES: PlanStatus[] = ['draft', 'finalized'];
const SERIES_SELECT =
  'id, project_id, user_id, name, genre, tone, bible, content_mode, language, aspect_ratio, video_model, image_model, voice_id, tts_speed, visual_style, creative_brief, plan_status, created_at, updated_at';

type OwnedVideoLookup =
  | {
      video: {
        id: string;
        user_id: string;
      };
      error?: undefined;
    }
  | {
      video?: undefined;
      error: NextResponse;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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

async function getOwnedVideo(
  db: ReturnType<typeof createServiceClient>,
  videoId: string,
  userId: string
): Promise<OwnedVideoLookup> {
  const { data: video, error } = await db
    .from('videos')
    .select('id, user_id')
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
      .select(SERIES_SELECT)
      .eq('id', id)
      .single();

    if (error || !video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    return NextResponse.json(video);
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
    const updates: Record<string, unknown> = {};

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
      updates.project_id = body.project_id.trim();
    }

    if (body?.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json(
          { error: 'name must be a non-empty string' },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }

    const nullableTextFields = [
      'genre',
      'tone',
      'bible',
      'language',
      'aspect_ratio',
      'video_model',
      'image_model',
      'voice_id',
      'visual_style',
    ] as const;

    for (const field of nullableTextFields) {
      if (body?.[field] !== undefined) {
        const parsed = parseNullableText(body[field], field);
        if (!parsed.ok) {
          return NextResponse.json({ error: parsed.error }, { status: 400 });
        }
        updates[field] = parsed.value;
      }
    }

    if (body?.content_mode !== undefined) {
      if (
        typeof body.content_mode !== 'string' ||
        !CONTENT_MODES.includes(body.content_mode as ContentMode)
      ) {
        return NextResponse.json(
          {
            error:
              "content_mode must be one of 'narrative', 'cinematic', or 'hybrid'",
          },
          { status: 400 }
        );
      }
      updates.content_mode = body.content_mode;
    }

    if (body?.plan_status !== undefined) {
      if (
        typeof body.plan_status !== 'string' ||
        !PLAN_STATUSES.includes(body.plan_status as PlanStatus)
      ) {
        return NextResponse.json(
          { error: "plan_status must be one of 'draft' or 'finalized'" },
          { status: 400 }
        );
      }
      updates.plan_status = body.plan_status;
    }

    if (body?.tts_speed !== undefined) {
      if (
        body.tts_speed !== null &&
        (typeof body.tts_speed !== 'number' || !Number.isFinite(body.tts_speed))
      ) {
        return NextResponse.json(
          { error: 'tts_speed must be a finite number or null' },
          { status: 400 }
        );
      }
      updates.tts_speed = body.tts_speed;
    }

    if (body?.creative_brief !== undefined) {
      if (body.creative_brief !== null && !isRecord(body.creative_brief)) {
        return NextResponse.json(
          { error: 'creative_brief must be an object or null' },
          { status: 400 }
        );
      }
      updates.creative_brief = body.creative_brief;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedVideo(db, id, user.id);
    if (owned.error) return owned.error;

    if (updates.project_id) {
      const { data: project, error: projectError } = await db
        .from('projects')
        .select('id')
        .eq('id', updates.project_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (projectError || !project) {
        return NextResponse.json(
          { error: 'Project not found' },
          { status: 404 }
        );
      }
    }

    const { data: video, error } = await db
      .from('videos')
      .update(updates)
      .eq('id', id)
      .select(SERIES_SELECT)
      .single();

    if (error || !video) {
      console.error('[v2/video/:id][PATCH] Failed to update video:', error);
      return NextResponse.json(
        { error: 'Failed to update video' },
        { status: 500 }
      );
    }

    return NextResponse.json(video);
  } catch (error) {
    console.error('[v2/video/:id][PATCH] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/v2/videos/{id}
// Hard-deletes a video and everything under it (cascade: assets → variants → chapters → scenes).
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
