/**
 * POST /api/v2/storyboard/{id}/approve
 *
 * Triggers image generation for an approved storyboard.
 * For storyboards in 'draft' status, this starts the grid generation phase
 * (objects + backgrounds grids via fal.ai).
 * For storyboards already in 'grid_ready' status, this runs the split phase
 * (same logic as approve-ref-grid).
 *
 * Response:
 *   draft → { status: "generating", grid_jobs: { objects: fal_request_id, backgrounds: fal_request_id } }
 *   grid_ready → { status: "approved" } (split runs synchronously via sharp)
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
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
import {
  DEFAULT_GRID_ASPECT_RATIO,
  DEFAULT_GRID_RESOLUTION,
  applyGridGenerationSettingsToPrompt,
  isGridAspectRatio,
  isGridResolution,
} from '@/lib/grid-generation-settings';

type RouteContext = { params: Promise<{ id: string }> };

const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL!;

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'studio' } }
  );
}

async function queueGridGeneration(
  // biome-ignore lint/suspicious/noExplicitAny: service client is untyped in repo
  supabase: any,
  params: {
    storyboardId: string;
    prompt: string;
    rows: number;
    cols: number;
    type: 'objects' | 'backgrounds';
    gridAspectRatio: string;
    gridResolution: string;
  }
): Promise<{
  gridImageId: string;
  requestId: string | null;
  error: string | null;
}> {
  const {
    storyboardId,
    prompt,
    rows,
    cols,
    type,
    gridAspectRatio,
    gridResolution,
  } = params;

  const { data: gridImage, error: gridInsertError } = await supabase
    .from('grid_images')
    .insert({
      storyboard_id: storyboardId,
      prompt,
      status: 'pending',
      type,
      detected_rows: rows,
      detected_cols: cols,
      dimension_detection_status: 'success',
    })
    .select('id')
    .single();

  if (gridInsertError || !gridImage) {
    return {
      gridImageId: '',
      requestId: null,
      error: `Failed to create ${type} grid record: ${gridInsertError?.message}`,
    };
  }

  const gridImageId = gridImage.id as string;

  const falPrompt = applyGridGenerationSettingsToPrompt(
    prompt,
    isGridAspectRatio(gridAspectRatio)
      ? gridAspectRatio
      : DEFAULT_GRID_ASPECT_RATIO,
    isGridResolution(gridResolution) ? gridResolution : DEFAULT_GRID_RESOLUTION
  );

  const webhookParams = new URLSearchParams({
    step: 'GenGridImage',
    grid_image_id: gridImageId,
    storyboard_id: storyboardId,
    rows: String(rows),
    cols: String(cols),
    width: '1024',
    height: '1024',
  });
  const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/fal?${webhookParams.toString()}`;
  const falUrl = new URL(
    'https://queue.fal.run/workflows/octupost/generategridimage'
  );
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  const falResponse = await fetch(falUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: falPrompt, web_search: true }),
  });

  if (!falResponse.ok) {
    const errText = await falResponse.text();
    await supabase
      .from('grid_images')
      .update({ status: 'failed', error_message: 'request_error' })
      .eq('id', gridImageId);
    return {
      gridImageId,
      requestId: null,
      error: `fal.ai ${type} request failed: ${falResponse.status} ${errText.slice(0, 100)}`,
    };
  }

  const falResult = await falResponse.json();
  const requestId = falResult.request_id as string;

  await supabase
    .from('grid_images')
    .update({ status: 'processing', request_id: requestId })
    .eq('id', gridImageId);

  return { gridImageId, requestId, error: null };
}

export async function POST(req: NextRequest, context: RouteContext) {
  const log = createLogger();
  log.setContext({ step: 'V2ApproveStoryboard' });

  try {
    const { id: storyboardId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');

    // Fetch storyboard (verify ownership via project)
    const { data: storyboard, error: fetchError } = await db
      .from('storyboards')
      .select('id, plan, plan_status, mode, model, project_id')
      .eq('id', storyboardId)
      .single();

    if (fetchError || !storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    // Verify user owns the project
    const { data: project, error: projectError } = await db
      .from('projects')
      .select('id')
      .eq('id', storyboard.project_id)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!storyboard.plan) {
      return NextResponse.json(
        { error: 'Storyboard has no plan' },
        { status: 400 }
      );
    }

    const plan = storyboard.plan as Record<string, unknown>;

    // ── Case 1: storyboard is draft → start grid generation ─────────────────
    if (
      storyboard.plan_status === 'draft' ||
      storyboard.plan_status === 'failed'
    ) {
      // Claim
      const { data: claimed, error: claimError } = await db
        .from('storyboards')
        .update({ plan_status: 'generating' })
        .eq('id', storyboardId)
        .in('plan_status', ['draft', 'failed'])
        .select('id')
        .maybeSingle();

      if (claimError || !claimed) {
        return NextResponse.json(
          {
            error:
              'Storyboard cannot be approved at this time (already generating or in unexpected state)',
          },
          { status: 409 }
        );
      }

      const gridAspectRatio =
        (plan.grid_generation_aspect_ratio as string | undefined) ??
        DEFAULT_GRID_ASPECT_RATIO;
      const gridResolution =
        (plan.grid_generation_resolution as string | undefined) ??
        DEFAULT_GRID_RESOLUTION;

      const [objectsResult, bgResult] = await Promise.all([
        queueGridGeneration(db, {
          storyboardId,
          prompt: plan.objects_grid_prompt as string,
          rows: plan.objects_rows as number,
          cols: plan.objects_cols as number,
          type: 'objects',
          gridAspectRatio,
          gridResolution,
        }),
        queueGridGeneration(db, {
          storyboardId,
          prompt: plan.backgrounds_grid_prompt as string,
          rows: plan.bg_rows as number,
          cols: plan.bg_cols as number,
          type: 'backgrounds',
          gridAspectRatio,
          gridResolution,
        }),
      ]);

      if (objectsResult.error && bgResult.error) {
        await db
          .from('storyboards')
          .update({ plan_status: 'failed' })
          .eq('id', storyboardId);
        return NextResponse.json(
          { error: 'Failed to queue grid generation jobs' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        status: 'generating',
        grid_jobs: {
          objects: objectsResult.requestId,
          backgrounds: bgResult.requestId,
        },
        grid_image_ids: {
          objects: objectsResult.gridImageId,
          backgrounds: bgResult.gridImageId,
        },
      });
    }

    // ── Case 2: grids are ready → run split (approve-ref-grid logic) ────────
    if (storyboard.plan_status !== 'grid_ready') {
      return NextResponse.json(
        {
          error: `Cannot approve storyboard in status "${storyboard.plan_status}". Expected "draft", "failed", or "grid_ready".`,
        },
        { status: 400 }
      );
    }

    if (storyboard.mode !== 'ref_to_video') {
      return NextResponse.json(
        { error: 'This endpoint only supports ref_to_video storyboards' },
        { status: 400 }
      );
    }

    // Fetch both grid images
    const { data: gridImages, error: gridError } = await db
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
        { error: 'Grid images are not ready (missing URL)' },
        { status: 400 }
      );
    }

    const adminSupabase = getAdminClient();

    // Atomic claim
    const { data: claimedSplit, error: splitClaimError } = await adminSupabase
      .from('storyboards')
      .update({ plan_status: 'splitting' })
      .eq('id', storyboardId)
      .eq('plan_status', 'grid_ready')
      .select('id')
      .maybeSingle();

    if (splitClaimError) {
      return NextResponse.json(
        { error: 'Failed to lock storyboard for split' },
        { status: 500 }
      );
    }

    if (!claimedSplit) {
      // Already splitting or approved
      const { data: current } = await adminSupabase
        .from('storyboards')
        .select('plan_status')
        .eq('id', storyboardId)
        .maybeSingle();
      if (
        current?.plan_status === 'splitting' ||
        current?.plan_status === 'approved'
      ) {
        return NextResponse.json({
          status:
            current.plan_status === 'approved' ? 'approved' : 'generating',
          already_processing: true,
        });
      }
      return NextResponse.json(
        { error: 'Storyboard is not in grid_ready status' },
        { status: 409 }
      );
    }

    // Check for existing scenes (idempotency guard)
    const { data: existingScenes } = await adminSupabase
      .from('scenes')
      .select('id')
      .eq('storyboard_id', storyboardId)
      .limit(1);

    if ((existingScenes?.length ?? 0) > 0) {
      await adminSupabase
        .from('storyboards')
        .update({ plan_status: 'failed' })
        .eq('id', storyboardId)
        .eq('plan_status', 'splitting');
      return NextResponse.json(
        { error: 'Scenes already exist for this storyboard' },
        { status: 409 }
      );
    }

    await logWorkflowEvent(adminSupabase, {
      storyboardId,
      step: 'V2ApproveStoryboard',
      status: 'start',
    });

    const objectNames: string[] = Array.isArray(plan.objects)
      ? (plan.objects as Array<{ name: string }>).map((o) => o.name)
      : ((plan.object_names as string[]) ?? []);
    const objectDescriptions: string[] | undefined = Array.isArray(plan.objects)
      ? (plan.objects as Array<{ description: string }>).map(
          (o) => o.description
        )
      : undefined;

    const scene_prompts = plan.scene_prompts as (string | string[])[];
    const scene_bg_indices = plan.scene_bg_indices as number[];
    const scene_object_indices = plan.scene_object_indices as number[][];
    const voiceover_list = plan.voiceover_list as
      | Record<string, string[]>
      | string[];

    // Normalize voiceover_list to Record<string, string[]>
    const normalizedVoiceoverList: Record<string, string[]> = Array.isArray(
      voiceover_list
    )
      ? { en: voiceover_list }
      : voiceover_list;

    const languages = Object.keys(normalizedVoiceoverList);
    const sceneCount = scene_prompts.length;

    // Create scenes
    const sceneIds: string[] = [];
    for (let i = 0; i < sceneCount; i++) {
      const { data: scene } = await adminSupabase
        .from('scenes')
        .insert({
          storyboard_id: storyboardId,
          order: i,
          prompt: Array.isArray(scene_prompts[i])
            ? null
            : (scene_prompts[i] as string),
          multi_prompt: Array.isArray(scene_prompts[i])
            ? (scene_prompts[i] as string[])
            : null,
        })
        .select('id')
        .single();

      if (!scene) continue;
      sceneIds.push(scene.id as string);

      for (const lang of languages) {
        const texts = normalizedVoiceoverList[lang];
        await adminSupabase.from('voiceovers').insert({
          scene_id: scene.id,
          text: texts[i] ?? '',
          language: lang,
          status: 'success',
        });
      }
    }

    // Create objects
    for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
      const objectIndices = scene_object_indices[sceneIdx] ?? [];
      for (let pos = 0; pos < objectIndices.length; pos++) {
        const gridPos = objectIndices[pos];
        await adminSupabase.from('objects').insert({
          grid_image_id: objectsGrid.id,
          scene_id: sceneIds[sceneIdx],
          scene_order: pos,
          grid_position: gridPos,
          name: objectNames[gridPos] ?? `Object ${gridPos + 1}`,
          description: objectDescriptions?.[gridPos] ?? null,
          status: 'processing',
        });
      }
    }

    // Create backgrounds
    for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
      const bgIndex = scene_bg_indices[sceneIdx];
      const backgroundNames = plan.background_names as string[];
      await adminSupabase.from('backgrounds').insert({
        grid_image_id: bgGrid.id,
        scene_id: sceneIds[sceneIdx],
        grid_position: bgIndex,
        name: backgroundNames[bgIndex] ?? `Background ${bgIndex + 1}`,
        status: 'processing',
      });
    }

    // Inject series assets (pre-populate matched objects/backgrounds)
    const projectId = storyboard.project_id as string;
    try {
      const seriesAssetMap = await resolveSeriesAssetsForProject(
        adminSupabase,
        projectId
      );

      if (seriesAssetMap) {
        for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
          const objectIndices = scene_object_indices[sceneIdx] ?? [];
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
            }
          }

          const bgIndex = scene_bg_indices[sceneIdx];
          const bgName = (plan.background_names as string[])[bgIndex];
          const bgMatch = matchSeriesAsset(seriesAssetMap, bgName, 'location');
          if (bgMatch) {
            await adminSupabase
              .from('backgrounds')
              .update({
                url: bgMatch.url,
                final_url: bgMatch.url,
                status: 'success',
              })
              .eq('grid_image_id', bgGrid.id)
              .eq('grid_position', bgIndex)
              .eq('scene_id', sceneIds[sceneIdx]);
          }
        }
      }
    } catch (seriesErr) {
      console.warn(
        '[v2/storyboard/approve] Series asset injection failed (non-fatal):',
        seriesErr
      );
    }

    // Split both grids
    const [objectsSplit, bgSplit] = await Promise.all([
      splitGrid(
        {
          imageUrl: objectsGrid.url,
          rows: plan.objects_rows as number,
          cols: plan.objects_cols as number,
          storyboardId,
          gridImageId: objectsGrid.id,
          type: 'objects',
        },
        log
      ),
      splitGrid(
        {
          imageUrl: bgGrid.url,
          rows: plan.bg_rows as number,
          cols: plan.bg_cols as number,
          storyboardId,
          gridImageId: bgGrid.id,
          type: 'backgrounds',
        },
        log
      ),
    ]);

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

      return NextResponse.json(
        { error: 'Both grid splits failed', status: 'failed' },
        { status: 500 }
      );
    }

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

    await adminSupabase
      .from('storyboards')
      .update({ plan_status: 'approved' })
      .eq('id', storyboardId)
      .eq('plan_status', 'splitting');

    await logWorkflowEvent(adminSupabase, {
      storyboardId,
      step: 'V2ApproveStoryboard',
      status: 'success',
    });

    return NextResponse.json({
      status: 'approved',
      storyboard_id: storyboardId,
      objects_grid_id: objectsGrid.id,
      bg_grid_id: bgGrid.id,
    });
  } catch (error) {
    console.error('[v2/storyboard/approve] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
