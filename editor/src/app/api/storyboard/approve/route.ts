import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import {
  DEFAULT_GRID_ASPECT_RATIO,
  DEFAULT_GRID_RESOLUTION,
  applyGridGenerationSettingsToPrompt,
  isGridAspectRatio,
  isGridResolution,
  type GridAspectRatio,
  type GridResolution,
} from '@/lib/grid-generation-settings';

const ASPECT_RATIOS: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getWebhookBaseUrl(): string {
  return process.env.WEBHOOK_BASE_URL || getRequiredEnv('NEXT_PUBLIC_APP_URL');
}

// ── Shared helpers ────────────────────────────────────────────────────

interface FalRequestResult {
  requestId: string | null;
  error: string | null;
}

async function sendFalRequest(
  falUrl: URL,
  prompt: string,
  log: ReturnType<typeof createLogger>
): Promise<FalRequestResult> {
  log.api('fal.ai', 'octupost/generategridimage', {
    prompt_length: prompt.length,
  });
  log.startTiming('fal_request');

  const falResponse = await fetch(falUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Key ${getRequiredEnv('FAL_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, web_search: true }),
  });

  if (!falResponse.ok) {
    const errorText = await falResponse.text();
    log.error('fal.ai request failed', {
      status: falResponse.status,
      error: errorText,
      time_ms: log.endTiming('fal_request'),
    });
    return {
      requestId: null,
      error: `fal.ai request failed: ${falResponse.status}`,
    };
  }

  const falResult = await falResponse.json();
  log.success('fal.ai request accepted', {
    request_id: falResult.request_id,
    time_ms: log.endTiming('fal_request'),
  });
  return { requestId: falResult.request_id, error: null };
}

// ── start-workflow logic (image_to_video) ─────────────────────────────

interface WorkflowInput {
  storyboard_id: string;
  project_id: string;
  rows: number;
  cols: number;
  grid_image_prompt: string;
  voiceover_list: Record<string, string[]>;
  visual_prompt_list: string[];
  sfx_prompt_list?: string[];
  width: number;
  height: number;
  voiceover: string;
  aspect_ratio: string;
  grid_generation_aspect_ratio?: GridAspectRatio;
  grid_generation_resolution?: GridResolution;
}

function validateWorkflowInput(input: WorkflowInput): string | null {
  const {
    storyboard_id,
    project_id,
    rows,
    cols,
    grid_image_prompt,
    voiceover_list,
    visual_prompt_list,
    voiceover,
    aspect_ratio,
  } = input;

  if (
    !storyboard_id ||
    !project_id ||
    !grid_image_prompt ||
    !voiceover_list ||
    !visual_prompt_list ||
    !voiceover ||
    !aspect_ratio
  ) {
    return 'Missing required fields';
  }

  if (!rows || !cols || rows < 2 || rows > 8 || cols < 2 || cols > 8) {
    return 'rows and cols must be integers between 2 and 8';
  }
  if (rows !== cols && rows !== cols + 1) {
    return 'rows must equal cols or cols + 1';
  }

  const expectedScenes = rows * cols;
  const languages = Object.keys(voiceover_list);
  if (languages.length === 0)
    return 'voiceover_list must have at least one language';
  for (const lang of languages) {
    if (voiceover_list[lang].length !== expectedScenes) {
      return `voiceover_list.${lang} length must equal rows*cols (${expectedScenes})`;
    }
  }
  if (visual_prompt_list.length !== expectedScenes) {
    return `visual_prompt_list length (${visual_prompt_list.length}) must equal rows*cols (${expectedScenes})`;
  }

  return null;
}

async function executeStartWorkflow(
  input: WorkflowInput,
  log: ReturnType<typeof createLogger>
): Promise<{
  success: boolean;
  error?: string;
  storyboard_id?: string;
  grid_image_id?: string;
  request_id?: string | null;
}> {
  const {
    storyboard_id,
    rows,
    cols,
    grid_image_prompt,
    width,
    height,
    grid_generation_aspect_ratio,
    grid_generation_resolution,
  } = input;

  const validationError = validateWorkflowInput(input);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const supabase = createSupabaseClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { db: { schema: 'studio' } }
  );

  log.info('Using existing storyboard', { id: storyboard_id });

  const { data: gridImage, error: gridInsertError } = await supabase
    .from('grid_images')
    .insert({
      storyboard_id,
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
    return { success: false, error: 'Failed to create grid image record' };
  }

  const grid_image_id = gridImage.id;
  log.success('grid_images created', { id: grid_image_id });

  const webhookParams = new URLSearchParams({
    step: 'GenGridImage',
    grid_image_id,
    storyboard_id,
    rows: rows.toString(),
    cols: cols.toString(),
    width: width.toString(),
    height: height.toString(),
  });
  const webhookUrl = `${getWebhookBaseUrl()}/api/webhook/fal?${webhookParams.toString()}`;
  const falUrl = new URL(
    'https://queue.fal.run/workflows/octupost/generategridimage'
  );
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  const selectedGridAspectRatio = isGridAspectRatio(
    grid_generation_aspect_ratio
  )
    ? grid_generation_aspect_ratio
    : DEFAULT_GRID_ASPECT_RATIO;
  const selectedGridResolution = isGridResolution(grid_generation_resolution)
    ? grid_generation_resolution
    : DEFAULT_GRID_RESOLUTION;

  const falPrompt = applyGridGenerationSettingsToPrompt(
    grid_image_prompt,
    selectedGridAspectRatio,
    selectedGridResolution
  );

  const falResult = await sendFalRequest(falUrl, falPrompt, log);
  if (falResult.error) {
    await supabase
      .from('grid_images')
      .update({ status: 'failed', error_message: 'request_error' })
      .eq('id', grid_image_id);
    log.summary('error', { grid_image_id, reason: 'fal_request_failed' });
    return {
      success: false,
      error: 'Failed to send generation request',
      grid_image_id,
    };
  }

  const requestId = falResult.requestId;
  await supabase
    .from('grid_images')
    .update({ status: 'processing', request_id: requestId })
    .eq('id', grid_image_id);

  log.summary('success', {
    storyboard_id,
    grid_image_id,
    request_id: requestId,
  });
  return { success: true, storyboard_id, grid_image_id, request_id: requestId };
}

// ── start-ref-workflow logic (ref_to_video) ───────────────────────────

interface RefWorkflowInput {
  storyboard_id: string;
  project_id: string;
  objects_rows: number;
  objects_cols: number;
  objects_grid_prompt: string;
  object_names: string[];
  bg_rows: number;
  bg_cols: number;
  backgrounds_grid_prompt: string;
  background_names: string[];
  scene_prompts: string[];
  scene_bg_indices: number[];
  scene_object_indices: number[][];
  voiceover_list: Record<string, string[]>;
  width: number;
  height: number;
  voiceover: string;
  aspect_ratio: string;
  grid_generation_aspect_ratio?: GridAspectRatio;
  grid_generation_resolution?: GridResolution;
}

function validateRefWorkflowInput(input: RefWorkflowInput): string | null {
  const {
    storyboard_id,
    project_id,
    objects_rows,
    objects_cols,
    objects_grid_prompt,
    object_names,
    bg_rows,
    bg_cols,
    backgrounds_grid_prompt,
    background_names,
    scene_prompts,
    scene_bg_indices,
    scene_object_indices,
    voiceover_list,
    voiceover,
    aspect_ratio,
  } = input;

  if (
    !storyboard_id ||
    !project_id ||
    !objects_grid_prompt ||
    !backgrounds_grid_prompt ||
    !voiceover ||
    !aspect_ratio
  ) {
    return 'Missing required fields';
  }

  if (
    !objects_rows ||
    !objects_cols ||
    objects_rows < 2 ||
    objects_rows > 6 ||
    objects_cols < 2 ||
    objects_cols > 6
  ) {
    return 'objects_rows and objects_cols must be integers between 2 and 6';
  }

  const expectedObjects = objects_rows * objects_cols;
  if (!object_names || object_names.length !== expectedObjects) {
    return `object_names length (${object_names?.length}) must equal objects_rows*objects_cols (${expectedObjects})`;
  }

  if (
    !bg_rows ||
    !bg_cols ||
    bg_rows < 2 ||
    bg_rows > 6 ||
    bg_cols < 2 ||
    bg_cols > 6
  ) {
    return 'bg_rows and bg_cols must be integers between 2 and 6';
  }

  const expectedBgs = bg_rows * bg_cols;
  if (!background_names || background_names.length !== expectedBgs) {
    return `background_names length (${background_names?.length}) must equal bg_rows*bg_cols (${expectedBgs})`;
  }

  if (!scene_prompts || !scene_bg_indices || !scene_object_indices) {
    return 'Missing scene data';
  }

  const sceneCount = scene_prompts.length;
  if (
    scene_bg_indices.length !== sceneCount ||
    scene_object_indices.length !== sceneCount
  ) {
    return 'scene_prompts, scene_bg_indices, scene_object_indices must have same length';
  }

  const languages = Object.keys(voiceover_list);
  if (languages.length === 0)
    return 'voiceover_list must have at least one language';
  for (const lang of languages) {
    if (voiceover_list[lang].length !== sceneCount) {
      return `voiceover_list.${lang} length must equal scene count (${sceneCount})`;
    }
  }

  return null;
}

async function sendFalGridRequest(
  prompt: string,
  webhookUrl: string,
  gridAspectRatio: GridAspectRatio,
  gridResolution: GridResolution,
  log: ReturnType<typeof createLogger>
): Promise<FalRequestResult> {
  const falUrl = new URL(
    'https://queue.fal.run/workflows/octupost/generategridimage'
  );
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  const falPrompt = applyGridGenerationSettingsToPrompt(
    prompt,
    gridAspectRatio,
    gridResolution
  );

  log.api('fal.ai', 'octupost/generategridimage', {
    prompt_length: falPrompt.length,
    grid_aspect_ratio: gridAspectRatio,
    grid_resolution: gridResolution,
  });
  log.startTiming('fal_request');

  const falResponse = await fetch(falUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Key ${getRequiredEnv('FAL_KEY')}`,
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
    return {
      requestId: null,
      error: `fal.ai request failed: ${falResponse.status}`,
    };
  }

  const falResult = await falResponse.json();
  log.success('fal.ai request accepted', {
    request_id: falResult.request_id,
    time_ms: log.endTiming('fal_request'),
  });
  return { requestId: falResult.request_id, error: null };
}

async function executeStartRefWorkflow(
  input: RefWorkflowInput,
  log: ReturnType<typeof createLogger>
): Promise<{
  success: boolean;
  error?: string;
  storyboard_id?: string;
  objects_grid_id?: string;
  bg_grid_id?: string;
  objects_request_id?: string | null;
  bg_request_id?: string | null;
}> {
  const {
    storyboard_id,
    objects_rows,
    objects_cols,
    objects_grid_prompt,
    bg_rows,
    bg_cols,
    backgrounds_grid_prompt,
    width,
    height,
    grid_generation_aspect_ratio,
    grid_generation_resolution,
  } = input;

  const validationError = validateRefWorkflowInput(input);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const supabase = createSupabaseClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { db: { schema: 'studio' } }
  );

  log.info('Using existing storyboard', { id: storyboard_id });

  // Create objects grid_images record
  const { data: objectsGrid, error: objGridError } = await supabase
    .from('grid_images')
    .insert({
      storyboard_id,
      prompt: objects_grid_prompt,
      status: 'pending',
      type: 'objects',
      detected_rows: objects_rows,
      detected_cols: objects_cols,
      dimension_detection_status: 'success',
    })
    .select()
    .single();

  if (objGridError || !objectsGrid) {
    log.error('Failed to insert objects grid_images', {
      error: objGridError?.message,
    });
    return {
      success: false,
      error: 'Failed to create objects grid image record',
    };
  }
  log.success('Objects grid_images created', { id: objectsGrid.id });

  // Create backgrounds grid_images record
  const { data: bgGrid, error: bgGridError } = await supabase
    .from('grid_images')
    .insert({
      storyboard_id,
      prompt: backgrounds_grid_prompt,
      status: 'pending',
      type: 'backgrounds',
      detected_rows: bg_rows,
      detected_cols: bg_cols,
      dimension_detection_status: 'success',
    })
    .select()
    .single();

  if (bgGridError || !bgGrid) {
    log.error('Failed to insert backgrounds grid_images', {
      error: bgGridError?.message,
    });
    return {
      success: false,
      error: 'Failed to create backgrounds grid image record',
    };
  }
  log.success('Backgrounds grid_images created', { id: bgGrid.id });

  // Update storyboard to 'generating'
  await supabase
    .from('storyboards')
    .update({ plan_status: 'generating' })
    .eq('id', storyboard_id);

  // Build webhook URLs
  const objectsWebhookParams = new URLSearchParams({
    step: 'GenGridImage',
    grid_image_id: objectsGrid.id,
    storyboard_id,
    rows: objects_rows.toString(),
    cols: objects_cols.toString(),
    width: width.toString(),
    height: height.toString(),
  });
  const objectsWebhookUrl = `${getWebhookBaseUrl()}/api/webhook/fal?${objectsWebhookParams.toString()}`;

  const bgWebhookParams = new URLSearchParams({
    step: 'GenGridImage',
    grid_image_id: bgGrid.id,
    storyboard_id,
    rows: bg_rows.toString(),
    cols: bg_cols.toString(),
    width: width.toString(),
    height: height.toString(),
  });
  const bgWebhookUrl = `${getWebhookBaseUrl()}/api/webhook/fal?${bgWebhookParams.toString()}`;

  const selectedGridAspectRatio = isGridAspectRatio(
    grid_generation_aspect_ratio
  )
    ? grid_generation_aspect_ratio
    : DEFAULT_GRID_ASPECT_RATIO;
  const selectedGridResolution = isGridResolution(grid_generation_resolution)
    ? grid_generation_resolution
    : DEFAULT_GRID_RESOLUTION;

  const [objectsResult, bgResult] = await Promise.all([
    sendFalGridRequest(
      objects_grid_prompt,
      objectsWebhookUrl,
      selectedGridAspectRatio,
      selectedGridResolution,
      log
    ),
    sendFalGridRequest(
      backgrounds_grid_prompt,
      bgWebhookUrl,
      selectedGridAspectRatio,
      selectedGridResolution,
      log
    ),
  ]);

  if (objectsResult.error) {
    await supabase
      .from('grid_images')
      .update({ status: 'failed', error_message: 'request_error' })
      .eq('id', objectsGrid.id);
  } else {
    await supabase
      .from('grid_images')
      .update({ status: 'processing', request_id: objectsResult.requestId })
      .eq('id', objectsGrid.id);
  }

  if (bgResult.error) {
    await supabase
      .from('grid_images')
      .update({ status: 'failed', error_message: 'request_error' })
      .eq('id', bgGrid.id);
  } else {
    await supabase
      .from('grid_images')
      .update({ status: 'processing', request_id: bgResult.requestId })
      .eq('id', bgGrid.id);
  }

  if (objectsResult.error && bgResult.error) {
    await supabase
      .from('storyboards')
      .update({ plan_status: 'failed' })
      .eq('id', storyboard_id);

    log.summary('error', { storyboard_id, reason: 'both_fal_requests_failed' });
    return {
      success: false,
      error: 'Failed to send both generation requests',
      objects_grid_id: objectsGrid.id,
      bg_grid_id: bgGrid.id,
    };
  }

  log.summary('success', {
    storyboard_id,
    objects_grid_id: objectsGrid.id,
    objects_request_id: objectsResult.requestId,
    bg_grid_id: bgGrid.id,
    bg_request_id: bgResult.requestId,
  });

  return {
    success: true,
    storyboard_id,
    objects_grid_id: objectsGrid.id,
    objects_request_id: objectsResult.requestId,
    bg_grid_id: bgGrid.id,
    bg_request_id: bgResult.requestId,
  };
}

// ── Route Handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let parsedStoryboardId: string | undefined;
  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { storyboardId } = await req.json();
    parsedStoryboardId = storyboardId;

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

    if (!['draft', 'failed', 'generating'].includes(storyboard.plan_status)) {
      return NextResponse.json(
        { error: 'Storyboard is not in a retryable status' },
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

    const isRefMode = storyboard.mode === 'ref_to_video';
    const log = createLogger();
    log.setContext({ step: isRefMode ? 'StartRefWorkflow' : 'StartWorkflow' });

    let result: {
      success: boolean;
      error?: string;
      data?: Record<string, unknown>;
    };

    if (isRefMode) {
      result = await executeStartRefWorkflow(
        {
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
          grid_generation_aspect_ratio:
            storyboard.plan.grid_generation_aspect_ratio,
          grid_generation_resolution:
            storyboard.plan.grid_generation_resolution,
        },
        log
      );
    } else {
      result = await executeStartWorkflow(
        {
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
          grid_generation_aspect_ratio:
            storyboard.plan.grid_generation_aspect_ratio,
          grid_generation_resolution:
            storyboard.plan.grid_generation_resolution,
        },
        log
      );
    }

    if (!result.success) {
      // Revert status on failure
      await supabase
        .from('storyboards')
        .update({ plan_status: 'draft' })
        .eq('id', storyboardId);
      return NextResponse.json(
        { error: result.error || 'Workflow failed' },
        { status: 500 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = result as any;
    return NextResponse.json({
      success: true,
      storyboard_id: storyboardId,
      ...(isRefMode
        ? {
            objects_grid_id: r.objects_grid_id,
            bg_grid_id: r.bg_grid_id,
          }
        : { grid_image_id: r.grid_image_id }),
    });
  } catch (error) {
    // Revert storyboard status on unexpected error
    if (parsedStoryboardId) {
      try {
        const adminClient = createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { db: { schema: 'studio' } }
        );
        await adminClient
          .from('storyboards')
          .update({ plan_status: 'draft' })
          .eq('id', parsedStoryboardId);
      } catch {}
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error('Approve storyboard error:', message, error);
    return NextResponse.json(
      {
        error: message.startsWith('Missing required environment variable')
          ? message
          : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
