import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createLogger, logWorkflowEvent } from '@/lib/logger';
import {
  splitGrid,
  updateObjects,
  updateBackgrounds,
} from '@/lib/grid-splitter';
import {
  resolveSeriesAssetsForProject,
  matchSeriesAsset,
} from '@/lib/supabase/series-asset-resolver';

export async function POST(req: NextRequest) {
  try {
    // Allow service-role key auth for testing/scripts
    const authHeader = req.headers.get('authorization');
    const isServiceRole =
      authHeader === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

    const supabase = isServiceRole
      ? createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { db: { schema: 'studio' } }
        )
      : await createClient('studio');

    if (!isServiceRole) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const { storyboardId, objectsRows, objectsCols, bgRows, bgCols } =
      await req.json();

    if (!storyboardId) {
      return NextResponse.json(
        { error: 'storyboardId is required' },
        { status: 400 }
      );
    }

    // Validate dimension fields
    for (const [name, val] of Object.entries({
      objectsRows,
      objectsCols,
      bgRows,
      bgCols,
    })) {
      if (
        !Number.isInteger(val) ||
        (val as number) < 1 ||
        (val as number) > 6
      ) {
        return NextResponse.json(
          { error: `${name} must be an integer between 1 and 6` },
          { status: 400 }
        );
      }
    }

    // Validate total cell count (2-36)
    const gridPairs = [
      { name: 'objects', rows: objectsRows, cols: objectsCols },
      { name: 'backgrounds', rows: bgRows, cols: bgCols },
    ];
    for (const { name, rows, cols } of gridPairs) {
      const totalCells = rows * cols;
      if (totalCells < 2 || totalCells > 36) {
        return NextResponse.json(
          {
            error: `Invalid ${name} grid: ${rows}x${cols} = ${totalCells} cells. Must be between 2 and 36.`,
          },
          { status: 400 }
        );
      }
    }

    // Fetch storyboard
    const { data: storyboard, error: fetchError } = await supabase
      .from('storyboards')
      .select('*')
      .eq('id', storyboardId)
      .single();

    if (fetchError || !storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    if (storyboard.plan_status !== 'grid_ready') {
      return NextResponse.json(
        { error: 'Storyboard is not in grid_ready status' },
        { status: 400 }
      );
    }

    if (storyboard.mode !== 'ref_to_video') {
      return NextResponse.json(
        { error: 'Storyboard is not in ref_to_video mode' },
        { status: 400 }
      );
    }

    if (!storyboard.plan) {
      return NextResponse.json(
        { error: 'Storyboard has no plan' },
        { status: 400 }
      );
    }

    // Fetch both grid images
    const { data: gridImages, error: gridError } = await supabase
      .from('grid_images')
      .select('*')
      .eq('storyboard_id', storyboardId)
      .in('type', ['objects', 'backgrounds']);

    if (gridError || !gridImages || gridImages.length < 2) {
      return NextResponse.json(
        { error: 'Could not find both grid images' },
        { status: 404 }
      );
    }

    const objectsGrid = gridImages.find(
      (g: { type: string }) => g.type === 'objects'
    );
    const bgGrid = gridImages.find(
      (g: { type: string }) => g.type === 'backgrounds'
    );

    if (!objectsGrid?.url || !bgGrid?.url) {
      return NextResponse.json(
        { error: 'Grid images are not ready' },
        { status: 400 }
      );
    }

    const plan = storyboard.plan;

    // --- Adjust plan arrays when dimensions changed ---
    const newObjectCount = objectsRows * objectsCols;
    const oldObjectCount = plan.objects_rows * plan.objects_cols;
    const newBgCount = bgRows * bgCols;
    const oldBgCount = plan.bg_rows * plan.bg_cols;

    const dimensionsChanged =
      objectsRows !== plan.objects_rows ||
      objectsCols !== plan.objects_cols ||
      bgRows !== plan.bg_rows ||
      bgCols !== plan.bg_cols;

    if (dimensionsChanged) {
      plan.objects_rows = objectsRows;
      plan.objects_cols = objectsCols;
      plan.bg_rows = bgRows;
      plan.bg_cols = bgCols;

      if (newObjectCount !== oldObjectCount) {
        if (Array.isArray(plan.objects)) {
          if (newObjectCount < oldObjectCount) {
            plan.objects = plan.objects.slice(0, newObjectCount);
          } else {
            for (let i = oldObjectCount; i < newObjectCount; i++) {
              plan.objects.push({ name: `Object ${i + 1}`, description: '' });
            }
          }
        }
        if (Array.isArray(plan.object_names)) {
          if (newObjectCount < oldObjectCount) {
            plan.object_names = plan.object_names.slice(0, newObjectCount);
          } else {
            for (let i = oldObjectCount; i < newObjectCount; i++) {
              plan.object_names.push(`Object ${i + 1}`);
            }
          }
        }
        if (Array.isArray(plan.scene_object_indices)) {
          plan.scene_object_indices = plan.scene_object_indices.map(
            (indices: number[]) =>
              indices.filter((idx: number) => idx < newObjectCount)
          );
        }
      }

      if (newBgCount !== oldBgCount) {
        if (Array.isArray(plan.background_names)) {
          if (newBgCount < oldBgCount) {
            plan.background_names = plan.background_names.slice(0, newBgCount);
          } else {
            for (let i = oldBgCount; i < newBgCount; i++) {
              plan.background_names.push(`Background ${i + 1}`);
            }
          }
        }
        if (Array.isArray(plan.scene_bg_indices)) {
          plan.scene_bg_indices = plan.scene_bg_indices.map((idx: number) =>
            Math.min(idx, newBgCount - 1)
          );
        }
      }

      const { error: updateError } = await supabase
        .from('storyboards')
        .update({ plan })
        .eq('id', storyboardId);

      if (updateError) {
        console.error(
          'Failed to update plan with new dimensions:',
          updateError
        );
        return NextResponse.json(
          { error: 'Failed to update plan' },
          { status: 500 }
        );
      }
    }

    // Clamp scene_object_indices to max 3 per scene for SkyReels
    if (
      storyboard.model === 'skyreels' &&
      Array.isArray(plan.scene_object_indices)
    ) {
      plan.scene_object_indices = plan.scene_object_indices.map(
        (indices: number[]) => indices.slice(0, 3)
      );
    }

    const objectNames: string[] = Array.isArray(plan.objects)
      ? plan.objects.map((o: { name: string }) => o.name)
      : plan.object_names;
    const objectDescriptions: string[] | undefined = Array.isArray(plan.objects)
      ? plan.objects.map((o: { description: string }) => o.description)
      : undefined;

    // ── Inline approve-ref-split logic ─────────────────────────────

    const log = createLogger();
    log.setContext({ step: 'ApproveRefSplit' });

    const adminSupabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: 'studio' } }
    );

    const scene_prompts = plan.scene_prompts as (string | string[])[];
    const scene_bg_indices = plan.scene_bg_indices as number[];
    const scene_object_indices = plan.scene_object_indices as number[][];
    const scene_multi_shots = plan.scene_multi_shots as boolean[] | undefined;
    const voiceover_list = plan.voiceover_list as Record<string, string[]>;
    const sceneCount = scene_prompts.length;
    const languages = Object.keys(voiceover_list);

    const { data: claimedStoryboard, error: claimError } = await adminSupabase
      .from('storyboards')
      .update({ plan_status: 'splitting' })
      .eq('id', storyboardId)
      .eq('plan_status', 'grid_ready')
      .select('id')
      .maybeSingle();

    if (claimError) {
      console.error('Failed to claim storyboard for ref split:', claimError);
      return NextResponse.json(
        { error: 'Failed to lock storyboard for split' },
        { status: 500 }
      );
    }

    if (!claimedStoryboard) {
      const { data: currentStoryboard } = await adminSupabase
        .from('storyboards')
        .select('plan_status')
        .eq('id', storyboardId)
        .maybeSingle();

      if (
        currentStoryboard?.plan_status === 'splitting' ||
        currentStoryboard?.plan_status === 'approved'
      ) {
        return NextResponse.json({
          success: true,
          storyboard_id: storyboardId,
          already_processing: true,
        });
      }

      return NextResponse.json(
        { error: 'Storyboard is not in grid_ready status' },
        { status: 409 }
      );
    }

    const { data: existingScenes, error: existingScenesError } =
      await adminSupabase
        .from('scenes')
        .select('id')
        .eq('storyboard_id', storyboardId)
        .limit(1);

    if (existingScenesError) {
      console.error(
        'Failed to check existing ref scenes:',
        existingScenesError
      );
      await adminSupabase
        .from('storyboards')
        .update({ plan_status: 'failed' })
        .eq('id', storyboardId)
        .eq('plan_status', 'splitting');

      return NextResponse.json(
        { error: 'Failed to validate existing scenes before split' },
        { status: 500 }
      );
    }

    if ((existingScenes?.length ?? 0) > 0) {
      await adminSupabase
        .from('storyboards')
        .update({ plan_status: 'failed' })
        .eq('id', storyboardId)
        .eq('plan_status', 'splitting');

      return NextResponse.json(
        {
          error:
            'Scenes already exist for this storyboard. Split appears to have already started.',
        },
        { status: 409 }
      );
    }

    // Step 0: Set plan_status to 'splitting'
    await logWorkflowEvent(adminSupabase, {
      storyboardId,
      step: 'ApproveRefSplit',
      status: 'start',
    });

    // Step 1: Create scenes with prompts and voiceovers
    log.info('Creating scenes', { count: sceneCount });
    log.startTiming('create_scenes');

    const sceneIds: string[] = [];
    for (let i = 0; i < sceneCount; i++) {
      const { data: scene, error: sceneError } = await adminSupabase
        .from('scenes')
        .insert({
          storyboard_id: storyboardId,
          order: i,
          prompt: Array.isArray(scene_prompts[i]) ? null : scene_prompts[i],
          multi_prompt: Array.isArray(scene_prompts[i])
            ? scene_prompts[i]
            : null,
          multi_shots: scene_multi_shots?.[i] ?? null,
        })
        .select()
        .single();

      if (sceneError || !scene) {
        log.warn('Failed to insert scene', {
          index: i,
          error: sceneError?.message,
        });
        continue;
      }

      sceneIds.push(scene.id);

      for (const lang of languages) {
        await adminSupabase.from('voiceovers').insert({
          scene_id: scene.id,
          text: voiceover_list[lang][i],
          language: lang,
          status: 'success',
        });
      }
    }

    log.success('Scenes created', {
      count: sceneIds.length,
      time_ms: log.endTiming('create_scenes'),
    });

    // Step 2: Pre-create objects rows
    log.startTiming('create_objects');
    let objectsCreated = 0;
    for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
      const objectIndices = scene_object_indices[sceneIdx] || [];
      for (let pos = 0; pos < objectIndices.length; pos++) {
        const gridPos = objectIndices[pos];
        await adminSupabase.from('objects').insert({
          grid_image_id: objectsGrid.id,
          scene_id: sceneIds[sceneIdx],
          scene_order: pos,
          grid_position: gridPos,
          name: objectNames[gridPos],
          description: objectDescriptions?.[gridPos] ?? null,
          status: 'processing',
        });
        objectsCreated++;
      }
    }
    log.success('Objects created', {
      count: objectsCreated,
      time_ms: log.endTiming('create_objects'),
    });

    // Step 3: Pre-create backgrounds rows
    log.startTiming('create_backgrounds');
    let backgroundsCreated = 0;
    for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
      const bgIndex = scene_bg_indices[sceneIdx];
      await adminSupabase.from('backgrounds').insert({
        grid_image_id: bgGrid.id,
        scene_id: sceneIds[sceneIdx],
        grid_position: bgIndex,
        name: plan.background_names[bgIndex],
        status: 'processing',
      });
      backgroundsCreated++;
    }
    log.success('Backgrounds created', {
      count: backgroundsCreated,
      time_ms: log.endTiming('create_backgrounds'),
    });

    // Step 3.5: Inject series asset images for matched objects/backgrounds
    // This pre-populates url/final_url/status for items that match series characters,
    // locations, or props — so they appear immediately without waiting for grid split.
    const projectId: string = storyboard.project_id;
    let seriesObjectsInjected = 0;
    let seriesBackgroundsInjected = 0;

    try {
      const seriesAssetMap = await resolveSeriesAssetsForProject(
        adminSupabase,
        projectId
      );

      if (seriesAssetMap) {
        // Pre-populate objects that match series characters or props
        for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
          const objectIndices = scene_object_indices[sceneIdx] || [];
          for (const gridPos of objectIndices) {
            const objName = objectNames[gridPos];
            const match =
              matchSeriesAsset(seriesAssetMap, objName, 'character') ??
              matchSeriesAsset(seriesAssetMap, objName, 'prop');

            if (match) {
              await adminSupabase
                .from('objects')
                .update({
                  url: match.url,
                  final_url: match.url,
                  status: 'success',
                })
                .eq('grid_image_id', objectsGrid.id)
                .eq('grid_position', gridPos)
                .eq('scene_id', sceneIds[sceneIdx]);
              seriesObjectsInjected++;
            }
          }
        }

        // Pre-populate backgrounds that match series locations
        for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
          const bgIndex = scene_bg_indices[sceneIdx];
          const bgName = plan.background_names[bgIndex];
          const match = matchSeriesAsset(seriesAssetMap, bgName, 'location');

          if (match) {
            await adminSupabase
              .from('backgrounds')
              .update({
                url: match.url,
                final_url: match.url,
                status: 'success',
              })
              .eq('grid_image_id', bgGrid.id)
              .eq('grid_position', bgIndex)
              .eq('scene_id', sceneIds[sceneIdx]);
            seriesBackgroundsInjected++;
          }
        }

        log.info('Series asset injection complete', {
          objects_injected: seriesObjectsInjected,
          objects_total: objectsCreated,
          backgrounds_injected: seriesBackgroundsInjected,
          backgrounds_total: backgroundsCreated,
        });
      }
    } catch (seriesErr) {
      // Non-fatal: log and continue — grid split will cover everything
      console.warn(
        '[approve-ref-grid] Series asset injection failed:',
        seriesErr
      );
    }

    // Step 4: Split both grids using Sharp-based auto-splitter
    log.startTiming('split_requests');

    const [objectsSplit, bgSplit] = await Promise.all([
      splitGrid(
        {
          imageUrl: objectsGrid.url,
          rows: plan.objects_rows,
          cols: plan.objects_cols,
          storyboardId,
          gridImageId: objectsGrid.id,
          type: 'objects',
        },
        log
      ),
      splitGrid(
        {
          imageUrl: bgGrid.url,
          rows: plan.bg_rows,
          cols: plan.bg_cols,
          storyboardId,
          gridImageId: bgGrid.id,
          type: 'backgrounds',
        },
        log
      ),
    ]);

    log.info('Split results', {
      objects_success: objectsSplit.success,
      objects_tiles: objectsSplit.tiles.length,
      objects_error: objectsSplit.error,
      bg_success: bgSplit.success,
      bg_tiles: bgSplit.tiles.length,
      bg_error: bgSplit.error,
      time_ms: log.endTiming('split_requests'),
    });

    // If both failed, mark as failed
    if (!objectsSplit.success && !bgSplit.success) {
      await adminSupabase
        .from('objects')
        .update({ status: 'failed' })
        .eq('grid_image_id', objectsGrid.id);
      await adminSupabase
        .from('backgrounds')
        .update({ status: 'failed' })
        .eq('grid_image_id', bgGrid.id);
      await adminSupabase
        .from('storyboards')
        .update({ plan_status: 'failed' })
        .eq('id', storyboardId)
        .eq('plan_status', 'splitting');

      log.summary('error', { reason: 'both_splits_failed' });
      await logWorkflowEvent(adminSupabase, {
        storyboardId,
        step: 'ApproveRefSplit',
        status: 'error',
        data: { reason: 'both_splits_failed' },
      });
      return NextResponse.json(
        {
          error: 'Both grid splits failed',
          objects_error: objectsSplit.error,
          bg_error: bgSplit.error,
        },
        { status: 500 }
      );
    }

    // Step 5: Update objects and backgrounds with tile URLs
    if (objectsSplit.success && objectsSplit.tiles.length > 0) {
      await updateObjects(
        adminSupabase,
        objectsGrid.id,
        objectsSplit.tiles,
        log
      );
    } else {
      await adminSupabase
        .from('objects')
        .update({ status: 'failed' })
        .eq('grid_image_id', objectsGrid.id);
    }

    if (bgSplit.success && bgSplit.tiles.length > 0) {
      await updateBackgrounds(adminSupabase, bgGrid.id, bgSplit.tiles, log);
    } else {
      await adminSupabase
        .from('backgrounds')
        .update({ status: 'failed' })
        .eq('grid_image_id', bgGrid.id);
    }

    // Mark storyboard as approved even if one split failed — partial success is
    // acceptable. The failed split will show as failed in the UI and the user can
    // retry it individually.
    await adminSupabase
      .from('storyboards')
      .update({ plan_status: 'approved' })
      .eq('id', storyboardId)
      .eq('plan_status', 'splitting');

    await logWorkflowEvent(adminSupabase, {
      storyboardId,
      step: 'ApproveRefSplit',
      status: 'success',
    });

    return NextResponse.json({
      success: true,
      storyboard_id: storyboardId,
      objects_grid_id: objectsGrid.id,
      bg_grid_id: bgGrid.id,
    });
  } catch (error) {
    console.error('Approve ref grid error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
