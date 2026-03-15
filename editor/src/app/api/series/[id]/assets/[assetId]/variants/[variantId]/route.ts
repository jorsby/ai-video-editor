import { createClient } from '@/lib/supabase/server';
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
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const series = await getSeries(supabase, id, user.id);
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

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const variant = await updateAssetVariant(supabase, variantId, updates);
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
export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id, variantId } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const series = await getSeries(supabase, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    await deleteAssetVariant(supabase, variantId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete asset variant error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
