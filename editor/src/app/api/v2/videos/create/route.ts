import { type NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { slugify } from '@/lib/utils/slugify';
import {
  ASSET_FK_BY_TYPE,
  ASSET_TABLE_BY_TYPE,
  VARIANT_TABLE_BY_TYPE,
  type AssetType,
} from '@/lib/api/variant-table-resolver';

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
    const language =
      typeof body?.language === 'string' ? body.language.trim() : null;
    const voiceId =
      typeof body?.voice_id === 'string' ? body.voice_id.trim() : null;
    const ttsSpeed =
      typeof body?.tts_speed === 'number' ? body.tts_speed : null;
    const videoModel =
      typeof body?.video_model === 'string' ? body.video_model.trim() : null;
    const videoResolution =
      typeof body?.video_resolution === 'string'
        ? body.video_resolution.trim()
        : null;
    const aspectRatio =
      typeof body?.aspect_ratio === 'string' ? body.aspect_ratio.trim() : null;
    const imageModels = isRecord(body?.image_models) ? body.image_models : null;
    const requestedProjectId =
      typeof body?.project_id === 'string' ? body.project_id.trim() : '';

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const characters = normalizeAssets(body?.characters);
    const locations = normalizeAssets(body?.locations);
    const props = normalizeAssets(body?.props);

    const dbClient = createServiceClient('studio');

    // --- Resolve or create project FIRST (video.project_id is NOT NULL) ---
    let projectId = '';
    let existingGenerationSettings: Record<string, unknown> = {};

    if (requestedProjectId) {
      const { data: existingProject, error: projectLookupError } =
        await dbClient
          .from('projects')
          .select('id, generation_settings')
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
      if (isRecord(existingProject.generation_settings)) {
        existingGenerationSettings = existingProject.generation_settings;
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

    // --- Merge explicit values with project generation_settings defaults ---
    const defStr = (key: string) =>
      typeof existingGenerationSettings[key] === 'string'
        ? (existingGenerationSettings[key] as string)
        : null;
    const defNum = (key: string) =>
      typeof existingGenerationSettings[key] === 'number'
        ? (existingGenerationSettings[key] as number)
        : null;

    const finalVoiceId = voiceId ?? defStr('voice_id');
    const finalTtsSpeed = ttsSpeed ?? defNum('tts_speed');
    const finalLanguage = language ?? defStr('language');
    const finalVideoModel = videoModel ?? defStr('video_model');
    const finalAspectRatio = aspectRatio ?? defStr('aspect_ratio');
    const finalVideoResolution = videoResolution ?? defStr('video_resolution');
    const finalImageModels =
      imageModels ??
      (isRecord(existingGenerationSettings.image_models)
        ? (existingGenerationSettings.image_models as Record<string, unknown>)
        : null);

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

    // --- Persist generation settings on the project (source of truth) ---
    const updatedGenerationSettings: Record<string, unknown> = {
      ...existingGenerationSettings,
      voice_id: finalVoiceId,
      tts_speed: finalTtsSpeed,
      ...(finalLanguage ? { language: finalLanguage } : {}),
      video_model: finalVideoModel,
      ...(finalAspectRatio ? { aspect_ratio: finalAspectRatio } : {}),
      ...(finalVideoResolution
        ? { video_resolution: finalVideoResolution }
        : {}),
      ...(finalImageModels ? { image_models: finalImageModels } : {}),
    };

    const { error: settingsUpdateError } = await dbClient
      .from('projects')
      .update({ generation_settings: updatedGenerationSettings })
      .eq('id', projectId);

    if (settingsUpdateError) {
      console.error(
        '[v2/video/create] Failed to update project generation_settings:',
        settingsUpdateError
      );
      return NextResponse.json(
        { error: 'Failed to persist project settings' },
        { status: 500 }
      );
    }

    // --- Create video (only schema-valid columns remain here) ---
    const { data: video, error: videoError } = await dbClient
      .from('videos')
      .insert({
        user_id: user.id,
        project_id: projectId,
        name,
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

    // --- Batch-insert assets across the three typed tables ---
    const assetBuckets: Array<{
      key: 'characters' | 'locations' | 'props';
      type: AssetType;
      items: AssetInput[];
      offset: number;
    }> = [
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
    ];

    const assetIds: Record<string, string[]> = {
      characters: [],
      locations: [],
      props: [],
    };

    type CreatedAsset = {
      id: string;
      slug: string;
      name: string;
      description: string | null;
      type: AssetType;
    };
    const createdAssetsForVariants: CreatedAsset[] = [];

    for (const { key, type, items, offset } of assetBuckets) {
      if (items.length === 0) continue;

      const parentTable = ASSET_TABLE_BY_TYPE[type];

      const { data: rows, error: insertError } = await dbClient
        .from(parentTable)
        .upsert(
          items.map((asset, index) => ({
            project_id: projectId,
            video_id: videoId,
            name: asset.name,
            slug: slugify(asset.name),
            use_case: asset.description ?? null,
            sort_order: offset + index,
          })),
          { onConflict: 'project_id,slug', ignoreDuplicates: false }
        )
        .select('id, slug, name, use_case');

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

      assetIds[key] = ((rows ?? []) as Array<{ id?: string }>)
        .map((row) => row.id)
        .filter((id): id is string => !!id);

      for (const row of (rows ?? []) as Array<{
        id: string;
        slug: string | null;
        name: string;
        use_case: string | null;
      }>) {
        createdAssetsForVariants.push({
          id: row.id,
          slug: typeof row.slug === 'string' ? row.slug : slugify(row.name),
          name: row.name ?? 'Asset',
          description: typeof row.use_case === 'string' ? row.use_case : null,
          type,
        });
      }
    }

    // --- Main variants: one per typed variant table ---
    const variantsByType: Record<AssetType, Array<Record<string, unknown>>> = {
      character: [],
      location: [],
      prop: [],
    };

    for (const asset of createdAssetsForVariants) {
      const fk = ASSET_FK_BY_TYPE[asset.type];
      variantsByType[asset.type].push({
        [fk]: asset.id,
        name: 'Main',
        slug: `${asset.slug}-main`,
        is_main: true,
        image_url: null,
        image_gen_status: 'idle',
        structured_prompt: {
          prompt: asset.description ?? `${asset.name} reference`,
        },
      });
    }

    for (const [type, variantRows] of Object.entries(variantsByType) as Array<
      [AssetType, Array<Record<string, unknown>>]
    >) {
      if (variantRows.length === 0) continue;
      const variantTable = VARIANT_TABLE_BY_TYPE[type];
      const { error: variantError } = await dbClient
        .from(variantTable)
        .insert(variantRows);

      if (variantError) {
        console.error(
          `[v2/video/create] Failed to create ${type} main variants:`,
          variantError
        );
        return NextResponse.json(
          { error: `Failed to create default ${type} variants` },
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
