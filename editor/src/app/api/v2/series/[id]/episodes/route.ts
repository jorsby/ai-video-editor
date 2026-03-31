import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

type EpisodeStatus = 'draft' | 'ready' | 'in_progress' | 'done';

type AssetVariantMap = {
  characters: string[];
  locations: string[];
  props: string[];
};

type EpisodeInsertRow = {
  order?: number;
  title?: string | null;
  synopsis?: string | null;
  audio_content?: string | null;
  visual_outline?: string | null;
  asset_variant_map?: AssetVariantMap;
  plan_json?: Record<string, unknown> | null;
  status?: EpisodeStatus;
};

const EPISODE_STATUSES: EpisodeStatus[] = [
  'draft',
  'ready',
  'in_progress',
  'done',
];
const EPISODE_SELECT =
  'id, series_id, order, title, synopsis, audio_content, visual_outline, asset_variant_map, plan_json, status, created_at, updated_at';
const DEFAULT_ASSET_VARIANT_MAP: AssetVariantMap = {
  characters: [],
  locations: [],
  props: [],
};

type OwnedSeriesLookup =
  | {
      series: {
        id: string;
        user_id: string;
      };
      error?: undefined;
    }
  | {
      series?: undefined;
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

async function getOwnedSeries(
  db: ReturnType<typeof createServiceClient>,
  seriesId: string,
  userId: string
): Promise<OwnedSeriesLookup> {
  const { data: series, error } = await db
    .from('series')
    .select('id, user_id')
    .eq('id', seriesId)
    .maybeSingle();

  if (error || !series) {
    return {
      error: NextResponse.json({ error: 'Series not found' }, { status: 404 }),
    };
  }

  if (series.user_id !== userId) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  return { series };
}

function parseEpisodePayload(
  payload: unknown
): { ok: true; value: EpisodeInsertRow } | { ok: false; error: string } {
  if (!isRecord(payload)) {
    return { ok: false, error: 'Each episode must be an object' };
  }

  const row: EpisodeInsertRow = {};

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
      !EPISODE_STATUSES.includes(payload.status as EpisodeStatus)
    ) {
      return {
        ok: false,
        error:
          "status must be one of 'draft', 'ready', 'in_progress', or 'done'",
      };
    }
    row.status = payload.status as EpisodeStatus;
  }

  return { ok: true, value: row };
}

function getPayloadEpisodes(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (isRecord(body) && Array.isArray(body.episodes)) {
    return body.episodes;
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
    const owned = await getOwnedSeries(db, id, user.id);
    if (owned.error) return owned.error;

    const { data: episodes, error } = await db
      .from('episodes')
      .select(EPISODE_SELECT)
      .eq('series_id', id)
      .order('order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error(
        '[v2/series/:id/episodes][GET] Failed to list episodes:',
        error
      );
      return NextResponse.json(
        { error: 'Failed to list episodes' },
        { status: 500 }
      );
    }

    return NextResponse.json(episodes ?? []);
  } catch (error) {
    console.error('[v2/series/:id/episodes][GET] Unexpected error:', error);
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
    const requestedEpisodes = getPayloadEpisodes(body);

    if (!requestedEpisodes) {
      return NextResponse.json(
        { error: 'Body must be an array of episodes or { episodes: [] }' },
        { status: 400 }
      );
    }

    if (requestedEpisodes.length === 0) {
      return NextResponse.json(
        { error: 'At least one episode is required' },
        { status: 400 }
      );
    }

    const parsedRows: EpisodeInsertRow[] = [];
    for (const candidate of requestedEpisodes) {
      const parsed = parseEpisodePayload(candidate);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      parsedRows.push(parsed.value);
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedSeries(db, id, user.id);
    if (owned.error) return owned.error;

    const { data: maxOrderRow, error: maxOrderError } = await db
      .from('episodes')
      .select('order')
      .eq('series_id', id)
      .order('order', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maxOrderError) {
      console.error(
        '[v2/series/:id/episodes][POST] Failed to resolve next order:',
        maxOrderError
      );
      return NextResponse.json(
        { error: 'Failed to create episodes' },
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
        series_id: id,
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
      .from('episodes')
      .select('order')
      .eq('series_id', id)
      .in('order', orderValues);

    if (conflictCheckError) {
      console.error(
        '[v2/series/:id/episodes][POST] Failed to check order conflicts:',
        conflictCheckError
      );
      return NextResponse.json(
        { error: 'Failed to create episodes' },
        { status: 500 }
      );
    }

    if ((conflictingOrders ?? []).length > 0) {
      return NextResponse.json(
        { error: 'One or more episode order values already exist' },
        { status: 409 }
      );
    }

    const { data: inserted, error: insertError } = await db
      .from('episodes')
      .insert(rowsToInsert)
      .select(EPISODE_SELECT);

    if (insertError) {
      console.error(
        '[v2/series/:id/episodes][POST] Failed to create episodes:',
        insertError
      );
      return NextResponse.json(
        { error: 'Failed to create episodes' },
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

    console.error('[v2/series/:id/episodes][POST] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
