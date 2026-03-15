import { createClient } from '@/lib/supabase/server';
import {
  createAssetVariant,
  getSeries,
  listAssetVariants,
} from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string; assetId: string }> };

// GET /api/series/[id]/assets/[assetId]/variants
export async function GET(_req: NextRequest, context: RouteContext) {
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

    const variants = await listAssetVariants(supabase, assetId);
    return NextResponse.json({ variants });
  } catch (error) {
    console.error('List asset variants error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/series/[id]/assets/[assetId]/variants
export async function POST(req: NextRequest, context: RouteContext) {
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
    const { label, description, is_default } = body;

    if (!label || typeof label !== 'string' || label.trim().length === 0) {
      return NextResponse.json({ error: 'Label is required' }, { status: 400 });
    }

    const variant = await createAssetVariant(supabase, assetId, {
      label: label.trim(),
      description: description?.trim() || undefined,
      is_default: Boolean(is_default),
    });

    return NextResponse.json({ variant }, { status: 201 });
  } catch (error) {
    console.error('Create asset variant error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
