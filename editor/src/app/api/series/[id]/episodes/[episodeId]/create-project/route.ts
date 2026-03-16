import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import { getSeries } from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = {
  params: Promise<{ id: string; episodeId: string }>;
};

/**
 * POST /api/series/{id}/episodes/{episodeId}/create-project
 *
 * Creates a project for an episode and binds series characters to it.
 * If the episode already has a project, returns the existing project.
 *
 * Returns: { project_id, created, characters_bound }
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: seriesId, episodeId } = await context.params;
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

    // Verify series ownership
    const series = await getSeries(dbClient, seriesId, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    // Get episode
    const { data: episode, error: epErr } = await dbClient
      .from('series_episodes')
      .select('*')
      .eq('id', episodeId)
      .eq('series_id', seriesId)
      .single();

    if (epErr || !episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    // If episode already has a project, return it
    if (episode.project_id) {
      // Count existing character bindings
      const { count } = await dbClient
        .from('project_characters')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', episode.project_id);

      return NextResponse.json({
        project_id: episode.project_id,
        created: false,
        characters_bound: count ?? 0,
      });
    }

    // Create new project
    const projectName = `${series.name} — EP${episode.episode_number}: ${episode.title || 'Untitled'}`;
    const { data: project, error: projErr } = await dbClient
      .from('projects')
      .insert({
        user_id: user.id,
        name: projectName,
        settings: {
          series_id: seriesId,
          episode_id: episodeId,
          episode_number: episode.episode_number,
        },
      })
      .select('id')
      .single();

    if (projErr || !project) {
      console.error('Create project error:', projErr);
      return NextResponse.json(
        { error: 'Failed to create project' },
        { status: 500 }
      );
    }

    // Link episode to project
    const { error: linkErr } = await dbClient
      .from('series_episodes')
      .update({ project_id: project.id })
      .eq('id', episodeId);

    if (linkErr) {
      console.error('Link episode error:', linkErr);
    }

    // Bind series characters to project
    // Get all character assets with their frontal images
    const { data: charAssets } = await dbClient
      .from('series_assets')
      .select(
        `
        id, name, description,
        series_asset_variants (
          id,
          series_asset_variant_images (id, url, angle)
        )
      `
      )
      .eq('series_id', seriesId)
      .eq('type', 'character');

    let charactersBound = 0;

    if (charAssets?.length) {
      // Check if characters exist in the characters table (universal character library)
      // If not, create them from series assets
      for (let idx = 0; idx < charAssets.length; idx++) {
        const asset = charAssets[idx];
        const variants = asset.series_asset_variants ?? [];
        const allImages = variants.flatMap(
          (v: {
            series_asset_variant_images?: Array<{
              id: string;
              url: string;
              angle: string;
            }>;
          }) => v.series_asset_variant_images ?? []
        );

        // Check if a character with this name already exists for this user
        const { data: existingChar } = await dbClient
          .from('characters')
          .select('id')
          .eq('user_id', user.id)
          .eq('name', asset.name)
          .maybeSingle();

        let characterId: string;

        if (existingChar) {
          characterId = existingChar.id;
        } else {
          // Create character in universal library
          const { data: newChar, error: charErr } = await dbClient
            .from('characters')
            .insert({
              user_id: user.id,
              name: asset.name,
              description: asset.description,
              tags: [],
            })
            .select('id')
            .single();

          if (charErr || !newChar) {
            console.error('Create character error:', charErr);
            continue;
          }
          characterId = newChar.id;

          // Copy frontal images to character_images
          for (const img of allImages) {
            if (img.url) {
              await dbClient.from('character_images').insert({
                character_id: characterId,
                angle: img.angle ?? 'frontal',
                url: img.url,
              });
            }
          }
        }

        // Bind character to project
        const frontalImageIds = allImages
          .filter(
            (img: { angle: string }) =>
              img.angle === 'front' || img.angle === 'frontal'
          )
          .map((img: { id: string }) => img.id);

        const { error: bindErr } = await dbClient
          .from('project_characters')
          .insert({
            project_id: project.id,
            character_id: characterId,
            element_index: idx,
            role: 'main',
            description_snapshot: asset.description,
            resolved_image_ids:
              frontalImageIds.length > 0 ? frontalImageIds : null,
          });

        if (!bindErr) charactersBound++;
      }
    }

    return NextResponse.json(
      {
        project_id: project.id,
        created: true,
        characters_bound: charactersBound,
        project_name: projectName,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create episode project error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
