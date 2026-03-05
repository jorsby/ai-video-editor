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

    const { storyboardId } = await req.json();

    if (!storyboardId) {
      return NextResponse.json(
        { error: 'storyboardId is required' },
        { status: 400 }
      );
    }

    // Fetch storyboard, validate plan_status === 'grid_ready'
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

    if (!storyboard.plan) {
      return NextResponse.json(
        { error: 'Storyboard has no plan' },
        { status: 400 }
      );
    }

    // Delete old grid_images records (no scenes attached yet)
    const { error: deleteError } = await supabase
      .from('grid_images')
      .delete()
      .eq('storyboard_id', storyboardId);

    if (deleteError) {
      console.error('Failed to delete old grid images:', deleteError);
      return NextResponse.json(
        { error: 'Failed to clean up old grid images' },
        { status: 500 }
      );
    }

    // Set plan_status back to 'generating'
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

    // Re-invoke start-workflow with same plan data
    // User is already verified by getUser() above. We use the anon key as the
    // bearer token because Supabase Auth issues ES256 JWTs which the edge
    // function gateway cannot verify (it expects HS256).
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const fnResponse = await fetch(
      `${supabaseUrl}/functions/v1/start-workflow`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
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
        }),
      }
    );

    if (!fnResponse.ok) {
      const errorBody = await fnResponse.text();
      console.error('Edge function error:', fnResponse.status, errorBody);
      // Revert status on failure
      await supabase
        .from('storyboards')
        .update({ plan_status: 'grid_ready' })
        .eq('id', storyboardId);
      return NextResponse.json(
        { error: 'Failed to start regeneration' },
        { status: 500 }
      );
    }

    const fnData = await fnResponse.json();

    if (fnData && fnData.success === false) {
      console.error('Workflow returned failure:', fnData);
      // Revert status on failure
      await supabase
        .from('storyboards')
        .update({ plan_status: 'grid_ready' })
        .eq('id', storyboardId);
      return NextResponse.json(
        { error: fnData.error || 'Regeneration failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      storyboard_id: storyboardId,
      grid_image_id: fnData?.grid_image_id,
    });
  } catch (error) {
    console.error('Regenerate grid error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
