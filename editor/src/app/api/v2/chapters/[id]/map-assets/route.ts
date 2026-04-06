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

async function getOwnedChapter(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  id: string
): Promise<
  | {
      chapter: { id: string; video_id: string };
      error?: undefined;
    }
  | { chapter?: undefined; error: NextResponse }
> {
  const { data: chapter, error: chapterError } = await db
    .from('chapters')
    .select('id, video_id')
    .eq('id', id)
    .maybeSingle();

  if (chapterError || !chapter) {
    return {
      error: NextResponse.json({ error: 'Chapter not found' }, { status: 404 }),
    };
  }

  const { data: video, error: videoError } = await db
    .from('videos')
    .select('id, project_id')
    .eq('id', chapter.video_id)
    .maybeSingle();

  if (videoError || !video) {
    return {
      error: NextResponse.json({ error: 'Video not found' }, { status: 404 }),
    };
  }

  const { data: project, error: projectError } = await db
    .from('projects')
    .select('id')
    .eq('id', video.project_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (projectError || !project) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  return {
    chapter: {
      id: chapter.id as string,
      video_id: chapter.video_id as string,
    },
  };
}

// POST /api/v2/chapters/{id}/map-assets
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedChapter(db, user.id, id);
    if (owned.error) return owned.error;

    const { data: scenes, error: scenesError } = await db
      .from('scenes')
      .select(
        'location_variant_slug, character_variant_slugs, prop_variant_slugs'
      )
      .eq('chapter_id', owned.chapter.id)
      .order('order', { ascending: true });

    if (scenesError) {
      console.error(
        '[v2/chapters/map-assets][POST] Failed to load scenes:',
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
      const location = normalizeSlug(scene.location_variant_slug);
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

    const { data: updatedChapter, error: updateError } = await db
      .from('chapters')
      .update({ asset_variant_map: nextMap })
      .eq('id', owned.chapter.id)
      .eq('video_id', owned.chapter.video_id)
      .select('id, asset_variant_map, created_at, updated_at')
      .single();

    if (updateError || !updatedChapter) {
      console.error(
        '[v2/chapters/map-assets][POST] Failed to save asset map:',
        updateError
      );
      return NextResponse.json(
        { error: 'Failed to save chapter asset map' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: updatedChapter.id,
      chapter_id: updatedChapter.id,
      asset_variant_map: normalizeAssetVariantMap(
        updatedChapter.asset_variant_map
      ),
      created_at: updatedChapter.created_at,
      updated_at: updatedChapter.updated_at,
    });
  } catch (error) {
    console.error('[v2/chapters/map-assets][POST] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
