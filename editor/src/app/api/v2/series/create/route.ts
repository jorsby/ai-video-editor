import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { slugify } from '@/lib/utils/slugify';

type AssetInput = {
  name: string;
  description?: string;
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
    const language =
      typeof body?.language === 'string' ? body.language.trim() : null;
    const voiceId =
      typeof body?.voice_id === 'string' ? body.voice_id.trim() : null;
    const ttsSpeed =
      typeof body?.tts_speed === 'number' ? body.tts_speed : null;
    const videoModel =
      typeof body?.video_model === 'string' ? body.video_model.trim() : null;
    const imageModel =
      typeof body?.image_model === 'string' ? body.image_model.trim() : null;
    const aspectRatio =
      typeof body?.aspect_ratio === 'string' ? body.aspect_ratio.trim() : null;
    const visualStyle =
      typeof body?.visual_style === 'string' ? body.visual_style.trim() : null;
    const requestedProjectId =
      typeof body?.project_id === 'string' ? body.project_id.trim() : '';

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // Required production settings — no fallbacks
    const missingFields: string[] = [];
    if (!voiceId) missingFields.push('voice_id');
    if (ttsSpeed === null) missingFields.push('tts_speed');
    if (!videoModel) missingFields.push('video_model');
    if (!imageModel) missingFields.push('image_model');

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missingFields.join(', ')}` },
        { status: 400 }
      );
    }

    const characters = normalizeAssets(body?.characters);
    const locations = normalizeAssets(body?.locations);
    const props = normalizeAssets(body?.props);

    const dbClient = createServiceClient('studio');

    // --- Resolve or create project FIRST (series.project_id is NOT NULL) ---
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
    } else {
      const { data: project, error: projectError } = await dbClient
        .from('projects')
        .insert({
          user_id: user.id,
          name,
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

    // --- Create series with project_id ---
    const { data: series, error: seriesError } = await dbClient
      .from('series')
      .insert({
        user_id: user.id,
        project_id: projectId,
        name,
        genre,
        tone,
        language,
        voice_id: voiceId,
        tts_speed: ttsSpeed,
        video_model: videoModel,
        image_model: imageModel,
        aspect_ratio: aspectRatio,
        visual_style: visualStyle,
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

    // --- Update project settings with series_id ---
    const existingSettings = requestedProjectId
      ? await dbClient
          .from('projects')
          .select('settings')
          .eq('id', projectId)
          .single()
          .then(
            (r: { data: { settings: unknown } | null }) =>
              (isRecord(r.data?.settings) ? r.data!.settings : {}) as Record<
                string,
                unknown
              >
          )
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
      // Non-fatal — series + project already created and linked
    }

    // --- Batch-insert assets (skip if empty) ---
    const assetTypes = [
      { key: 'characters', type: 'character', items: characters, offset: 0 },
      {
        key: 'locations',
        type: 'location',
        items: locations,
        offset: characters.length,
      },
      {
        key: 'props',
        type: 'prop',
        items: props,
        offset: characters.length + locations.length,
      },
    ] as const;

    const assetIds: Record<string, string[]> = {
      characters: [],
      locations: [],
      props: [],
    };
    const createdAssetsForVariants: Array<{
      id: string;
      slug: string | null;
      name: string;
      description: string | null;
    }> = [];

    for (const { key, type, items, offset } of assetTypes) {
      if (items.length === 0) continue;

      const { data: rows, error: insertError } = await dbClient
        .from('project_assets')
        .insert(
          items.map((asset, index) => ({
            project_id: projectId,
            type,
            name: asset.name,
            slug: slugify(asset.name),
            description: asset.description ?? null,
            sort_order: offset + index,
          }))
        )
        .select('id, slug, name, description');

      if (insertError) {
        console.error(
          `[v2/series/create] Failed to create ${type} assets:`,
          insertError
        );
        return NextResponse.json(
          { error: `Failed to create ${type} assets` },
          { status: 500 }
        );
      }

      assetIds[key] = (rows ?? [])
        .map((row: { id?: string }) => row.id)
        .filter((id: string | undefined): id is string => !!id);

      for (const row of rows ?? []) {
        createdAssetsForVariants.push({
          id: row.id as string,
          slug: typeof row.slug === 'string' ? row.slug : null,
          name: (row.name as string) ?? 'Asset',
          description:
            typeof row.description === 'string' ? row.description : null,
        });
      }
    }

    if (createdAssetsForVariants.length > 0) {
      const variantRows = createdAssetsForVariants.map((asset) => {
        const assetSlug = asset.slug ?? slugify(asset.name);
        return {
          asset_id: asset.id,
          name: 'Main',
          slug: `${assetSlug}-main`,
          prompt: asset.description ?? `${asset.name} reference`,
          image_url: null,
          is_main: true,
          where_to_use: asset.description ?? 'Main reference variant',
          reasoning: '',
          image_gen_status: 'idle',
        };
      });

      const { error: variantError } = await dbClient
        .from('project_asset_variants')
        .insert(variantRows);

      if (variantError) {
        console.error(
          '[v2/series/create] Failed to create default variants:',
          variantError
        );
        return NextResponse.json(
          { error: 'Failed to create default asset variants' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      {
        series_id: seriesId,
        project_id: projectId,
        asset_ids: assetIds,
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
