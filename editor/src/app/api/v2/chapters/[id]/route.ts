import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

type ChapterStatus = 'draft' | 'ready' | 'in_progress' | 'done';

type AssetVariantMap = {
  characters: string[];
  locations: string[];
  props: string[];
};

const EPISODE_STATUSES: ChapterStatus[] = [
  'draft',
  'ready',
  'in_progress',
  'done',
];
const EPISODE_SELECT =
  'id, video_id, order, title, synopsis, audio_content, visual_outline, asset_variant_map, plan_json, status, created_at, updated_at';

type OwnedChapterLookup =
  | {
      chapter: {
        id: string;
        video_id: string;
      };
      error?: undefined;
    }
  | {
      chapter?: undefined;
      error: NextResponse;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseNullableText(
  value: unknown,
  fieldName: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, error: `${fieldName} must be a string or null` };
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

function parseAssetVariantMap(
  input: unknown
): { ok: true; value: AssetVariantMap } | { ok: false; error: string } {
  if (!isRecord(input)) {
    return {
      ok: false,
      error:
        'asset_variant_map must be an object with string arrays: characters, locations, props',
    };
  }

  const keys = ['characters', 'locations', 'props'] as const;
  const result: AssetVariantMap = {
    characters: [],
    locations: [],
    props: [],
  };

  for (const key of keys) {
    const value = input[key];
    if (
      !Array.isArray(value) ||
      !value.every((item) => typeof item === 'string')
    ) {
      return {
        ok: false,
        error:
          'asset_variant_map must be an object with string arrays: characters, locations, props',
      };
    }

    result[key] = value.map((item) => item.trim()).filter(Boolean);
  }

  return { ok: true, value: result };
}

async function getOwnedChapter(
  db: ReturnType<typeof createServiceClient>,
  chapterId: string,
  userId: string
): Promise<OwnedChapterLookup> {
  const { data: chapter, error: chapterError } = await db
    .from('chapters')
    .select('id, video_id')
    .eq('id', chapterId)
    .maybeSingle();

  if (chapterError || !chapter) {
    return {
      error: NextResponse.json({ error: 'Chapter not found' }, { status: 404 }),
    };
  }

  const { data: video, error: videoError } = await db
    .from('videos')
    .select('id, user_id')
    .eq('id', chapter.video_id)
    .maybeSingle();

  if (videoError || !video) {
    return {
      error: NextResponse.json({ error: 'Video not found' }, { status: 404 }),
    };
  }

  if (video.user_id !== userId) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  return { chapter };
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedChapter(db, id, user.id);
    if (owned.error) return owned.error;

    const { data: chapter, error } = await db
      .from('chapters')
      .select(EPISODE_SELECT)
      .eq('id', id)
      .single();

    if (error || !chapter) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }

    return NextResponse.json(chapter);
  } catch (error) {
    console.error('[v2/chapters/:id][GET] Unexpected error:', error);
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

    if (body?.order !== undefined) {
      if (
        typeof body.order !== 'number' ||
        !Number.isInteger(body.order) ||
        body.order < 1
      ) {
        return NextResponse.json(
          { error: 'order must be a positive integer' },
          { status: 400 }
        );
      }
      updates.order = body.order;
    }

    const nullableTextFields = [
      'title',
      'synopsis',
      'audio_content',
      'visual_outline',
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

    if (body?.asset_variant_map !== undefined) {
      const parsed = parseAssetVariantMap(body.asset_variant_map);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      updates.asset_variant_map = parsed.value;
    }

    if (body?.plan_json !== undefined) {
      if (body.plan_json !== null && !isRecord(body.plan_json)) {
        return NextResponse.json(
          { error: 'plan_json must be an object or null' },
          { status: 400 }
        );
      }
      updates.plan_json = body.plan_json;
    }

    if (body?.status !== undefined) {
      if (
        typeof body.status !== 'string' ||
        !EPISODE_STATUSES.includes(body.status as ChapterStatus)
      ) {
        return NextResponse.json(
          {
            error:
              "status must be one of 'draft', 'ready', 'in_progress', or 'done'",
          },
          { status: 400 }
        );
      }
      updates.status = body.status;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedChapter(db, id, user.id);
    if (owned.error) return owned.error;

    const { data: chapter, error } = await db
      .from('chapters')
      .update(updates)
      .eq('id', id)
      .select(EPISODE_SELECT)
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Chapter order already exists in this video' },
          { status: 409 }
        );
      }

      console.error(
        '[v2/chapters/:id][PATCH] Failed to update chapter:',
        error
      );
      return NextResponse.json(
        { error: 'Failed to update chapter' },
        { status: 500 }
      );
    }

    return NextResponse.json(chapter);
  } catch (error) {
    console.error('[v2/chapters/:id][PATCH] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedChapter(db, id, user.id);
    if (owned.error) return owned.error;

    const { error } = await db.from('chapters').delete().eq('id', id);

    if (error) {
      console.error(
        '[v2/chapters/:id][DELETE] Failed to delete chapter:',
        error
      );
      return NextResponse.json(
        { error: 'Failed to delete chapter' },
        { status: 500 }
      );
    }

    return NextResponse.json({ id, deleted: true });
  } catch (error) {
    console.error('[v2/chapters/:id][DELETE] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
