import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

type AssetType = 'character' | 'location' | 'prop';

type AssetInput = {
  name: string;
  description?: string;
};

type CharacterSeed = AssetInput & {
  character_id: string | null;
};

const SERIES_ASSETS_BUCKET = 'series-assets';

function isAssetType(value: string): value is AssetType {
  return value === 'character' || value === 'location' || value === 'prop';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAssets(input: unknown): AssetInput[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      if (!isRecord(item)) return null;

      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const description =
        typeof item.description === 'string' ? item.description.trim() : '';

      if (!name) return null;

      return {
        name,
        ...(description ? { description } : {}),
      };
    })
    .filter((item): item is AssetInput => !!item);
}

/** Generate a URL-safe slug from asset name. Handles Turkish characters. */
function generateAssetSlug(name: string): string {
  // Turkish-specific transliteration first
  const turkishMap: Record<string, string> = {
    ı: 'i',
    İ: 'I',
    ğ: 'g',
    Ğ: 'G',
    ü: 'u',
    Ü: 'U',
    ş: 's',
    Ş: 'S',
    ö: 'o',
    Ö: 'O',
    ç: 'c',
    Ç: 'C',
  };
  const transliterated = name.replace(
    /[ıİğĞüÜşŞöÖçÇ]/g,
    (ch) => turkishMap[ch] ?? ch
  );
  return transliterated
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function resolveOrCreateCharacter(
  // biome-ignore lint/suspicious/noExplicitAny: existing repo uses untyped service client for DB routes
  dbClient: any,
  userId: string,
  character: AssetInput
): Promise<string | null> {
  const { data: existing } = await dbClient
    .from('characters')
    .select('id')
    .eq('user_id', userId)
    .eq('name', character.name)
    .maybeSingle();

  if (existing?.id) {
    return existing.id as string;
  }

  const { data: created, error } = await dbClient
    .from('characters')
    .insert({
      user_id: userId,
      name: character.name,
      description: character.description ?? null,
      tags: [],
    })
    .select('id')
    .single();

  if (error || !created?.id) {
    console.error('[v2/series/assets] Failed to create character:', error);
    return null;
  }

  return created.id as string;
}

function resolveImageUrl(
  db: ReturnType<typeof createServiceClient>,
  image: { url: string | null; storage_path: string | null }
): string | null {
  const rawUrl = image.url ?? null;

  if (
    rawUrl &&
    /^https?:\/\//i.test(rawUrl) &&
    !rawUrl.includes('/object/sign/')
  ) {
    return rawUrl;
  }

  if (image.storage_path) {
    const {
      data: { publicUrl },
    } = db.storage.from(SERIES_ASSETS_BUCKET).getPublicUrl(image.storage_path);

    if (publicUrl) {
      return publicUrl;
    }
  }

  return rawUrl;
}

function pickVariantImageUrl(
  db: ReturnType<typeof createServiceClient>,
  images: Array<{ url: string | null; storage_path: string | null }>
): string | null {
  for (const image of images) {
    const resolvedUrl = resolveImageUrl(db, image);
    if (resolvedUrl) {
      return resolvedUrl;
    }
  }

  return null;
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id: seriesId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const typeFilter = req.nextUrl.searchParams.get('type');
    if (typeFilter && !isAssetType(typeFilter)) {
      return NextResponse.json(
        { error: 'type must be one of: character, location, prop' },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');

    const { data: series, error: seriesError } = await db
      .from('series')
      .select('id')
      .eq('id', seriesId)
      .eq('user_id', user.id)
      .single();

    if (seriesError || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    let assetsQuery = db
      .from('series_assets')
      .select(
        'id, name, type, description, tags, series_asset_variants (id, label, description, is_default, is_finalized, finalized_at, created_at, series_asset_variant_images (id, url, storage_path, created_at))'
      )
      .eq('series_id', seriesId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (typeFilter) {
      assetsQuery = assetsQuery.eq('type', typeFilter);
    }

    const { data: assetsData, error: assetsError } = await assetsQuery;

    if (assetsError) {
      return NextResponse.json(
        { error: 'Failed to load series assets' },
        { status: 500 }
      );
    }

    const assets = (assetsData ?? []) as Array<{
      id: string;
      name: string;
      type: AssetType;
      description: string | null;
      tags: string[] | null;
      series_asset_variants: Array<{
        id: string;
        label: string;
        description: string | null;
        is_default: boolean;
        is_finalized: boolean;
        finalized_at: string | null;
        created_at: string;
        series_asset_variant_images: Array<{
          id: string;
          url: string | null;
          storage_path: string | null;
          created_at: string;
        }>;
      }>;
    }>;

    const responseAssets = assets.map((asset) => {
      const variants = (asset.series_asset_variants ?? []).map((variant) => {
        const imageUrl = pickVariantImageUrl(
          db,
          variant.series_asset_variant_images ?? []
        );

        return {
          id: variant.id,
          label: variant.label,
          description: variant.description,
          image_url: imageUrl,
          is_default: variant.is_default,
          is_finalized: variant.is_finalized,
        };
      });

      const referenceImageUrl =
        variants.find((variant) => variant.is_finalized && variant.image_url)
          ?.image_url ??
        variants.find((variant) => variant.is_default && variant.image_url)
          ?.image_url ??
        variants.find((variant) => variant.image_url)?.image_url ??
        null;

      return {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        description: asset.description,
        usage_notes: asset.description,
        tags: asset.tags ?? [],
        reference_image_url: referenceImageUrl,
        variants: variants.map((variant) => ({
          id: variant.id,
          label: variant.label,
          description: variant.description,
          image_url: variant.image_url,
        })),
      };
    });

    return NextResponse.json({ assets: responseAssets });
  } catch (error) {
    console.error('[v2/series/assets] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: seriesId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    const characters = normalizeAssets(body?.characters);
    const locations = normalizeAssets(body?.locations);
    const props = normalizeAssets(body?.props);

    if (
      characters.length === 0 &&
      locations.length === 0 &&
      props.length === 0
    ) {
      return NextResponse.json(
        { error: 'At least one valid asset is required' },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');

    const { data: series, error: seriesError } = await db
      .from('series')
      .select('id, user_id, project_id')
      .eq('id', seriesId)
      .single();

    if (seriesError || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    if (series.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { data: maxSort } = await db
      .from('series_assets')
      .select('sort_order')
      .eq('series_id', seriesId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextSortOrder = (maxSort?.sort_order ?? -1) + 1;

    const characterSeeds: CharacterSeed[] = [];
    for (const character of characters) {
      const characterId = await resolveOrCreateCharacter(
        db,
        user.id,
        character
      );
      characterSeeds.push({ ...character, character_id: characterId });
    }

    let characterRows: Array<{
      id?: string;
      character_id?: string | null;
      sort_order?: number;
    }> = [];

    if (characterSeeds.length > 0) {
      const { data, error } = await db
        .from('series_assets')
        .insert(
          characterSeeds.map((asset) => ({
            series_id: seriesId,
            type: 'character',
            name: asset.name,
            slug: generateAssetSlug(asset.name),
            description: asset.description ?? null,
            character_id: asset.character_id,
            sort_order: nextSortOrder++,
          }))
        )
        .select('id, character_id, sort_order');

      if (error) {
        return NextResponse.json(
          { error: 'Failed to create character assets' },
          { status: 500 }
        );
      }

      characterRows = (data ?? []) as Array<{
        id?: string;
        character_id?: string | null;
        sort_order?: number;
      }>;
    }

    let locationRows: Array<{ id?: string }> = [];

    if (locations.length > 0) {
      const { data, error } = await db
        .from('series_assets')
        .insert(
          locations.map((asset) => ({
            series_id: seriesId,
            type: 'location',
            name: asset.name,
            slug: generateAssetSlug(asset.name),
            description: asset.description ?? null,
            sort_order: nextSortOrder++,
          }))
        )
        .select('id');

      if (error) {
        return NextResponse.json(
          { error: 'Failed to create location assets' },
          { status: 500 }
        );
      }

      locationRows = (data ?? []) as Array<{ id?: string }>;
    }

    let propRows: Array<{ id?: string }> = [];

    if (props.length > 0) {
      const { data, error } = await db
        .from('series_assets')
        .insert(
          props.map((asset) => ({
            series_id: seriesId,
            type: 'prop',
            name: asset.name,
            slug: generateAssetSlug(asset.name),
            description: asset.description ?? null,
            sort_order: nextSortOrder++,
          }))
        )
        .select('id');

      if (error) {
        return NextResponse.json(
          { error: 'Failed to create prop assets' },
          { status: 500 }
        );
      }

      propRows = (data ?? []) as Array<{ id?: string }>;
    }

    if (series.project_id) {
      const projectCharacterRows = characterRows
        .filter((row) => !!row.character_id)
        .map((row) => ({
          project_id: series.project_id,
          character_id: row.character_id as string,
          element_index: Number(row.sort_order ?? 0) + 1,
          role: 'main',
        }));

      if (projectCharacterRows.length > 0) {
        const { error } = await db
          .from('project_characters')
          .insert(projectCharacterRows);

        if (error) {
          console.error(
            '[v2/series/assets] Failed to bind project characters:',
            error
          );
        }
      }
    }

    return NextResponse.json(
      {
        asset_ids: {
          characters: characterRows
            .map((row) => row.id)
            .filter((id: string | undefined): id is string => !!id),
          locations: locationRows
            .map((row) => row.id)
            .filter((id: string | undefined): id is string => !!id),
          props: propRows
            .map((row) => row.id)
            .filter((id: string | undefined): id is string => !!id),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v2/series/assets] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
