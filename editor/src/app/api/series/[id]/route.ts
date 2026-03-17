import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import {
  deleteSeries,
  getSeriesWithAssets,
  updateSeries,
} from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseSeriesUpdates(body: Record<string, unknown>) {
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return {
        error: NextResponse.json(
          { error: 'Name cannot be empty' },
          { status: 400 }
        ),
      };
    }
    updates.name = body.name.trim();
  }

  if (body.genre !== undefined) {
    updates.genre = typeof body.genre === 'string' ? body.genre.trim() : null;
  }

  if (body.tone !== undefined) {
    updates.tone = typeof body.tone === 'string' ? body.tone.trim() : null;
  }

  if (body.bible !== undefined) {
    updates.bible = body.bible || null;
  }

  if (body.visual_style !== undefined) {
    if (body.visual_style !== null && !isRecord(body.visual_style)) {
      return {
        error: NextResponse.json(
          { error: 'visual_style must be an object' },
          { status: 400 }
        ),
      };
    }

    updates.visual_style = body.visual_style ?? {};
  }

  if (body.metadata !== undefined) {
    if (body.metadata !== null && !isRecord(body.metadata)) {
      return {
        error: NextResponse.json(
          { error: 'metadata must be an object' },
          { status: 400 }
        ),
      };
    }

    updates.metadata = body.metadata ?? {};
  }

  if (Object.keys(updates).length === 0) {
    return {
      error: NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      ),
    };
  }

  return { updates };
}

// GET /api/series/[id] — get series with all assets/variants
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
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

    // Use service-role client so private storage URLs can always be signed.
    const dbClient = createServiceClient('studio');
    const series = await getSeriesWithAssets(dbClient, id, user.id);
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

async function updateSeriesHandler(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
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

    const body = (await req.json()) as Record<string, unknown>;
    const parsed = parseSeriesUpdates(body);

    if ('error' in parsed) {
      return parsed.error;
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');
    const series = await updateSeries(dbClient, id, user.id, parsed.updates);
    return NextResponse.json({ series });
  } catch (error) {
    console.error('Update series error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/series/[id] — update series
export async function PUT(req: NextRequest, context: RouteContext) {
  return updateSeriesHandler(req, context);
}

// PATCH /api/series/[id] — partial update series (metadata, prompts, etc.)
export async function PATCH(req: NextRequest, context: RouteContext) {
  return updateSeriesHandler(req, context);
}

// DELETE /api/series/[id] — delete series (cascades to all assets/episodes)
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
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
    const existing = await getSeriesWithAssets(dbClient, id, user.id);
    if (!existing) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    await deleteSeries(dbClient, id, user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete series error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
