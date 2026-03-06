import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { splitGrid } from '@/lib/grid-splitter';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient('studio');
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
    const oldSceneCount =
      (Object.values(voiceoverList)[0] as string[] | undefined)?.length ?? 0;

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
          const lastVo =
            voiceoverList[lang][voiceoverList[lang].length - 1] || '';
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

    // ── Inline approve-grid-split logic ──────────────────────────────

    const log = createLogger();
    log.setContext({ step: 'ApproveGridSplit' });

    const adminSupabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: 'studio' } }
    );

    const expectedScenes = rows * cols;
    const visual_prompt_list = plan.visual_flow as string[];

    // Create scenes with first_frames and voiceovers
    log.info('Creating scenes', { count: expectedScenes });
    log.startTiming('create_scenes');

    for (let i = 0; i < expectedScenes; i++) {
      const { data: scene, error: sceneError } = await adminSupabase
        .from('scenes')
        .insert({ storyboard_id: storyboardId, order: i })
        .select()
        .single();

      if (sceneError || !scene) {
        log.warn('Failed to insert scene', {
          index: i,
          error: sceneError?.message,
        });
        continue;
      }

      await adminSupabase.from('first_frames').insert({
        scene_id: scene.id,
        grid_image_id: gridImageId,
        visual_prompt: visual_prompt_list[i],
        status: 'processing',
      });

      for (const lang of languages) {
        await adminSupabase.from('voiceovers').insert({
          scene_id: scene.id,
          text: voiceoverList[lang][i],
          language: lang,
          status: 'success',
        });
      }
    }

    log.success('Scenes created', {
      count: expectedScenes,
      time_ms: log.endTiming('create_scenes'),
    });

    // Split grid image using Sharp-based auto-splitter
    log.startTiming('split_grid');
    const splitResult = await splitGrid(
      {
        imageUrl: gridImage.url,
        rows,
        cols,
        storyboardId,
        gridImageId,
        type: 'first_frames',
      },
      log
    );
    log.info('Grid split completed', {
      success: splitResult.success,
      tiles: splitResult.tiles.length,
      time_ms: log.endTiming('split_grid'),
    });

    if (!splitResult.success) {
      log.error('Grid split failed', { error: splitResult.error });

      // Mark all first_frames as failed
      const { data: scenes } = await adminSupabase
        .from('scenes')
        .select('id')
        .eq('storyboard_id', storyboardId);

      if (scenes) {
        for (const scene of scenes) {
          await adminSupabase
            .from('first_frames')
            .update({ status: 'failed', error_message: 'split_error' })
            .eq('scene_id', scene.id);
        }
      }

      return NextResponse.json({ error: 'Grid split failed' }, { status: 500 });
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
