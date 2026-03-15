import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import {
  createSeriesAsset,
  createAssetVariant,
  createEpisode,
} from '@/lib/supabase/series-service';

type RouteContext = { params: Promise<{ id: string }> };

interface PlanCharacter {
  name: string;
  role?: string;
  description?: string;
  personality?: string;
  relationships?: string;
  appearance?: string;
}

interface PlanLocation {
  name: string;
  description?: string;
  atmosphere?: string;
}

interface PlanProp {
  name: string;
  description?: string;
}

interface PlanEpisode {
  number: number;
  title?: string;
  synopsis?: string;
  featured_characters?: string[];
}

interface SeriesPlanDraft {
  bible?: string;
  characters?: PlanCharacter[];
  locations?: PlanLocation[];
  props?: PlanProp[];
  episodes?: PlanEpisode[];
}

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

    // Load series with plan_draft
    const { data: series, error: seriesError } = await dbClient
      .from('series')
      .select('id, name, plan_draft, plan_status')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (seriesError || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    if (series.plan_status === 'finalized') {
      return NextResponse.json(
        { error: 'Series is already finalized' },
        { status: 400 }
      );
    }

    const plan = series.plan_draft as SeriesPlanDraft | null;
    if (!plan) {
      return NextResponse.json(
        { error: 'No plan draft found. Chat with the AI first.' },
        { status: 400 }
      );
    }

    const characters = plan.characters ?? [];
    const locations = plan.locations ?? [];
    const props = plan.props ?? [];
    const episodes = plan.episodes ?? [];

    if (characters.length === 0 && episodes.length === 0) {
      return NextResponse.json(
        { error: 'Plan must have at least one character and one episode' },
        { status: 400 }
      );
    }

    const createdAssets: Array<{
      id: string;
      type: string;
      name: string;
      variant_id: string;
    }> = [];
    const createdEpisodes: Array<{
      id: string;
      episode_number: number;
      title: string | null;
    }> = [];

    // Create assets for characters
    for (let i = 0; i < characters.length; i++) {
      const char = characters[i];
      if (!char.name) continue;

      const descParts = [
        char.description,
        char.personality ? `Personality: ${char.personality}` : null,
        char.relationships ? `Relationships: ${char.relationships}` : null,
        char.appearance ? `Appearance: ${char.appearance}` : null,
      ].filter(Boolean);

      const asset = await createSeriesAsset(dbClient, id, {
        type: 'character',
        name: char.name,
        description: descParts.join('\n') || undefined,
        tags: char.role ? [char.role] : [],
        sort_order: i,
      });

      const variant = await createAssetVariant(dbClient, asset.id, {
        label: 'Default',
        description: char.appearance || undefined,
        is_default: true,
      });

      createdAssets.push({
        id: asset.id,
        type: 'character',
        name: asset.name,
        variant_id: variant.id,
      });
    }

    // Create assets for locations
    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      if (!loc.name) continue;

      const descParts = [
        loc.description,
        loc.atmosphere ? `Atmosphere: ${loc.atmosphere}` : null,
      ].filter(Boolean);

      const asset = await createSeriesAsset(dbClient, id, {
        type: 'location',
        name: loc.name,
        description: descParts.join('\n') || undefined,
        sort_order: i,
      });

      const variant = await createAssetVariant(dbClient, asset.id, {
        label: 'Default',
        description: loc.atmosphere || undefined,
        is_default: true,
      });

      createdAssets.push({
        id: asset.id,
        type: 'location',
        name: asset.name,
        variant_id: variant.id,
      });
    }

    // Create assets for props
    for (let i = 0; i < props.length; i++) {
      const prop = props[i];
      if (!prop.name) continue;

      const asset = await createSeriesAsset(dbClient, id, {
        type: 'prop',
        name: prop.name,
        description: prop.description || undefined,
        sort_order: i,
      });

      const variant = await createAssetVariant(dbClient, asset.id, {
        label: 'Default',
        is_default: true,
      });

      createdAssets.push({
        id: asset.id,
        type: 'prop',
        name: asset.name,
        variant_id: variant.id,
      });
    }

    // Create episodes: first create a project for each, then link
    for (const ep of episodes) {
      const epNum = ep.number ?? 1;
      const epTitle = ep.title ?? `Episode ${epNum}`;

      // Create a project for this episode
      const { data: project, error: projectError } = await dbClient
        .from('projects')
        .insert({ user_id: user.id, name: `${series.name} — ${epTitle}` })
        .select('id')
        .single();

      if (projectError || !project) {
        console.error('Failed to create project for episode:', projectError);
        continue;
      }

      const episode = await createEpisode(dbClient, id, {
        project_id: project.id,
        episode_number: epNum,
        title: ep.title || undefined,
        synopsis: ep.synopsis || undefined,
      });

      createdEpisodes.push({
        id: episode.id,
        episode_number: episode.episode_number,
        title: episode.title,
      });
    }

    // Update bible if present
    const seriesUpdates: Record<string, unknown> = { plan_status: 'finalized' };
    if (plan.bible) {
      seriesUpdates.bible = plan.bible;
    }

    // Mark series as finalized
    const { error: finalizeError } = await dbClient
      .from('series')
      .update(seriesUpdates)
      .eq('id', id)
      .eq('user_id', user.id);

    if (finalizeError) {
      console.error('Failed to finalize series:', finalizeError);
      return NextResponse.json(
        { error: 'Failed to finalize series' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      assets: createdAssets,
      episodes: createdEpisodes,
    });
  } catch (error) {
    console.error('Finalize series error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
