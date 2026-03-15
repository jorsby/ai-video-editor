import { createClient } from '@/lib/supabase/server';
import {
  deleteSeriesAsset,
  getSeries,
  updateSeriesAsset,
} from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string; assetId: string }> };

// PUT /api/series/[id]/assets/[assetId] — update asset
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id, assetId } = await context.params;
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

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Name cannot be empty' },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }
    if (body.description !== undefined)
      updates.description = body.description || null;
    if (body.tags !== undefined)
      updates.tags = Array.isArray(body.tags) ? body.tags : [];
    if (body.character_id !== undefined)
      updates.character_id = body.character_id || null;
    if (body.sort_order !== undefined) updates.sort_order = body.sort_order;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const asset = await updateSeriesAsset(supabase, assetId, updates);
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
export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id, assetId } = await context.params;
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

    await deleteSeriesAsset(supabase, assetId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete series asset error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
