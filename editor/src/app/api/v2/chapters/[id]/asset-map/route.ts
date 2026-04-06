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
      chapter: {
        id: string;
        video_id: string;
        asset_variant_map: unknown;
        created_at: string;
        updated_at: string;
      };
      error?: undefined;
    }
  | { chapter?: undefined; error: NextResponse }
> {
  const { data: chapter, error: chapterError } = await db
    .from('chapters')
    .select('id, video_id, asset_variant_map, created_at, updated_at')
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
      asset_variant_map: chapter.asset_variant_map,
      created_at: chapter.created_at as string,
      updated_at: chapter.updated_at as string,
    },
  };
}

// GET /api/v2/chapters/{id}/asset-map
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedChapter(db, user.id, id);
    if (owned.error) return owned.error;

    return NextResponse.json({
      id: owned.chapter.id,
      chapter_id: owned.chapter.id,
      asset_variant_map: normalizeAssetVariantMap(
        owned.chapter.asset_variant_map
      ),
      created_at: owned.chapter.created_at,
      updated_at: owned.chapter.updated_at,
    });
  } catch (error) {
    console.error('[v2/chapters/asset-map][GET] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
