import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import {
  deleteEpisode,
  getSeries,
  updateEpisode,
} from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string; episodeId: string }> };

// PUT /api/series/[id]/episodes/[episodeId]
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id, episodeId } = await context.params;
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

    if (body.episode_number !== undefined) {
      if (typeof body.episode_number !== 'number' || body.episode_number < 1) {
        return NextResponse.json(
          { error: 'episode_number must be a positive integer' },
          { status: 400 }
        );
      }
      updates.episode_number = body.episode_number;
    }
    if (body.title !== undefined) updates.title = body.title || null;
    if (body.synopsis !== undefined) updates.synopsis = body.synopsis || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const episode = await updateEpisode(dbClient, episodeId, updates);
    return NextResponse.json({ episode });
  } catch (error) {
    console.error('Update episode error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/series/[id]/episodes/[episodeId]
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id, episodeId } = await context.params;
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

    await deleteEpisode(dbClient, episodeId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete episode error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
