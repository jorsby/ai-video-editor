import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import { createSeries, listSeries } from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

// GET /api/series — list all series for the authenticated user
export async function GET(req: NextRequest) {
  try {
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
    const series = await listSeries(dbClient, user.id);
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

    const body = await req.json();
    const { name, genre, tone, bible, visual_style } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');
    const series = await createSeries(dbClient, user.id, {
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
