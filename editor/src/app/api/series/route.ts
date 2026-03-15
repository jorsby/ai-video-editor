import { createClient } from '@/lib/supabase/server';
import { createSeries, listSeries } from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

// GET /api/series — list all series for the authenticated user
export async function GET() {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const series = await listSeries(supabase, user.id);
    return NextResponse.json({ series });
  } catch (error) {
    console.error('List series error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/series — create a new series
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name, genre, tone, bible, visual_style } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const series = await createSeries(supabase, user.id, {
      name: name.trim(),
      genre: genre?.trim() || undefined,
      tone: tone?.trim() || undefined,
      bible: bible?.trim() || undefined,
      visual_style: visual_style ?? {},
    });

    return NextResponse.json({ series }, { status: 201 });
  } catch (error) {
    console.error('Create series error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
