import { validateApiKey } from '@/lib/auth/api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  deleteSeriesAsset,
  getSeries,
  updateSeriesAsset,
} from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string; assetId: string }> };

type AssetVariantMap = {
  characters: string[];
  locations: string[];
  props: string[];
};

function asOptionalString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMap(value: unknown): AssetVariantMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { characters: [], locations: [], props: [] };
  }

  const input = value as Record<string, unknown>;
  const toList = (key: keyof AssetVariantMap) => {
    const raw = input[key];
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is string => typeof v === 'string');
  };

  return {
    characters: toList('characters'),
    locations: toList('locations'),
    props: toList('props'),
  };
}

async function assetHasEpisodeUsage(
  // biome-ignore lint/suspicious/noExplicitAny: supabase route clients are untyped across this codebase
  dbClient: any,
  seriesId: string,
  assetId: string
): Promise<boolean> {
  const { data: variants, error: variantsError } = await dbClient
    .from('series_asset_variants')
    .select('slug')
    .eq('asset_id', assetId);

  if (variantsError) {
    throw new Error(`Failed to load asset variants: ${variantsError.message}`);
  }

  const slugs = (variants ?? [])
    .map((row: { slug: string | null }) => row.slug)
    .filter((slug: string | null): slug is string => !!slug);

  if (slugs.length === 0) return false;

  const { data: episodes, error: episodesError } = await dbClient
    .from('episodes')
    .select('asset_variant_map')
    .eq('series_id', seriesId);

  if (episodesError) {
    throw new Error(
      `Failed to load episode asset maps: ${episodesError.message}`
    );
  }

  const used = new Set(slugs);
  return (episodes ?? []).some((episode: { asset_variant_map: unknown }) => {
    const map = normalizeMap(episode.asset_variant_map);
    return [...map.characters, ...map.locations, ...map.props].some((slug) =>
      used.has(slug)
    );
  });
}

// PUT /api/series/[id]/assets/[assetId] — update asset
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id, assetId } = await context.params;
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');
    const series = await getSeries(dbClient, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Name cannot be empty' },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }

    if (body.slug !== undefined) {
      if (typeof body.slug !== 'string' || body.slug.trim().length === 0) {
        return NextResponse.json(
          { error: 'slug cannot be empty' },
          { status: 400 }
        );
      }
      updates.slug = body.slug.trim();
    }

    if (body.type !== undefined) {
      if (!['character', 'location', 'prop'].includes(body.type)) {
        return NextResponse.json(
          { error: 'type must be character, location, or prop' },
          { status: 400 }
        );
      }
      updates.type = body.type;
    }

    if (body.description !== undefined) {
      updates.description = asOptionalString(body.description);
    }

    if (body.sort_order !== undefined) {
      if (
        typeof body.sort_order !== 'number' ||
        !Number.isFinite(body.sort_order)
      ) {
        return NextResponse.json(
          { error: 'sort_order must be a finite number' },
          { status: 400 }
        );
      }
      updates.sort_order = body.sort_order;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const asset = await updateSeriesAsset(dbClient, assetId, updates);
    return NextResponse.json({ asset });
  } catch (error) {
    console.error('Update series asset error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/series/[id]/assets/[assetId] — delete asset (cascades to variants)
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id, assetId } = await context.params;
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');
    const series = await getSeries(dbClient, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const inUse = await assetHasEpisodeUsage(dbClient, id, assetId);
    if (inUse) {
      return NextResponse.json(
        {
          error:
            'Asset has variants referenced in one or more episode asset maps and cannot be deleted',
        },
        { status: 409 }
      );
    }

    await deleteSeriesAsset(dbClient, assetId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete series asset error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
