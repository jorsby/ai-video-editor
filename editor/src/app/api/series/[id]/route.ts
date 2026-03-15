import { createClient } from '@/lib/supabase/server';
import {
  deleteSeries,
  getSeriesWithAssets,
  updateSeries,
} from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/series/[id] — get series with all assets/variants
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const series = await getSeriesWithAssets(supabase, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    return NextResponse.json({ series });
  } catch (error) {
    console.error('Get series error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/series/[id] — update series
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    if (body.genre !== undefined) updates.genre = body.genre?.trim() || null;
    if (body.tone !== undefined) updates.tone = body.tone?.trim() || null;
    if (body.bible !== undefined) updates.bible = body.bible || null;
    if (body.visual_style !== undefined)
      updates.visual_style = body.visual_style;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const series = await updateSeries(supabase, id, user.id, updates);
    return NextResponse.json({ series });
  } catch (error) {
    console.error('Update series error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/series/[id] — delete series (cascades to all assets/episodes)
export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const existing = await getSeriesWithAssets(supabase, id, user.id);
    if (!existing) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    await deleteSeries(supabase, id, user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete series error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
