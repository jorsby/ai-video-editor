import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const ASPECT_RATIOS: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

const FAL_API_KEY = process.env.FAL_KEY!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

async function sendSplitRequest(
  gridImageUrl: string,
  gridImageId: string,
  storyboardId: string,
  rows: number,
  cols: number,
  width: number,
  height: number,
  log: ReturnType<typeof createLogger>
): Promise<{ requestId: string | null; error: string | null }> {
  const splitWebhookParams = new URLSearchParams({
    step: 'SplitGridImage',
    grid_image_id: gridImageId,
    storyboard_id: storyboardId,
  });
  const splitWebhookUrl = `${APP_URL}/api/webhook/fal?${splitWebhookParams.toString()}`;

  const falUrl = new URL('https://queue.fal.run/comfy/octupost/splitgridimage');
  falUrl.searchParams.set('fal_webhook', splitWebhookUrl);

  log.api('ComfyUI', 'splitgridimage', {
    grid_image_id: gridImageId,
    rows,
    cols,
    width,
    height,
  });

  const splitResponse = await fetch(falUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      loadimage_1: gridImageUrl,
      rows,
      cols,
      width,
      height,
    }),
  });

  if (!splitResponse.ok) {
    const errorText = await splitResponse.text();
    log.error('Split request failed', {
      grid_image_id: gridImageId,
      status: splitResponse.status,
      error: errorText,
    });
    return {
      requestId: null,
      error: `Split request failed: ${splitResponse.status}`,
    };
  }

  const splitResult = await splitResponse.json();
  log.success('Split request sent', {
    grid_image_id: gridImageId,
    request_id: splitResult.request_id,
  });
  return { requestId: splitResult.request_id, error: null };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
        (val as number) < 2 ||
        (val as number) > 6
      ) {
        return NextResponse.json(
          { error: `${name} must be an integer between 2 and 6` },
          { status: 400 }
        );
      }
    }

    // Validate grid constraint: rows must equal cols or cols + 1
    const gridPairs = [
      { name: 'objects', rows: objectsRows, cols: objectsCols },
      { name: 'backgrounds', rows: bgRows, cols: bgCols },
    ];
    for (const { name, rows, cols } of gridPairs) {
      if (rows !== cols && rows !== cols + 1) {
        return NextResponse.json(
          {
            error: `Invalid ${name} grid: ${rows}x${cols}. rows must equal cols or cols + 1.`,
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
    const dimensions =
      ASPECT_RATIOS[storyboard.aspect_ratio] || ASPECT_RATIOS['9:16'];

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

    // Step 0: Set plan_status to 'splitting'
    await adminSupabase
      .from('storyboards')
      .update({ plan_status: 'splitting' })
      .eq('id', storyboardId);

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

    // Step 4: Send split requests for both grids
    log.startTiming('split_requests');

    const [objectsSplit, bgSplit] = await Promise.all([
      sendSplitRequest(
        objectsGrid.url,
        objectsGrid.id,
        storyboardId,
        plan.objects_rows,
        plan.objects_cols,
        dimensions.width,
        dimensions.height,
        log
      ),
      sendSplitRequest(
        bgGrid.url,
        bgGrid.id,
        storyboardId,
        plan.bg_rows,
        plan.bg_cols,
        dimensions.width,
        dimensions.height,
        log
      ),
    ]);

    log.info('Split requests sent', {
      objects_request_id: objectsSplit.requestId,
      bg_request_id: bgSplit.requestId,
      objects_error: objectsSplit.error,
      bg_error: bgSplit.error,
      time_ms: log.endTiming('split_requests'),
    });

    // Save split_request_ids
    if (objectsSplit.requestId) {
      await adminSupabase
        .from('grid_images')
        .update({ split_request_id: objectsSplit.requestId })
        .eq('id', objectsGrid.id);
    }
    if (bgSplit.requestId) {
      await adminSupabase
        .from('grid_images')
        .update({ split_request_id: bgSplit.requestId })
        .eq('id', bgGrid.id);
    }

    // If both failed, mark objects/backgrounds as failed
    if (objectsSplit.error && bgSplit.error) {
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
        .eq('id', storyboardId);

      log.summary('error', { reason: 'both_split_requests_failed' });
      return NextResponse.json(
        { error: 'Failed to send both split requests' },
        { status: 500 }
      );
    }

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
