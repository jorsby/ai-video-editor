import { validateApiKey } from '@/lib/auth/api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  deleteAssetVariant,
  getVideo,
  updateAssetVariant,
} from '@/lib/supabase/video-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = {
  params: Promise<{ id: string; assetId: string; variantId: string }>;
};

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

async function variantUsedInChapterMap(
  // biome-ignore lint/suspicious/noExplicitAny: supabase route clients are untyped across this codebase
  dbClient: any,
  videoId: string,
  variantSlug: string
): Promise<boolean> {
  const { data: chapters, error } = await dbClient
    .from('chapters')
    .select('asset_variant_map')
    .eq('video_id', videoId);

  if (error) {
    throw new Error(`Failed to load chapters: ${error.message}`);
  }

  return (chapters ?? []).some((chapter: { asset_variant_map: unknown }) => {
    const map = normalizeMap(chapter.asset_variant_map);
    return [...map.characters, ...map.locations, ...map.props].includes(
      variantSlug
    );
  });
}

// PUT /api/videos/[id]/assets/[assetId]/variants/[variantId]
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id, variantId } = await context.params;
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
    const video = await getVideo(dbClient, id, user.id);
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const body = await req.json();

    if (body.is_finalized !== undefined) {
      return NextResponse.json(
        {
          error:
            'is_finalized is not supported in the simplified schema. Use default/image/prompt fields only.',
        },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};

    const name = asOptionalString(body.name ?? body.label);
    if (body.name !== undefined || body.label !== undefined) {
      if (!name) {
        return NextResponse.json(
          { error: 'name cannot be empty' },
          { status: 400 }
        );
      }
      updates.name = name;
    }

    if (body.slug !== undefined) {
      const slug = asOptionalString(body.slug);
      if (!slug) {
        return NextResponse.json(
          { error: 'slug cannot be empty' },
          { status: 400 }
        );
      }
      updates.slug = slug;
    }

    if (body.prompt !== undefined)
      updates.prompt = asOptionalString(body.prompt);
    if (body.image_url !== undefined)
      updates.image_url = asOptionalString(body.image_url);
    if (body.reasoning !== undefined)
      updates.reasoning = asOptionalString(body.reasoning);
    if (body.is_main !== undefined) updates.is_main = Boolean(body.is_main);

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const variant = await updateAssetVariant(dbClient, variantId, updates);
    return NextResponse.json({ variant });
  } catch (error) {
    console.error('Update asset variant error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/videos/[id]/assets/[assetId]/variants/[variantId]
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id, assetId, variantId } = await context.params;
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
    const video = await getVideo(dbClient, id, user.id);
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const { data: variant, error: variantError } = await dbClient
      .from('project_asset_variants')
      .select('id, slug')
      .eq('id', variantId)
      .eq('asset_id', assetId)
      .single();

    if (variantError || !variant) {
      return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
    }

    if (typeof variant.slug === 'string' && variant.slug.trim()) {
      const inChapterMap = await variantUsedInChapterMap(
        dbClient,
        id,
        variant.slug
      );

      if (inChapterMap) {
        return NextResponse.json(
          {
            error:
              'Variant is referenced in one or more chapter asset maps and cannot be deleted',
          },
          { status: 409 }
        );
      }
    }

    await deleteAssetVariant(dbClient, variantId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete asset variant error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
