import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';
import {
  DEFAULT_GRID_ASPECT_RATIO,
  DEFAULT_GRID_RESOLUTION,
  applyGridGenerationSettingsToPrompt,
  getGridOutputDimensions,
  isGridAspectRatio,
  isGridResolution,
} from '@/lib/grid-generation-settings';

const FAL_API_KEY = process.env.FAL_KEY!;

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { storyboardId, gridImagePrompt, gridAspectRatio, gridResolution } =
      await req.json();

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

    // ── Inline start-workflow logic ───────────────────────────────

    const log = createLogger();
    log.setContext({ step: 'StartWorkflow' });

    const adminSupabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { db: { schema: 'studio' } }
    );

    const {
      rows,
      cols,
      grid_image_prompt: existingGridPrompt,
      grid_generation_aspect_ratio: existingGridAspectRatio,
      grid_generation_resolution: existingGridResolution,
    } = storyboard.plan;

    const finalGridAspectRatio = isGridAspectRatio(gridAspectRatio)
      ? gridAspectRatio
      : isGridAspectRatio(existingGridAspectRatio)
        ? existingGridAspectRatio
        : DEFAULT_GRID_ASPECT_RATIO;

    const finalGridResolution = isGridResolution(gridResolution)
      ? gridResolution
      : isGridResolution(existingGridResolution)
        ? existingGridResolution
        : DEFAULT_GRID_RESOLUTION;

    // Keep webhook metadata dimensions in sync with selected grid settings
    const dimensions = getGridOutputDimensions(
      finalGridAspectRatio,
      finalGridResolution
    );

    const finalGridPrompt =
      typeof gridImagePrompt === 'string' && gridImagePrompt.trim().length > 0
        ? gridImagePrompt.trim()
        : existingGridPrompt;

    if (!finalGridPrompt || typeof finalGridPrompt !== 'string') {
      return NextResponse.json(
        { error: 'gridImagePrompt must be a non-empty string' },
        { status: 400 }
      );
    }

    const planNeedsUpdate =
      finalGridPrompt !== existingGridPrompt ||
      finalGridAspectRatio !== existingGridAspectRatio ||
      finalGridResolution !== existingGridResolution;

    if (planNeedsUpdate) {
      const updatedPlan = {
        ...storyboard.plan,
        grid_image_prompt: finalGridPrompt,
        grid_generation_aspect_ratio: finalGridAspectRatio,
        grid_generation_resolution: finalGridResolution,
      };

      const { error: planUpdateError } = await supabase
        .from('storyboards')
        .update({ plan: updatedPlan })
        .eq('id', storyboardId);

      if (planUpdateError) {
        return NextResponse.json(
          { error: 'Failed to update storyboard plan settings' },
          { status: 500 }
        );
      }
    }

    const falPrompt = applyGridGenerationSettingsToPrompt(
      finalGridPrompt,
      finalGridAspectRatio,
      finalGridResolution
    );

    const { data: gridImage, error: gridInsertError } = await adminSupabase
      .from('grid_images')
      .insert({
        storyboard_id: storyboardId,
        prompt: finalGridPrompt,
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
    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }
    const webhookUrl = `${webhookBase}/api/webhook/fal?${webhookParams.toString()}`;
    const falUrl = new URL(
      'https://queue.fal.run/workflows/octupost/generategridimage'
    );
    falUrl.searchParams.set('fal_webhook', webhookUrl);

    log.api('fal.ai', 'octupost/generategridimage', {
      prompt_length: falPrompt.length,
      grid_aspect_ratio: finalGridAspectRatio,
      grid_resolution: finalGridResolution,
    });
    log.startTiming('fal_request');

    const falResponse = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: falPrompt, web_search: true }),
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
      grid_aspect_ratio: finalGridAspectRatio,
      grid_resolution: finalGridResolution,
    });
  } catch (error) {
    console.error('Regenerate grid error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
