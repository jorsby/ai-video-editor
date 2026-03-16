import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import {
  createEpisode,
  getSeries,
  listEpisodes,
} from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/series/[id]/episodes
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

    const dbClient = sessionUser ? supabase : createServiceClient('studio');
    const series = await getSeries(dbClient, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const episodes = await listEpisodes(dbClient, id);
    return NextResponse.json({ episodes });
  } catch (error) {
    console.error('List episodes error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/series/[id]/episodes
export async function POST(req: NextRequest, context: RouteContext) {
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
    const series = await getSeries(dbClient, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const body = await req.json();
    const { project_id, episode_number, title, synopsis } = body;

    if (!project_id || typeof project_id !== 'string') {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }
    if (typeof episode_number !== 'number' || episode_number < 1) {
      return NextResponse.json(
        { error: 'episode_number must be a positive integer' },
        { status: 400 }
      );
    }

    const episode = await createEpisode(dbClient, id, {
      project_id,
      episode_number,
      title: title?.trim() || undefined,
      synopsis: synopsis?.trim() || undefined,
    });

    return NextResponse.json({ episode }, { status: 201 });
  } catch (error) {
    console.error('Create episode error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
