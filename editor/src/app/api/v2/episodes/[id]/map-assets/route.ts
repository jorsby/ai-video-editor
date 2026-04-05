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
      episode: { id: string; series_id: string };
      error?: undefined;
    }
  | { episode?: undefined; error: NextResponse }
> {
  const { data: episode, error: episodeError } = await db
    .from('episodes')
    .select('id, series_id')
    .eq('id', id)
    .maybeSingle();

  if (episodeError || !episode) {
    return {
      error: NextResponse.json({ error: 'Episode not found' }, { status: 404 }),
    };
  }

  const { data: series, error: seriesError } = await db
    .from('series')
    .select('id, project_id')
    .eq('id', episode.series_id)
    .maybeSingle();

  if (seriesError || !series) {
    return {
      error: NextResponse.json({ error: 'Series not found' }, { status: 404 }),
    };
  }

  const { data: project, error: projectError } = await db
    .from('projects')
    .select('id')
    .eq('id', series.project_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (projectError || !project) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  return {
    episode: {
      id: episode.id as string,
      series_id: episode.series_id as string,
    },
  };
}

// POST /api/v2/episodes/{id}/map-assets
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedEpisode(db, user.id, id);
    if (owned.error) return owned.error;

    const { data: scenes, error: scenesError } = await db
      .from('scenes')
      .select(
        'background_slug, character_variant_slugs, prop_variant_slugs'
      )
      .eq('episode_id', owned.episode.id)
      .order('order', { ascending: true });

    if (scenesError) {
      console.error(
        '[v2/episodes/map-assets][POST] Failed to load scenes:',
        scenesError
      );
      return NextResponse.json(
        { error: 'Failed to load scenes for asset mapping' },
        { status: 500 }
      );
    }

    const locations = new Set<string>();
    const characters = new Set<string>();
    const props = new Set<string>();

    for (const scene of scenes ?? []) {
      const location = normalizeSlug(scene.background_slug);
      if (location) locations.add(location);

      for (const characterSlug of normalizeSlugArray(
        scene.character_variant_slugs
      )) {
        characters.add(characterSlug);
      }

      for (const propSlug of normalizeSlugArray(scene.prop_variant_slugs)) {
        props.add(propSlug);
      }
    }

    const nextMap: AssetVariantMap = {
      characters: [...characters],
      locations: [...locations],
      props: [...props],
    };

    const { data: updatedEpisode, error: updateError } = await db
      .from('episodes')
      .update({ asset_variant_map: nextMap })
      .eq('id', owned.episode.id)
      .eq('series_id', owned.episode.series_id)
      .select('id, asset_variant_map, created_at, updated_at')
      .single();

    if (updateError || !updatedEpisode) {
      console.error(
        '[v2/episodes/map-assets][POST] Failed to save asset map:',
        updateError
      );
      return NextResponse.json(
        { error: 'Failed to save episode asset map' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: updatedEpisode.id,
      episode_id: updatedEpisode.id,
      asset_variant_map: normalizeAssetVariantMap(
        updatedEpisode.asset_variant_map
      ),
      created_at: updatedEpisode.created_at,
      updated_at: updatedEpisode.updated_at,
    });
  } catch (error) {
    console.error('[v2/episodes/map-assets][POST] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
