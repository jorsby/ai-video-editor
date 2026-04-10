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
    const aspectRatio =
      typeof body?.aspect_ratio === 'string' ? body.aspect_ratio.trim() : null;
    const visualStyle =
      typeof body?.visual_style === 'string' ? body.visual_style.trim() : null;
    const requestedProjectId =
      typeof body?.project_id === 'string' ? body.project_id.trim() : '';

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // Required fields validated after project defaults are applied (below)

    const characters = normalizeAssets(body?.characters);
    const locations = normalizeAssets(body?.locations);
    const props = normalizeAssets(body?.props);

    const dbClient = createServiceClient('studio');

    // --- Resolve or create project FIRST (video.project_id is NOT NULL) ---
    let projectId = '';

    // Project defaults — used to fill in missing fields
    let projectDefaults: Record<string, unknown> = {};

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
      if (
        existingProject.settings &&
        typeof existingProject.settings === 'object'
      ) {
        projectDefaults = existingProject.settings as Record<string, unknown>;
      }
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
          '[v2/video/create] Failed to create project:',
          projectError
        );
        return NextResponse.json(
          { error: 'Failed to create project' },
          { status: 500 }
        );
      }

      projectId = project.id as string;
    }

    // --- Merge explicit values with project defaults ---
    const def = (key: string) =>
      typeof projectDefaults[key] === 'string'
        ? (projectDefaults[key] as string)
        : null;
    const defNum = (key: string) =>
      typeof projectDefaults[key] === 'number'
        ? (projectDefaults[key] as number)
        : null;

    const finalVoiceId = voiceId ?? def('voice_id');
    const finalTtsSpeed = ttsSpeed ?? defNum('tts_speed');
    const finalVideoModel = videoModel ?? def('video_model');
    const finalAspectRatio = aspectRatio ?? def('aspect_ratio');
    const finalVisualStyle = visualStyle ?? def('visual_style');
    const finalVideoResolution = def('video_resolution');
    const finalImageModels =
      projectDefaults.image_models &&
      typeof projectDefaults.image_models === 'object'
        ? projectDefaults.image_models
        : null;

    // Validate required fields after defaults applied
    const missingFields: string[] = [];
    if (!finalVoiceId) missingFields.push('voice_id');
    if (finalTtsSpeed === null) missingFields.push('tts_speed');
    if (!finalVideoModel) missingFields.push('video_model');

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missingFields.join(', ')}` },
        { status: 400 }
      );
    }

    // --- Create video with project_id ---
    const { data: video, error: videoError } = await dbClient
      .from('videos')
      .insert({
        user_id: user.id,
        project_id: projectId,
        name,
        genre: genre ?? def('genre'),
        tone: tone ?? def('tone'),
        language: language ?? def('language'),
        voice_id: finalVoiceId,
        tts_speed: finalTtsSpeed,
        video_model: finalVideoModel,
        ...(finalImageModels ? { image_models: finalImageModels } : {}),
        ...(finalVideoResolution
          ? { video_resolution: finalVideoResolution }
          : {}),
        aspect_ratio: finalAspectRatio,
        visual_style: finalVisualStyle,
      })
      .select('id')
      .single();

    if (videoError || !video?.id) {
      console.error('[v2/video/create] Failed to create video:', videoError);
      return NextResponse.json(
        { error: 'Failed to create video' },
        { status: 500 }
      );
    }

    const videoId = video.id as string;

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

      // Upsert so that creating a second video in the same project
      // reuses existing assets instead of failing on duplicate slugs.
      const { data: rows, error: insertError } = await dbClient
        .from('project_assets')
        .upsert(
          items.map((asset, index) => ({
            project_id: projectId,
            type,
            name: asset.name,
            slug: slugify(asset.name),
            description: asset.description ?? null,
            sort_order: offset + index,
          })),
          { onConflict: 'project_id,slug', ignoreDuplicates: false }
        )
        .select('id, slug, name, description');

      if (insertError) {
        console.error(
          `[v2/video/create] Failed to create ${type} assets:`,
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
          reasoning: '',
          image_gen_status: 'idle',
        };
      });

      const { error: variantError } = await dbClient
        .from('project_asset_variants')
        .insert(variantRows);

      if (variantError) {
        console.error(
          '[v2/video/create] Failed to create default variants:',
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
        video_id: videoId,
        project_id: projectId,
        asset_ids: assetIds,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v2/video/create] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
