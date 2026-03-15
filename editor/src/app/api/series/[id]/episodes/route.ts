import { createClient } from '@/lib/supabase/server';
import {
  createEpisode,
  getSeries,
  listEpisodes,
} from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/series/[id]/episodes
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

    const series = await getSeries(supabase, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const episodes = await listEpisodes(supabase, id);
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

    const episode = await createEpisode(supabase, id, {
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
