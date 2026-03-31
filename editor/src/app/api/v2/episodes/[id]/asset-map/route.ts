import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

type AssetVariantMap = {
  characters: string[];
  locations: string[];
  props: string[];
};

function normalizeSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSlugArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const slug = normalizeSlug(item);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    normalized.push(slug);
  }

  return normalized;
}

function normalizeAssetVariantMap(input: unknown): AssetVariantMap {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { characters: [], locations: [], props: [] };
  }

  const value = input as Record<string, unknown>;
  return {
    characters: normalizeSlugArray(value.characters),
    locations: normalizeSlugArray(value.locations),
    props: normalizeSlugArray(value.props),
  };
}

async function getOwnedEpisode(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  id: string
): Promise<
  | {
      episode: {
        id: string;
        series_id: string;
        asset_variant_map: unknown;
        created_at: string;
        updated_at: string;
      };
      error?: undefined;
    }
  | { episode?: undefined; error: NextResponse }
> {
  const { data: episode, error: episodeError } = await db
    .from('episodes')
    .select('id, series_id, asset_variant_map, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();

  if (episodeError || !episode) {
    return {
      error: NextResponse.json({ error: 'Episode not found' }, { status: 404 }),
    };
  }

  const { data: series, error: seriesError } = await db
    .from('series')
    .select('id')
    .eq('id', episode.series_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (seriesError || !series) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  return {
    episode: {
      id: episode.id as string,
      series_id: episode.series_id as string,
      asset_variant_map: episode.asset_variant_map,
      created_at: episode.created_at as string,
      updated_at: episode.updated_at as string,
    },
  };
}

// GET /api/v2/episodes/{id}/asset-map
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedEpisode(db, user.id, id);
    if (owned.error) return owned.error;

    return NextResponse.json({
      id: owned.episode.id,
      episode_id: owned.episode.id,
      asset_variant_map: normalizeAssetVariantMap(
        owned.episode.asset_variant_map
      ),
      created_at: owned.episode.created_at,
      updated_at: owned.episode.updated_at,
    });
  } catch (error) {
    console.error('[v2/episodes/asset-map][GET] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
