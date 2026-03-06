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

    // Get dimensions from aspect ratio
    const dimensions =
      ASPECT_RATIOS[storyboard.aspect_ratio] || ASPECT_RATIOS['9:16'];

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

    // Send split request to ComfyUI
    const splitWebhookParams = new URLSearchParams({
      step: 'SplitGridImage',
      grid_image_id: gridImageId,
      storyboard_id: storyboardId,
    });
    const splitWebhookUrl = `${APP_URL}/api/webhook/fal?${splitWebhookParams.toString()}`;

    const falUrl = new URL(
      'https://queue.fal.run/comfy/octupost/splitgridimage'
    );
    falUrl.searchParams.set('fal_webhook', splitWebhookUrl);

    try {
      log.api('ComfyUI', 'splitgridimage', {
        rows,
        cols,
        width: dimensions.width,
        height: dimensions.height,
      });
      log.startTiming('split_request');

      const splitResponse = await fetch(falUrl.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Key ${FAL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          loadimage_1: gridImage.url,
          rows,
          cols,
          width: dimensions.width,
          height: dimensions.height,
        }),
      });

      if (!splitResponse.ok) {
        const errorText = await splitResponse.text();
        log.error('Split request failed', {
          status: splitResponse.status,
          error: errorText,
          time_ms: log.endTiming('split_request'),
        });
        throw new Error(`Split request failed: ${splitResponse.status}`);
      }

      const splitResult = await splitResponse.json();
      log.success('Split request sent', {
        request_id: splitResult.request_id,
        time_ms: log.endTiming('split_request'),
      });

      // Save split_request_id to grid_images for tracking
      await adminSupabase
        .from('grid_images')
        .update({ split_request_id: splitResult.request_id })
        .eq('id', gridImageId);

      log.summary('success', {
        storyboard_id: storyboardId,
        grid_image_id: gridImageId,
        scenes_created: expectedScenes,
        split_request_id: splitResult.request_id,
      });
    } catch (splitError) {
      log.error('Failed to send split request', {
        error:
          splitError instanceof Error ? splitError.message : String(splitError),
      });

      // Mark all first_frames as failed
      const { data: scenes } = await adminSupabase
        .from('scenes')
        .select('id')
        .eq('storyboard_id', storyboardId);

      if (scenes) {
        for (const scene of scenes) {
          await adminSupabase
            .from('first_frames')
            .update({ status: 'failed', error_message: 'internal_error' })
            .eq('scene_id', scene.id);
        }
      }

      return NextResponse.json(
        { error: 'Failed to send split request' },
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
