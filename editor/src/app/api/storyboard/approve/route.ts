import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { queueKieImageTask } from '@/lib/kie-image';
import type { createLogger } from '@/lib/logger';
import {
  resolveProvider,
  type GenerationProvider,
} from '@/lib/provider-routing';
import {
  DEFAULT_GRID_ASPECT_RATIO,
  DEFAULT_GRID_RESOLUTION,
  applyGridGenerationSettingsToPrompt,
  isGridAspectRatio,
  isGridResolution,
  type GridAspectRatio,
  type GridResolution,
} from '@/lib/grid-generation-settings';

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// ── Shared helpers ────────────────────────────────────────────────────

interface FalRequestResult {
  requestId: string | null;
  error: string | null;
}

async function sendFalRequest(
  provider: GenerationProvider,
  webhookUrl: string,
  prompt: string,
  gridAspectRatio: GridAspectRatio,
  gridResolution: GridResolution,
  log: ReturnType<typeof createLogger>
): Promise<FalRequestResult> {
  if (provider === 'kie') {
    log.api('kie.ai', 'nano-banana-2', {
      prompt_length: prompt.length,
      grid_aspect_ratio: gridAspectRatio,
      grid_resolution: gridResolution,
    });
    log.startTiming('kie_request');

    try {
      const queued = await queueKieImageTask({
        prompt,
        callbackUrl: webhookUrl,
        aspectRatio: gridAspectRatio,
        resolution: gridResolution,
        outputFormat: 'jpg',
      });

      log.success('kie.ai request accepted', {
        request_id: queued.requestId,
        time_ms: log.endTiming('kie_request'),
      });
      return { requestId: queued.requestId, error: null };
    } catch (error) {
      log.error('kie.ai request failed', {
        error: error instanceof Error ? error.message : String(error),
        time_ms: log.endTiming('kie_request'),
      });

      return {
        requestId: null,
        error: 'kie.ai request failed',
      };
    }
  }

  const falUrl = new URL(
    'https://queue.fal.run/workflows/octupost/generategridimage'
  );
  falUrl.searchParams.set('fal_webhook', webhookUrl);

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

/**
 * @deprecated Legacy grid-based approve flow (image_to_video).
 * Kept for backward compatibility and historical reference.
 * New approve flow creates scenes directly and does not queue grid generation.
 */
async function executeStartWorkflow(
  input: WorkflowInput,
  provider: GenerationProvider,
  webhookBase: string,
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

  const { data: existingGrid } = await supabase
    .from('grid_images')
    .select('id, request_id')
    .eq('storyboard_id', storyboard_id)
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingGrid?.id) {
    log.info('Reusing in-flight grid generation', {
      storyboard_id,
      grid_image_id: existingGrid.id,
      request_id: existingGrid.request_id,
    });

    return {
      success: true,
      storyboard_id,
      grid_image_id: existingGrid.id,
      request_id: existingGrid.request_id,
    };
  }

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
  const callbackPath =
    provider === 'kie' ? '/api/webhook/kieai' : '/api/webhook/fal';
  const resolvedWebhookUrl = `${webhookBase}${callbackPath}?${webhookParams.toString()}`;

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

  const falResult = await sendFalRequest(
    provider,
    resolvedWebhookUrl,
    falPrompt,
    selectedGridAspectRatio,
    selectedGridResolution,
    log
  );
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
  provider: GenerationProvider,
  prompt: string,
  webhookUrl: string,
  gridAspectRatio: GridAspectRatio,
  gridResolution: GridResolution,
  log: ReturnType<typeof createLogger>
): Promise<FalRequestResult> {
  const falPrompt = applyGridGenerationSettingsToPrompt(
    prompt,
    gridAspectRatio,
    gridResolution
  );

  if (provider === 'kie') {
    log.api('kie.ai', 'nano-banana-2', {
      prompt_length: falPrompt.length,
      grid_aspect_ratio: gridAspectRatio,
      grid_resolution: gridResolution,
    });
    log.startTiming('kie_request');

    try {
      const queued = await queueKieImageTask({
        prompt: falPrompt,
        callbackUrl: webhookUrl,
        aspectRatio: gridAspectRatio,
        resolution: gridResolution,
        outputFormat: 'jpg',
      });

      log.success('kie.ai request accepted', {
        request_id: queued.requestId,
        time_ms: log.endTiming('kie_request'),
      });
      return { requestId: queued.requestId, error: null };
    } catch (error) {
      log.error('kie.ai request failed', {
        error: error instanceof Error ? error.message : String(error),
        time_ms: log.endTiming('kie_request'),
      });

      return {
        requestId: null,
        error: 'kie.ai request failed',
      };
    }
  }

  const falUrl = new URL(
    'https://queue.fal.run/workflows/octupost/generategridimage'
  );
  falUrl.searchParams.set('fal_webhook', webhookUrl);

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

/**
 * @deprecated Legacy grid-based approve flow (ref_to_video).
 * Kept for backward compatibility and historical reference.
 * New approve flow creates scenes directly and does not queue grid generation.
 */
async function executeStartRefWorkflow(
  input: RefWorkflowInput,
  provider: GenerationProvider,
  webhookBase: string,
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

  const { data: existingGrids } = await supabase
    .from('grid_images')
    .select('id, type, request_id')
    .eq('storyboard_id', storyboard_id)
    .in('type', ['objects', 'backgrounds'])
    .in('status', ['pending', 'processing']);

  const existingObjectsGrid = existingGrids?.find(
    (grid: { type: string }) => grid.type === 'objects'
  );
  const existingBackgroundsGrid = existingGrids?.find(
    (grid: { type: string }) => grid.type === 'backgrounds'
  );

  if (existingObjectsGrid?.id && existingBackgroundsGrid?.id) {
    log.info('Reusing in-flight ref grid generations', {
      storyboard_id,
      objects_grid_id: existingObjectsGrid.id,
      objects_request_id: existingObjectsGrid.request_id,
      bg_grid_id: existingBackgroundsGrid.id,
      bg_request_id: existingBackgroundsGrid.request_id,
    });

    return {
      success: true,
      storyboard_id,
      objects_grid_id: existingObjectsGrid.id,
      objects_request_id: existingObjectsGrid.request_id,
      bg_grid_id: existingBackgroundsGrid.id,
      bg_request_id: existingBackgroundsGrid.request_id,
    };
  }

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
  const callbackPath =
    provider === 'kie' ? '/api/webhook/kieai' : '/api/webhook/fal';
  const objectsWebhookUrl = `${webhookBase}${callbackPath}?${objectsWebhookParams.toString()}`;

  const bgWebhookParams = new URLSearchParams({
    step: 'GenGridImage',
    grid_image_id: bgGrid.id,
    storyboard_id,
    rows: bg_rows.toString(),
    cols: bg_cols.toString(),
    width: width.toString(),
    height: height.toString(),
  });
  const bgWebhookUrl = `${webhookBase}${callbackPath}?${bgWebhookParams.toString()}`;

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
      provider,
      objects_grid_prompt,
      objectsWebhookUrl,
      selectedGridAspectRatio,
      selectedGridResolution,
      log
    ),
    sendFalGridRequest(
      provider,
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

type ScenePrompt = string | string[];

type ApprovalPlan = {
  scene_prompts?: ScenePrompt[];
  visual_flow?: string[];
  voiceover_list?: Record<string, string[]>;
  scene_shot_durations?: Array<Array<number | string> | null>;
};

function normalizeScenePrompts(plan: ApprovalPlan): ScenePrompt[] {
  if (Array.isArray(plan.scene_prompts) && plan.scene_prompts.length > 0) {
    return plan.scene_prompts;
  }

  if (Array.isArray(plan.visual_flow) && plan.visual_flow.length > 0) {
    return plan.visual_flow;
  }

  return [];
}

function getMultiShots(
  scenePrompt: ScenePrompt,
  sceneIndex: number,
  sceneShotDurations?: Array<Array<number | string> | null>
): Array<{ duration: string }> | null {
  if (!Array.isArray(scenePrompt)) return null;

  const rawDurations = sceneShotDurations?.[sceneIndex];
  if (!Array.isArray(rawDurations)) return null;

  const normalized = rawDurations
    .slice(0, scenePrompt.length)
    .map((duration) => ({ duration: String(duration) }));

  return normalized.length === scenePrompt.length ? normalized : null;
}

export async function POST(req: NextRequest) {
  let parsedStoryboardId: string | undefined;
  let claimedToApproved = false;

  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { storyboardId } = body;
    const providerResolution = await resolveProvider({
      service: 'video',
      req,
      body,
    });

    if (providerResolution.provider === 'fal' && !process.env.FAL_KEY) {
      return NextResponse.json({ error: 'Missing FAL_KEY' }, { status: 500 });
    }
    parsedStoryboardId = storyboardId;

    if (!storyboardId) {
      return NextResponse.json(
        { error: 'Storyboard ID is required' },
        { status: 400 }
      );
    }

    const { data: storyboard, error: fetchError } = await supabase
      .from('storyboards')
      .select('id, plan, plan_status')
      .eq('id', storyboardId)
      .single();

    if (fetchError || !storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    if (!storyboard.plan) {
      return NextResponse.json(
        { error: 'Storyboard has no plan' },
        { status: 400 }
      );
    }

    if (!['draft', 'failed', 'approved'].includes(storyboard.plan_status)) {
      return NextResponse.json(
        {
          error:
            'Storyboard is not in an approvable status (expected draft, failed, or approved)',
        },
        { status: 400 }
      );
    }

    if (storyboard.plan_status !== 'approved') {
      const { data: claimedStoryboard, error: claimError } = await supabase
        .from('storyboards')
        .update({ plan_status: 'approved' })
        .eq('id', storyboardId)
        .eq('plan_status', storyboard.plan_status)
        .select('id')
        .single();

      if (claimError || !claimedStoryboard) {
        const { data: currentStoryboard } = await supabase
          .from('storyboards')
          .select('plan_status')
          .eq('id', storyboardId)
          .maybeSingle();

        if (currentStoryboard?.plan_status !== 'approved') {
          return NextResponse.json(
            { error: 'Storyboard is being updated, please retry' },
            { status: 409 }
          );
        }
      } else {
        claimedToApproved = true;
      }
    }

    const { data: existingScene } = await supabase
      .from('scenes')
      .select('id')
      .eq('storyboard_id', storyboardId)
      .limit(1)
      .maybeSingle();

    if (existingScene) {
      return NextResponse.json({
        success: true,
        storyboard_id: storyboardId,
        status: 'approved',
        provider: providerResolution.provider,
        already_approved: true,
        scenes_created: 0,
      });
    }

    const plan = storyboard.plan as ApprovalPlan;
    const scenePrompts = normalizeScenePrompts(plan);

    if (scenePrompts.length === 0) {
      return NextResponse.json(
        { error: 'Storyboard plan has no scene prompts' },
        { status: 400 }
      );
    }

    const voiceoverList =
      plan.voiceover_list && typeof plan.voiceover_list === 'object'
        ? plan.voiceover_list
        : {};
    const languages = Object.keys(voiceoverList);

    for (const lang of languages) {
      const lines = voiceoverList[lang];
      if (!Array.isArray(lines) || lines.length !== scenePrompts.length) {
        return NextResponse.json(
          {
            error: `voiceover_list.${lang} length must equal scene count (${scenePrompts.length})`,
          },
          { status: 400 }
        );
      }
    }

    const sceneRows = scenePrompts.map((scenePrompt, index) => ({
      storyboard_id: storyboardId,
      order: index,
      prompt: Array.isArray(scenePrompt) ? null : scenePrompt,
      multi_prompt: Array.isArray(scenePrompt) ? scenePrompt : null,
      multi_shots: getMultiShots(scenePrompt, index, plan.scene_shot_durations),
      video_status: 'pending',
    }));

    const { data: createdScenes, error: sceneInsertError } = await supabase
      .from('scenes')
      .insert(sceneRows)
      .select('id, order');

    if (sceneInsertError || !createdScenes || createdScenes.length === 0) {
      return NextResponse.json(
        { error: 'Failed to create scene rows' },
        { status: 500 }
      );
    }

    if (languages.length > 0) {
      const sceneIdByOrder = new Map(
        createdScenes.map((scene) => [scene.order, scene.id])
      );

      const voiceoverRows = scenePrompts.flatMap((_, sceneIndex) =>
        languages.map((lang) => ({
          scene_id: sceneIdByOrder.get(sceneIndex),
          text: voiceoverList[lang]?.[sceneIndex] ?? '',
          language: lang,
          status: 'success',
        }))
      );

      const validVoiceoverRows = voiceoverRows.filter(
        (
          row
        ): row is {
          scene_id: string;
          text: string;
          language: string;
          status: 'success';
        } => typeof row.scene_id === 'string'
      );

      if (validVoiceoverRows.length > 0) {
        const { error: voiceoverInsertError } = await supabase
          .from('voiceovers')
          .insert(validVoiceoverRows);

        if (voiceoverInsertError) {
          return NextResponse.json(
            { error: 'Failed to create voiceover rows' },
            { status: 500 }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      storyboard_id: storyboardId,
      status: 'approved',
      provider: providerResolution.provider,
      scenes_created: createdScenes.length,
    });
  } catch (error) {
    if (parsedStoryboardId && claimedToApproved) {
      try {
        const adminClient = createSupabaseClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { db: { schema: 'studio' } }
        );
        await adminClient
          .from('storyboards')
          .update({ plan_status: 'failed' })
          .eq('id', parsedStoryboardId)
          .eq('plan_status', 'approved');
      } catch {
        // best effort rollback
      }
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
