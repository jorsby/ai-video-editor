import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import {
  deleteAssetVariant,
  getSeries,
  updateAssetVariant,
} from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = {
  params: Promise<{ id: string; assetId: string; variantId: string }>;
};

// PUT /api/series/[id]/assets/[assetId]/variants/[variantId]
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
    const series = await getSeries(dbClient, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.label !== undefined) {
      if (typeof body.label !== 'string' || body.label.trim().length === 0) {
        return NextResponse.json(
          { error: 'Label cannot be empty' },
          { status: 400 }
        );
      }
      updates.label = body.label.trim();
    }
    if (body.description !== undefined)
      updates.description = body.description || null;
    if (body.is_default !== undefined)
      updates.is_default = Boolean(body.is_default);

    if (body.is_finalized !== undefined) {
      const { data: currentVariant } = await dbClient
        .from('series_asset_variants')
        .select('*')
        .eq('id', variantId)
        .single();

      const requestedFinalized = Boolean(body.is_finalized);
      if (currentVariant?.is_finalized && !requestedFinalized) {
        return NextResponse.json(
          { error: 'Finalized variants cannot be unfinalized' },
          { status: 409 }
        );
      }

      updates.is_finalized = requestedFinalized;
    }

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

// DELETE /api/series/[id]/assets/[assetId]/variants/[variantId]
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
    const series = await getSeries(dbClient, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const { data: variant } = await dbClient
      .from('series_asset_variants')
      .select('*')
      .eq('id', variantId)
      .eq('asset_id', assetId)
      .single();

    if (variant?.is_finalized) {
      return NextResponse.json(
        { error: 'Variant is finalized and cannot be deleted' },
        { status: 409 }
      );
    }

    const { count: usageCount } = await dbClient
      .from('episode_asset_variants')
      .select('*', { count: 'exact', head: true })
      .eq('variant_id', variantId);

    if ((usageCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'Variant is already used in one or more episodes and cannot be deleted',
        },
        { status: 409 }
      );
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
