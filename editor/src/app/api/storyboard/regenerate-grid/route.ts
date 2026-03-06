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

    // ── Inline start-workflow logic ───────────────────────────────

    const log = createLogger();
    log.setContext({ step: 'StartWorkflow' });

    const adminSupabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: 'studio' } }
    );

    const { rows, cols, grid_image_prompt } = storyboard.plan;

    const { data: gridImage, error: gridInsertError } = await adminSupabase
      .from('grid_images')
      .insert({
        storyboard_id: storyboardId,
        prompt: grid_image_prompt,
        status: 'pending',
        detected_rows: rows,
        detected_cols: cols,
        dimension_detection_status: 'success',
      })
      .select()
      .single();

    if (gridInsertError || !gridImage) {
      log.error('Failed to insert grid_images', {
        error: gridInsertError?.message,
      });
      await supabase
        .from('storyboards')
        .update({ plan_status: 'grid_ready' })
        .eq('id', storyboardId);
      return NextResponse.json(
        { error: 'Failed to create grid image record' },
        { status: 500 }
      );
    }

    const grid_image_id = gridImage.id;
    log.success('grid_images created', { id: grid_image_id });

    const webhookParams = new URLSearchParams({
      step: 'GenGridImage',
      grid_image_id,
      storyboard_id: storyboardId,
      rows: rows.toString(),
      cols: cols.toString(),
      width: dimensions.width.toString(),
      height: dimensions.height.toString(),
    });
    const webhookUrl = `${APP_URL}/api/webhook/fal?${webhookParams.toString()}`;
    const falUrl = new URL(
      'https://queue.fal.run/workflows/octupost/generategridimage'
    );
    falUrl.searchParams.set('fal_webhook', webhookUrl);

    log.api('fal.ai', 'octupost/generategridimage', {
      prompt_length: grid_image_prompt.length,
    });
    log.startTiming('fal_request');

    const falResponse = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: grid_image_prompt }),
    });

    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      log.error('fal.ai request failed', {
        status: falResponse.status,
        error: errorText,
        time_ms: log.endTiming('fal_request'),
      });

      await adminSupabase
        .from('grid_images')
        .update({ status: 'failed', error_message: 'request_error' })
        .eq('id', grid_image_id);

      await supabase
        .from('storyboards')
        .update({ plan_status: 'grid_ready' })
        .eq('id', storyboardId);

      return NextResponse.json(
        { error: 'Failed to start regeneration' },
        { status: 500 }
      );
    }

    const falResult = await falResponse.json();
    log.success('fal.ai request accepted', {
      request_id: falResult.request_id,
      time_ms: log.endTiming('fal_request'),
    });

    await adminSupabase
      .from('grid_images')
      .update({ status: 'processing', request_id: falResult.request_id })
      .eq('id', grid_image_id);

    return NextResponse.json({
      success: true,
      storyboard_id: storyboardId,
      grid_image_id,
    });
  } catch (error) {
    console.error('Regenerate grid error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
