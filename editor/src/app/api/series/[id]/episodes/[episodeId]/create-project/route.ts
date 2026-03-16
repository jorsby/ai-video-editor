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
 * Creates (or reuses) a single shared project for the series, then creates a
 * storyboard inside that project for this episode.
 *
 * Architecture: 1 project per series — all episodes share the same project_id.
 * Each episode gets its own storyboard inside the shared project.
 * Characters are only bound on the first (project-creation) call.
 *
 * Returns: { project_id, storyboard_id, created_project, created_storyboard, characters_bound }
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

    // Get this episode
    const { data: episode, error: epErr } = await dbClient
      .from('series_episodes')
      .select('*')
      .eq('id', episodeId)
      .eq('series_id', seriesId)
      .single();

    if (epErr || !episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    // ── Step 1: Resolve the shared project for this series ─────────────────
    // Look for any episode in this series that already has a project_id.
    const { data: sibling } = await dbClient
      .from('series_episodes')
      .select('project_id')
      .eq('series_id', seriesId)
      .not('project_id', 'is', null)
      .limit(1)
      .maybeSingle();

    // The shared project_id (may already exist from a sibling episode)
    const existingProjectId: string | null =
      episode.project_id ?? sibling?.project_id ?? null;

    let projectId: string;
    let createdProject = false;
    let charactersBound = 0;

    if (existingProjectId) {
      // Reuse the existing shared project
      projectId = existingProjectId;
    } else {
      // First episode for this series — create ONE shared project named after the series
      const { data: project, error: projErr } = await dbClient
        .from('projects')
        .insert({
          user_id: user.id,
          name: series.name,
          settings: {
            series_id: seriesId,
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

      projectId = project.id;
      createdProject = true;

      // Bind series characters to the new project (only on first creation)
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

      if (charAssets?.length) {
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

            // Copy images to character_images
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
              project_id: projectId,
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
    }

    // ── Step 2: Link this episode to the shared project ────────────────────
    if (!episode.project_id) {
      const { error: linkErr } = await dbClient
        .from('series_episodes')
        .update({ project_id: projectId })
        .eq('id', episodeId);

      if (linkErr) {
        console.error('Link episode to project error:', linkErr);
      }
    }

    // ── Step 3: Create a storyboard for this episode ───────────────────────
    // Check if a storyboard already exists for this episode (identified by title)
    const storyboardTitle = `EP${episode.episode_number}: ${episode.title ?? 'Untitled'}`;

    const { data: existingStoryboard } = await dbClient
      .from('storyboards')
      .select('id')
      .eq('project_id', projectId)
      .eq('title', storyboardTitle)
      .maybeSingle();

    if (existingStoryboard) {
      // Already created — return existing
      return NextResponse.json({
        project_id: projectId,
        storyboard_id: existingStoryboard.id,
        created_project: createdProject,
        created_storyboard: false,
        characters_bound: charactersBound,
      });
    }

    // Get next sort_order for the new storyboard
    const { data: maxSort } = await dbClient
      .from('storyboards')
      .select('sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSort = (maxSort?.sort_order ?? -1) + 1;

    const { data: storyboard, error: sbErr } = await dbClient
      .from('storyboards')
      .insert({
        project_id: projectId,
        title: storyboardTitle,
        plan_status: 'draft',
        mode: 'ref_to_video',
        voiceover: episode.synopsis ?? episode.title ?? '',
        is_active: nextSort === 0, // First storyboard is active
        sort_order: nextSort,
        input_type: 'voiceover_script',
      })
      .select('id')
      .single();

    if (sbErr || !storyboard) {
      console.error('Create storyboard error:', sbErr);
      return NextResponse.json(
        { error: 'Failed to create storyboard' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        project_id: projectId,
        storyboard_id: storyboard.id,
        created_project: createdProject,
        created_storyboard: true,
        characters_bound: charactersBound,
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
