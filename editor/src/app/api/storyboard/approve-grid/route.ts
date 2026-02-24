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

    const { storyboardId, gridImageId, rows, cols } = await req.json();

    if (!storyboardId || !gridImageId) {
      return NextResponse.json(
        { error: 'storyboardId and gridImageId are required' },
        { status: 400 }
      );
    }

    if (!rows || !cols || rows < 2 || rows > 8 || cols < 2 || cols > 8) {
      return NextResponse.json(
        { error: 'rows and cols must be between 2 and 8' },
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

    // Fetch grid image, validate status === 'generated'
    const { data: gridImage, error: gridError } = await supabase
      .from('grid_images')
      .select('*')
      .eq('id', gridImageId)
      .single();

    if (gridError || !gridImage) {
      return NextResponse.json(
        { error: 'Grid image not found' },
        { status: 404 }
      );
    }

    if (gridImage.status !== 'generated') {
      return NextResponse.json(
        { error: 'Grid image is not in generated status' },
        { status: 400 }
      );
    }

    // If rows/cols changed, adjust voiceover_list and visual_flow
    const plan = { ...storyboard.plan };
    const newSceneCount = rows * cols;
    const voiceoverList = plan.voiceover_list as Record<string, string[]>;
    const languages = Object.keys(voiceoverList);
    const oldSceneCount = (Object.values(voiceoverList)[0] as string[] | undefined)?.length ?? 0;

    if (
      newSceneCount !== oldSceneCount ||
      rows !== plan.rows ||
      cols !== plan.cols
    ) {
      plan.rows = rows;
      plan.cols = cols;

      if (newSceneCount < oldSceneCount) {
        for (const lang of languages) {
          voiceoverList[lang] = voiceoverList[lang].slice(0, newSceneCount);
        }
        plan.voiceover_list = voiceoverList;
        plan.visual_flow = plan.visual_flow.slice(0, newSceneCount);
      } else if (newSceneCount > oldSceneCount) {
        for (const lang of languages) {
          const lastVo = voiceoverList[lang][voiceoverList[lang].length - 1] || '';
          while (voiceoverList[lang].length < newSceneCount) {
            voiceoverList[lang].push(lastVo);
          }
        }
        plan.voiceover_list = voiceoverList;
        const lastVf = plan.visual_flow[plan.visual_flow.length - 1] || '';
        while (plan.visual_flow.length < newSceneCount) {
          plan.visual_flow.push(lastVf);
        }
      }

      // Update plan in DB
      const { error: updatePlanError } = await supabase
        .from('storyboards')
        .update({ plan })
        .eq('id', storyboardId);

      if (updatePlanError) {
        console.error('Failed to update plan:', updatePlanError);
        return NextResponse.json(
          { error: 'Failed to update plan' },
          { status: 500 }
        );
      }
    }

    // Get dimensions from aspect ratio
    const dimensions =
      ASPECT_RATIOS[storyboard.aspect_ratio] || ASPECT_RATIOS['9:16'];

    // Call approve-grid-split edge function
    // User is already verified by getUser() above. We use the anon key as the
    // bearer token because Supabase Auth issues ES256 JWTs which the edge
    // function gateway cannot verify (it expects HS256).
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const fnResponse = await fetch(
      `${supabaseUrl}/functions/v1/approve-grid-split`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          storyboard_id: storyboardId,
          grid_image_id: gridImageId,
          grid_image_url: gridImage.url,
          rows: plan.rows,
          cols: plan.cols,
          width: dimensions.width,
          height: dimensions.height,
          voiceover_list: plan.voiceover_list,
          visual_prompt_list: plan.visual_flow,
        }),
      }
    );

    if (!fnResponse.ok) {
      const errorBody = await fnResponse.text();
      console.error('Edge function error:', fnResponse.status, errorBody);
      return NextResponse.json(
        { error: 'Failed to start split workflow' },
        { status: 500 }
      );
    }

    const fnData = await fnResponse.json();

    if (fnData && fnData.success === false) {
      console.error('Split workflow returned failure:', fnData);
      return NextResponse.json(
        { error: fnData.error || 'Split workflow failed' },
        { status: 500 }
      );
    }

    // Update plan_status to 'approved'
    await supabase
      .from('storyboards')
      .update({ plan_status: 'approved' })
      .eq('id', storyboardId);

    return NextResponse.json({
      success: true,
      storyboard_id: storyboardId,
      grid_image_id: gridImageId,
    });
  } catch (error) {
    console.error('Approve grid error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
