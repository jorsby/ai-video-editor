import { validateApiKey } from '@/lib/auth/api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getVideo } from '@/lib/supabase/video-service';
import { type NextRequest, NextResponse } from 'next/server';
import {
  ASSET_FK_BY_TYPE,
  ASSET_TABLE_BY_TYPE,
  VARIANT_TABLE_BY_TYPE,
  type AssetType,
} from '@/lib/api/variant-table-resolver';

type RouteContext = {
  params: Promise<{ id: string; chapterId: string }>;
};

type AssetVariantMap = {
  characters: string[];
  locations: string[];
  props: string[];
};

type AssetRecord = {
  id: string;
  name: string;
  slug: string;
  type: 'character' | 'location' | 'prop';
};

type VariantRecord = {
  id: string;
  asset_id: string;
  slug: string;
  name: string;
  is_main: boolean;
};

type AuthContext = {
  dbClient: any;
  videoId: string;
  chapterId: string;
  errorResponse?: NextResponse;
};

function normalizeVariantSlugArray(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;

  const normalized = input
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

  if (normalized.length !== input.length) return null;
  return [...new Set(normalized)];
}

function normalizeAssetVariantMap(input: unknown): AssetVariantMap | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const value = input as Record<string, unknown>;
  const characters = normalizeVariantSlugArray(value.characters);
  const locations = normalizeVariantSlugArray(value.locations);
  const props = normalizeVariantSlugArray(value.props);

  if (!characters || !locations || !props) return null;

  return { characters, locations, props };
}

async function authorizeAndValidateVideoChapter(
  req: NextRequest,
  context: RouteContext
): Promise<AuthContext> {
  const { id: videoId, chapterId } = await context.params;
  const supabase = await createClient('studio');
  const {
    data: { user: sessionUser },
  } = await supabase.auth.getUser();

  const apiKeyResult = !sessionUser ? validateApiKey(req) : { valid: false };
  const user =
    sessionUser ??
    (apiKeyResult.valid && apiKeyResult.userId
      ? { id: apiKeyResult.userId }
      : null);

  if (!user) {
    return {
      dbClient: supabase,
      videoId,
      chapterId,
      errorResponse: NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      ),
    };
  }

  const dbClient = sessionUser ? supabase : createServiceClient('studio');
  const video = await getVideo(dbClient, videoId, user.id);
  if (!video) {
    return {
      dbClient,
      videoId,
      chapterId,
      errorResponse: NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      ),
    };
  }

  const { data: chapter, error: chapterError } = await dbClient
    .from('chapters')
    .select('id')
    .eq('id', chapterId)
    .eq('video_id', videoId)
    .maybeSingle();

  if (chapterError || !chapter) {
    return {
      dbClient,
      videoId,
      chapterId,
      errorResponse: NextResponse.json(
        { error: 'Chapter not found' },
        { status: 404 }
      ),
    };
  }

  return { dbClient, videoId, chapterId };
}

async function loadVideoAssetAndVariantMaps(dbClient: any, videoId: string) {
  // Resolve video → project_id for project-scoped asset lookup
  const { data: videoRow } = await dbClient
    .from('videos')
    .select('project_id')
    .eq('id', videoId)
    .maybeSingle();

  const projectId = videoRow?.project_id as string | undefined;
  if (!projectId) {
    throw new Error(`Could not resolve project_id for video ${videoId}`);
  }

  // Fan out across the three typed pairs and merge into the legacy shape.
  const types: AssetType[] = ['character', 'location', 'prop'];
  const parts = await Promise.all(
    types.map(async (t) => {
      const parentTable = ASSET_TABLE_BY_TYPE[t];
      const variantTable = VARIANT_TABLE_BY_TYPE[t];
      const parentFk = ASSET_FK_BY_TYPE[t];
      const { data, error } = await dbClient
        .from(parentTable)
        .select(
          `id, name, slug, sort_order, ${variantTable}(id, ${parentFk}, slug, name, is_main)`
        )
        .eq('project_id', projectId)
        .order('sort_order', { ascending: true });
      if (error || !data) return [];
      return (data as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        slug: row.slug as string,
        type: t,
        variants: (
          (row[variantTable] ?? []) as Array<Record<string, unknown>>
        ).map((v) => ({
          id: v.id as string,
          asset_id: (v[parentFk] as string) ?? (row.id as string),
          slug: v.slug as string,
          name: v.name as string,
          is_main: !!v.is_main,
        })),
      }));
    })
  );

  const assets: Array<
    AssetRecord & { project_asset_variants: VariantRecord[] }
  > = parts.flat().map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    type: a.type,
    project_asset_variants: a.variants,
  }));

  const assetById = new Map<string, AssetRecord>();
  const variantBySlug = new Map<
    string,
    VariantRecord & { asset: AssetRecord }
  >();

  for (const asset of assets) {
    assetById.set(asset.id, {
      id: asset.id,
      name: asset.name,
      slug: asset.slug,
      type: asset.type,
    });

    for (const variant of asset.project_asset_variants ?? []) {
      variantBySlug.set(variant.slug, {
        ...variant,
        asset: {
          id: asset.id,
          name: asset.name,
          slug: asset.slug,
          type: asset.type,
        },
      });
    }
  }

  return { assets, assetById, variantBySlug };
}

function uniqueAssetIdsFromMap(
  map: AssetVariantMap,
  variantBySlug: Map<string, VariantRecord & { asset: AssetRecord }>
): string[] {
  const ids = new Set<string>();

  for (const slug of [...map.characters, ...map.locations, ...map.props]) {
    const variant = variantBySlug.get(slug);
    if (variant) ids.add(variant.asset.id);
  }

  return [...ids];
}

function mapFromLegacyAssetIds(
  assetIds: string[],
  assets: Array<AssetRecord & { project_asset_variants: VariantRecord[] }>
): AssetVariantMap | null {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  const map: AssetVariantMap = {
    characters: [],
    locations: [],
    props: [],
  };

  for (const assetId of assetIds) {
    const asset = byId.get(assetId);
    if (!asset) return null;

    const variants = asset.project_asset_variants ?? [];
    if (variants.length === 0) return null;

    const selected =
      variants.find((variant) => variant.is_main) ??
      variants.sort((a, b) => a.name.localeCompare(b.name))[0];

    if (!selected?.slug) return null;

    if (asset.type === 'character') map.characters.push(selected.slug);
    if (asset.type === 'location') map.locations.push(selected.slug);
    if (asset.type === 'prop') map.props.push(selected.slug);
  }

  return {
    characters: [...new Set(map.characters)],
    locations: [...new Set(map.locations)],
    props: [...new Set(map.props)],
  };
}

async function loadChapterMap(
  dbClient: any,
  chapterId: string
): Promise<AssetVariantMap> {
  const { data: chapter, error } = await dbClient
    .from('chapters')
    .select('asset_variant_map')
    .eq('id', chapterId)
    .single();

  if (error || !chapter) {
    throw new Error(
      `Failed to load chapter asset_variant_map: ${error?.message}`
    );
  }

  const normalized = normalizeAssetVariantMap(chapter.asset_variant_map);
  if (!normalized) {
    return { characters: [], locations: [], props: [] };
  }

  return normalized;
}

// GET /api/videos/{id}/chapters/{chapterId}/asset-map
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const auth = await authorizeAndValidateVideoChapter(req, context);
    if (auth.errorResponse) return auth.errorResponse;

    const map = await loadChapterMap(auth.dbClient, auth.chapterId);
    const { variantBySlug } = await loadVideoAssetAndVariantMaps(
      auth.dbClient,
      auth.videoId
    );

    const assetIds = uniqueAssetIdsFromMap(map, variantBySlug);

    return NextResponse.json({
      chapter_id: auth.chapterId,
      asset_variant_map: map,
      // Legacy convenience key kept for incremental UI migration.
      asset_ids: assetIds,
    });
  } catch (error) {
    console.error('Get chapter asset map error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/videos/{id}/chapters/{chapterId}/asset-map
// Replaces full chapter asset_variant_map.
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const auth = await authorizeAndValidateVideoChapter(req, context);
    if (auth.errorResponse) return auth.errorResponse;

    const body = await req.json();

    const { assets, variantBySlug } = await loadVideoAssetAndVariantMaps(
      auth.dbClient,
      auth.videoId
    );

    let nextMap = normalizeAssetVariantMap(body?.asset_variant_map);

    // Legacy compatibility: allow asset_ids input and map to main variant slugs.
    if (!nextMap && Array.isArray(body?.asset_ids)) {
      const normalizedAssetIds = body.asset_ids
        .filter((value: unknown): value is string => typeof value === 'string')
        .map((value: string) => value.trim())
        .filter((value: string): value is string => value.length > 0);

      if (normalizedAssetIds.length !== body.asset_ids.length) {
        return NextResponse.json(
          { error: 'asset_ids must be an array of non-empty strings' },
          { status: 400 }
        );
      }

      const uniqueAssetIds: string[] = Array.from(
        new Set<string>(normalizedAssetIds)
      );

      nextMap = mapFromLegacyAssetIds(uniqueAssetIds, assets);
      if (!nextMap) {
        return NextResponse.json(
          {
            error:
              'Unable to convert asset_ids to variant map. Ensure each asset exists in this video and has at least one variant.',
          },
          { status: 400 }
        );
      }
    }

    if (!nextMap) {
      return NextResponse.json(
        {
          error:
            'Provide asset_variant_map (characters/locations/props string arrays) or legacy asset_ids',
        },
        { status: 400 }
      );
    }

    const invalidSlugs: string[] = [];

    for (const slug of nextMap.characters) {
      const variant = variantBySlug.get(slug);
      if (!variant || variant.asset.type !== 'character')
        invalidSlugs.push(slug);
    }
    for (const slug of nextMap.locations) {
      const variant = variantBySlug.get(slug);
      if (!variant || variant.asset.type !== 'location')
        invalidSlugs.push(slug);
    }
    for (const slug of nextMap.props) {
      const variant = variantBySlug.get(slug);
      if (!variant || variant.asset.type !== 'prop') invalidSlugs.push(slug);
    }

    if (invalidSlugs.length > 0) {
      return NextResponse.json(
        {
          error:
            'One or more variant slugs are invalid for this video or mapped to the wrong asset type',
          invalid_variant_slugs: [...new Set(invalidSlugs)],
        },
        { status: 400 }
      );
    }

    const { error: updateError } = await auth.dbClient
      .from('chapters')
      .update({ asset_variant_map: nextMap })
      .eq('id', auth.chapterId)
      .eq('video_id', auth.videoId);

    if (updateError) {
      console.error('Update chapter asset_variant_map error:', updateError);
      return NextResponse.json(
        { error: 'Failed to save chapter asset map' },
        { status: 500 }
      );
    }

    const assetIds = uniqueAssetIdsFromMap(nextMap, variantBySlug);

    return NextResponse.json({
      chapter_id: auth.chapterId,
      asset_variant_map: nextMap,
      asset_ids: assetIds,
    });
  } catch (error) {
    console.error('Update chapter asset map error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
