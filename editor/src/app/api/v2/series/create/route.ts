import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';

type AssetInput = {
  name: string;
  description?: string;
};

type CharacterSeed = AssetInput & {
  character_id: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAssets(input: unknown): AssetInput[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      if (!isRecord(item)) return null;
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const description =
        typeof item.description === 'string' ? item.description.trim() : '';

      if (!name) return null;
      return {
        name,
        ...(description ? { description } : {}),
      };
    })
    .filter((item): item is AssetInput => !!item);
}

async function resolveOrCreateCharacter(
  // biome-ignore lint/suspicious/noExplicitAny: existing repo uses untyped service client for DB routes
  dbClient: any,
  userId: string,
  character: AssetInput
): Promise<string | null> {
  const { data: existing } = await dbClient
    .from('characters')
    .select('id')
    .eq('user_id', userId)
    .eq('name', character.name)
    .maybeSingle();

  if (existing?.id) {
    return existing.id as string;
  }

  const { data: created, error } = await dbClient
    .from('characters')
    .insert({
      user_id: userId,
      name: character.name,
      description: character.description ?? null,
      tags: [],
    })
    .select('id')
    .single();

  if (error || !created?.id) {
    console.error('[v2/series/create] Failed to create character:', error);
    return null;
  }

  return created.id as string;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const genre = typeof body?.genre === 'string' ? body.genre.trim() : null;
    const tone = typeof body?.tone === 'string' ? body.tone.trim() : null;
    const requestedProjectId =
      typeof body?.project_id === 'string' ? body.project_id.trim() : '';
    const metadata = isRecord(body?.metadata) ? body.metadata : {};

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const characters = normalizeAssets(body?.characters);
    const locations = normalizeAssets(body?.locations);
    const props = normalizeAssets(body?.props);

    const dbClient = createServiceClient('studio');

    const { data: series, error: seriesError } = await dbClient
      .from('series')
      .insert({
        user_id: user.id,
        name,
        genre,
        tone,
        metadata,
      })
      .select('id')
      .single();

    if (seriesError || !series?.id) {
      console.error('[v2/series/create] Failed to create series:', seriesError);
      return NextResponse.json(
        { error: 'Failed to create series' },
        { status: 500 }
      );
    }

    const seriesId = series.id as string;

    let projectId = '';

    if (requestedProjectId) {
      const { data: existingProject, error: projectLookupError } =
        await dbClient
          .from('projects')
          .select('id, settings')
          .eq('id', requestedProjectId)
          .eq('user_id', user.id)
          .single();

      if (projectLookupError || !existingProject?.id) {
        return NextResponse.json(
          { error: 'Project not found' },
          { status: 404 }
        );
      }

      projectId = existingProject.id as string;

      const existingSettings = isRecord(existingProject.settings)
        ? existingProject.settings
        : {};

      const { error: projectSettingsError } = await dbClient
        .from('projects')
        .update({
          settings: {
            ...existingSettings,
            series_id: seriesId,
          },
        })
        .eq('id', projectId)
        .eq('user_id', user.id);

      if (projectSettingsError) {
        console.error(
          '[v2/series/create] Failed to update project settings:',
          projectSettingsError
        );
        return NextResponse.json(
          { error: 'Failed to update project settings' },
          { status: 500 }
        );
      }
    } else {
      const { data: project, error: projectError } = await dbClient
        .from('projects')
        .insert({
          user_id: user.id,
          name,
          settings: { series_id: seriesId },
        })
        .select('id')
        .single();

      if (projectError || !project?.id) {
        console.error(
          '[v2/series/create] Failed to create project:',
          projectError
        );
        return NextResponse.json(
          { error: 'Failed to create project' },
          { status: 500 }
        );
      }

      projectId = project.id as string;
    }

    const { error: seriesProjectUpdateError } = await dbClient
      .from('series')
      .update({ project_id: projectId })
      .eq('id', seriesId)
      .eq('user_id', user.id);

    if (seriesProjectUpdateError) {
      console.error(
        '[v2/series/create] Failed to link series to project:',
        seriesProjectUpdateError
      );
      return NextResponse.json(
        { error: 'Failed to link series and project' },
        { status: 500 }
      );
    }

    const characterSeeds: CharacterSeed[] = [];
    for (const character of characters) {
      const characterId = await resolveOrCreateCharacter(
        dbClient,
        user.id,
        character
      );
      characterSeeds.push({ ...character, character_id: characterId });
    }

    const { data: characterRows, error: characterInsertError } = await dbClient
      .from('series_assets')
      .insert(
        characterSeeds.map((asset, index) => ({
          series_id: seriesId,
          type: 'character',
          name: asset.name,
          description: asset.description ?? null,
          character_id: asset.character_id,
          sort_order: index,
        }))
      )
      .select('id, character_id, sort_order');

    if (characterInsertError) {
      console.error(
        '[v2/series/create] Failed to create character assets:',
        characterInsertError
      );
      return NextResponse.json(
        { error: 'Failed to create character assets' },
        { status: 500 }
      );
    }

    const characterAssetIds = (characterRows ?? [])
      .map((row: { id?: string }) => row.id)
      .filter((id: string | undefined): id is string => !!id);

    const { data: locationRows, error: locationInsertError } = await dbClient
      .from('series_assets')
      .insert(
        locations.map((asset, index) => ({
          series_id: seriesId,
          type: 'location',
          name: asset.name,
          description: asset.description ?? null,
          sort_order: characters.length + index,
        }))
      )
      .select('id');

    if (locationInsertError) {
      console.error(
        '[v2/series/create] Failed to create location assets:',
        locationInsertError
      );
      return NextResponse.json(
        { error: 'Failed to create location assets' },
        { status: 500 }
      );
    }

    const locationAssetIds = (locationRows ?? [])
      .map((row: { id?: string }) => row.id)
      .filter((id: string | undefined): id is string => !!id);

    const { data: propRows, error: propInsertError } = await dbClient
      .from('series_assets')
      .insert(
        props.map((asset, index) => ({
          series_id: seriesId,
          type: 'prop',
          name: asset.name,
          description: asset.description ?? null,
          sort_order: characters.length + locations.length + index,
        }))
      )
      .select('id');

    if (propInsertError) {
      console.error(
        '[v2/series/create] Failed to create prop assets:',
        propInsertError
      );
      return NextResponse.json(
        { error: 'Failed to create prop assets' },
        { status: 500 }
      );
    }

    const propAssetIds = (propRows ?? [])
      .map((row: { id?: string }) => row.id)
      .filter((id: string | undefined): id is string => !!id);

    const projectCharacterRows = (characterRows ?? [])
      .filter((row: { character_id?: string | null }) => !!row.character_id)
      .map((row: { character_id: string; sort_order: number }) => ({
        project_id: projectId,
        character_id: row.character_id,
        element_index: row.sort_order + 1,
        role: 'main',
      }));

    if (projectCharacterRows.length > 0) {
      const { error: projectCharacterError } = await dbClient
        .from('project_characters')
        .insert(projectCharacterRows);

      if (projectCharacterError) {
        console.error(
          '[v2/series/create] Failed to bind project characters:',
          projectCharacterError
        );
      }
    }

    return NextResponse.json(
      {
        series_id: seriesId,
        project_id: projectId,
        asset_ids: {
          characters: characterAssetIds,
          locations: locationAssetIds,
          props: propAssetIds,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v2/series/create] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
