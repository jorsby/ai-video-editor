import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const ASPECT_RATIOS: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { storyboardId } = await req.json();

    if (!storyboardId) {
      return NextResponse.json(
        { error: 'Storyboard ID is required' },
        { status: 400 }
      );
    }

    // Fetch the draft storyboard
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

    if (storyboard.plan_status !== 'draft') {
      return NextResponse.json(
        { error: 'Storyboard is not in draft status' },
        { status: 400 }
      );
    }

    if (!storyboard.plan) {
      return NextResponse.json(
        { error: 'Storyboard has no plan' },
        { status: 400 }
      );
    }

    // Update status to 'generating'
    const { error: updateError } = await supabase
      .from('storyboards')
      .update({ plan_status: 'generating' })
      .eq('id', storyboardId);

    if (updateError) {
      console.error('Failed to update storyboard status:', updateError);
      return NextResponse.json(
        { error: 'Failed to update storyboard status' },
        { status: 500 }
      );
    }

    // Get dimensions from aspect ratio
    const dimensions =
      ASPECT_RATIOS[storyboard.aspect_ratio] || ASPECT_RATIOS['9:16'];

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    // User is already verified by getUser() above. We use the anon key as the
    // bearer token because Supabase Auth issues ES256 JWTs which the edge
    // function gateway cannot verify (it expects HS256). The edge function
    // itself uses the service role key for all DB operations.
    const isRefMode = storyboard.mode === 'ref_to_video';
    const edgeFunctionName = isRefMode
      ? 'start-ref-workflow'
      : 'start-workflow';

    // Build body based on mode
    const workflowBody = isRefMode
      ? {
          storyboard_id: storyboardId,
          project_id: storyboard.project_id,
          objects_rows: storyboard.plan.objects_rows,
          objects_cols: storyboard.plan.objects_cols,
          objects_grid_prompt: storyboard.plan.objects_grid_prompt,
          object_names:
            storyboard.plan.objects?.map((o: { name: string }) => o.name) ??
            storyboard.plan.object_names,
          bg_rows: storyboard.plan.bg_rows,
          bg_cols: storyboard.plan.bg_cols,
          backgrounds_grid_prompt: storyboard.plan.backgrounds_grid_prompt,
          background_names: storyboard.plan.background_names,
          scene_prompts: storyboard.plan.scene_prompts,
          scene_bg_indices: storyboard.plan.scene_bg_indices,
          scene_object_indices: storyboard.plan.scene_object_indices,
          voiceover_list: storyboard.plan.voiceover_list,
          width: dimensions.width,
          height: dimensions.height,
          voiceover: storyboard.voiceover,
          aspect_ratio: storyboard.aspect_ratio,
        }
      : {
          storyboard_id: storyboardId,
          project_id: storyboard.project_id,
          rows: storyboard.plan.rows,
          cols: storyboard.plan.cols,
          grid_image_prompt: storyboard.plan.grid_image_prompt,
          voiceover_list: storyboard.plan.voiceover_list,
          visual_prompt_list: storyboard.plan.visual_flow,
          width: dimensions.width,
          height: dimensions.height,
          voiceover: storyboard.voiceover,
          aspect_ratio: storyboard.aspect_ratio,
        };

    const fnResponse = await fetch(
      `${supabaseUrl}/functions/v1/${edgeFunctionName}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify(workflowBody),
      }
    );

    if (!fnResponse.ok) {
      const errorBody = await fnResponse.text();
      console.error('Edge function error:', fnResponse.status, errorBody);
      // Revert status on failure
      await supabase
        .from('storyboards')
        .update({ plan_status: 'draft' })
        .eq('id', storyboardId);
      return NextResponse.json(
        { error: 'Failed to start workflow' },
        { status: 500 }
      );
    }

    const fnData = await fnResponse.json();

    if (fnData && fnData.success === false) {
      console.error('Workflow returned failure:', fnData);
      // Revert status on failure
      await supabase
        .from('storyboards')
        .update({ plan_status: 'draft' })
        .eq('id', storyboardId);
      return NextResponse.json(
        { error: fnData.error || 'Workflow failed' },
        { status: 500 }
      );
    }

    // Status stays as 'generating' — the webhook will set it to 'grid_ready'
    // when the grid image(s) are generated, allowing user to review before splitting

    return NextResponse.json({
      success: true,
      storyboard_id: storyboardId,
      ...(isRefMode
        ? {
            objects_grid_id: fnData?.objects_grid_id,
            bg_grid_id: fnData?.bg_grid_id,
          }
        : { grid_image_id: fnData?.grid_image_id }),
    });
  } catch (error) {
    console.error('Approve storyboard error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
