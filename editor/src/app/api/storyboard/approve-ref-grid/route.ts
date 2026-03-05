import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ASPECT_RATIOS: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

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
      // Update dimension fields
      plan.objects_rows = objectsRows;
      plan.objects_cols = objectsCols;
      plan.bg_rows = bgRows;
      plan.bg_cols = bgCols;

      // Adjust objects (both Kling and new WAN use plan.objects; legacy WAN uses plan.object_names)
      if (newObjectCount !== oldObjectCount) {
        if (Array.isArray(plan.objects)) {
          if (newObjectCount < oldObjectCount) {
            plan.objects = plan.objects.slice(0, newObjectCount);
          } else {
            for (let i = oldObjectCount; i < newObjectCount; i++) {
              plan.objects.push({
                name: `Object ${i + 1}`,
                description: '',
              });
            }
          }
        }
        // Legacy WAN plans with object_names
        if (Array.isArray(plan.object_names)) {
          if (newObjectCount < oldObjectCount) {
            plan.object_names = plan.object_names.slice(0, newObjectCount);
          } else {
            for (let i = oldObjectCount; i < newObjectCount; i++) {
              plan.object_names.push(`Object ${i + 1}`);
            }
          }
        }

        // Filter scene_object_indices: remove any index >= new object count
        if (Array.isArray(plan.scene_object_indices)) {
          plan.scene_object_indices = plan.scene_object_indices.map(
            (indices: number[]) =>
              indices.filter((idx: number) => idx < newObjectCount)
          );
        }
      }

      // Adjust backgrounds
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

        // Clamp scene_bg_indices to valid range
        if (Array.isArray(plan.scene_bg_indices)) {
          plan.scene_bg_indices = plan.scene_bg_indices.map((idx: number) =>
            Math.min(idx, newBgCount - 1)
          );
        }
      }

      // Persist updated plan to DB
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

    // Build object_names and object_descriptions from the (possibly adjusted) plan
    // Both Kling and new WAN plans use plan.objects; legacy WAN uses plan.object_names
    const objectNames: string[] = Array.isArray(plan.objects)
      ? plan.objects.map((o: { name: string }) => o.name)
      : plan.object_names;
    const objectDescriptions: string[] | undefined = Array.isArray(plan.objects)
      ? plan.objects.map((o: { description: string }) => o.description)
      : undefined;

    // Call approve-ref-split edge function
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const fnResponse = await fetch(
      `${supabaseUrl}/functions/v1/approve-ref-split`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          storyboard_id: storyboardId,
          objects_grid_image_id: objectsGrid.id,
          objects_grid_image_url: objectsGrid.url,
          objects_rows: plan.objects_rows,
          objects_cols: plan.objects_cols,
          bg_grid_image_id: bgGrid.id,
          bg_grid_image_url: bgGrid.url,
          bg_rows: plan.bg_rows,
          bg_cols: plan.bg_cols,
          object_names: objectNames,
          object_descriptions: objectDescriptions,
          background_names: plan.background_names,
          scene_prompts: plan.scene_prompts,
          scene_bg_indices: plan.scene_bg_indices,
          scene_object_indices: plan.scene_object_indices,
          scene_multi_shots: plan.scene_multi_shots ?? undefined,
          voiceover_list: plan.voiceover_list,
          width: dimensions.width,
          height: dimensions.height,
        }),
      }
    );

    if (!fnResponse.ok) {
      const errorBody = await fnResponse.text();
      console.error('Edge function error:', fnResponse.status, errorBody);
      return NextResponse.json(
        { error: 'Failed to start ref split workflow' },
        { status: 500 }
      );
    }

    const fnData = await fnResponse.json();

    if (fnData && fnData.success === false) {
      console.error('Ref split workflow returned failure:', fnData);
      return NextResponse.json(
        { error: fnData.error || 'Ref split workflow failed' },
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
