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

type ChapterInsertRow = {
  order?: number;
  title?: string | null;
  synopsis?: string | null;
  audio_content?: string | null;
  visual_outline?: string | null;
  asset_variant_map?: AssetVariantMap;
  plan_json?: Record<string, unknown> | null;
  status?: ChapterStatus;
};

const EPISODE_STATUSES: ChapterStatus[] = [
  'draft',
  'ready',
  'in_progress',
  'done',
];
const EPISODE_SELECT =
  'id, video_id, order, title, synopsis, audio_content, visual_outline, asset_variant_map, plan_json, status, created_at, updated_at';
const DEFAULT_ASSET_VARIANT_MAP: AssetVariantMap = {
  characters: [],
  locations: [],
  props: [],
};

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

function parseChapterPayload(
  payload: unknown
): { ok: true; value: ChapterInsertRow } | { ok: false; error: string } {
  if (!isRecord(payload)) {
    return { ok: false, error: 'Each chapter must be an object' };
  }

  const row: ChapterInsertRow = {};

  if (payload.order !== undefined) {
    if (
      typeof payload.order !== 'number' ||
      !Number.isInteger(payload.order) ||
      payload.order < 1
    ) {
      return { ok: false, error: 'order must be a positive integer' };
    }
    row.order = payload.order;
  }

  const nullableFields = [
    'title',
    'synopsis',
    'audio_content',
    'visual_outline',
  ] as const;
  for (const field of nullableFields) {
    if (payload[field] !== undefined) {
      const parsed = parseNullableText(payload[field], field);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      row[field] = parsed.value;
    }
  }

  if (payload.asset_variant_map !== undefined) {
    const parsed = parseAssetVariantMap(payload.asset_variant_map);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    row.asset_variant_map = parsed.value;
  }

  if (payload.plan_json !== undefined) {
    if (payload.plan_json !== null && !isRecord(payload.plan_json)) {
      return { ok: false, error: 'plan_json must be an object or null' };
    }
    row.plan_json = payload.plan_json as Record<string, unknown> | null;
  }

  if (payload.status !== undefined) {
    if (
      typeof payload.status !== 'string' ||
      !EPISODE_STATUSES.includes(payload.status as ChapterStatus)
    ) {
      return {
        ok: false,
        error:
          "status must be one of 'draft', 'ready', 'in_progress', or 'done'",
      };
    }
    row.status = payload.status as ChapterStatus;
  }

  return { ok: true, value: row };
}

function getPayloadChapters(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (isRecord(body) && Array.isArray(body.chapters)) {
    return body.chapters;
  }
  return null;
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

    const { data: chapters, error } = await db
      .from('chapters')
      .select(EPISODE_SELECT)
      .eq('video_id', id)
      .order('order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error(
        '[v2/video/:id/chapters][GET] Failed to list chapters:',
        error
      );
      return NextResponse.json(
        { error: 'Failed to list chapters' },
        { status: 500 }
      );
    }

    return NextResponse.json(chapters ?? []);
  } catch (error) {
    console.error('[v2/video/:id/chapters][GET] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const requestedChapters = getPayloadChapters(body);

    if (!requestedChapters) {
      return NextResponse.json(
        { error: 'Body must be an array of chapters or { chapters: [] }' },
        { status: 400 }
      );
    }

    if (requestedChapters.length === 0) {
      return NextResponse.json(
        { error: 'At least one chapter is required' },
        { status: 400 }
      );
    }

    const parsedRows: ChapterInsertRow[] = [];
    for (const candidate of requestedChapters) {
      const parsed = parseChapterPayload(candidate);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      parsedRows.push(parsed.value);
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedVideo(db, id, user.id);
    if (owned.error) return owned.error;

    const { data: maxOrderRow, error: maxOrderError } = await db
      .from('chapters')
      .select('order')
      .eq('video_id', id)
      .order('order', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maxOrderError) {
      console.error(
        '[v2/video/:id/chapters][POST] Failed to resolve next order:',
        maxOrderError
      );
      return NextResponse.json(
        { error: 'Failed to create chapters' },
        { status: 500 }
      );
    }

    let nextOrder = (maxOrderRow?.order ?? 0) + 1000;
    const finalOrders = new Set<number>();
    const rowsToInsert = parsedRows.map((row) => {
      const order = row.order ?? nextOrder;

      if (row.order === undefined) {
        nextOrder += 1000;
      }

      if (finalOrders.has(order)) {
        throw new Error(`duplicate-order:${order}`);
      }
      finalOrders.add(order);

      return {
        video_id: id,
        order,
        title: row.title ?? null,
        synopsis: row.synopsis ?? null,
        audio_content: row.audio_content ?? null,
        visual_outline: row.visual_outline ?? null,
        asset_variant_map: row.asset_variant_map ?? DEFAULT_ASSET_VARIANT_MAP,
        plan_json: row.plan_json ?? null,
        status: row.status ?? 'draft',
      };
    });

    const orderValues = rowsToInsert.map((row) => row.order);
    const { data: conflictingOrders, error: conflictCheckError } = await db
      .from('chapters')
      .select('order')
      .eq('video_id', id)
      .in('order', orderValues);

    if (conflictCheckError) {
      console.error(
        '[v2/video/:id/chapters][POST] Failed to check order conflicts:',
        conflictCheckError
      );
      return NextResponse.json(
        { error: 'Failed to create chapters' },
        { status: 500 }
      );
    }

    if ((conflictingOrders ?? []).length > 0) {
      return NextResponse.json(
        { error: 'One or more chapter order values already exist' },
        { status: 409 }
      );
    }

    const { data: inserted, error: insertError } = await db
      .from('chapters')
      .insert(rowsToInsert)
      .select(EPISODE_SELECT);

    if (insertError) {
      console.error(
        '[v2/video/:id/chapters][POST] Failed to create chapters:',
        insertError
      );
      return NextResponse.json(
        { error: 'Failed to create chapters' },
        { status: 500 }
      );
    }

    const sortedInserted = [...(inserted ?? [])].sort(
      (a: { order: number }, b: { order: number }) => a.order - b.order
    );

    return NextResponse.json(sortedInserted, { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('duplicate-order:')
    ) {
      return NextResponse.json(
        { error: 'Duplicate order values in request payload' },
        { status: 400 }
      );
    }

    console.error('[v2/video/:id/chapters][POST] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
