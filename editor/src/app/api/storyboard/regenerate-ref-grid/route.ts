import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { queueKieImageTask } from '@/lib/kie-image';
import { createLogger } from '@/lib/logger';
import {
  resolveProvider,
  type GenerationProvider,
} from '@/lib/provider-routing';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';
import {
  DEFAULT_GRID_ASPECT_RATIO,
  DEFAULT_GRID_RESOLUTION,
  applyGridGenerationSettingsToPrompt,
  getGridOutputDimensions,
  isGridAspectRatio,
  isGridResolution,
  type GridAspectRatio,
  type GridResolution,
} from '@/lib/grid-generation-settings';

const FAL_API_KEY = process.env.FAL_KEY!;

type RegenerateTarget = 'objects' | 'backgrounds' | 'both';

type RefPlanShape = {
  objects_rows: number;
  objects_cols: number;
  objects_grid_prompt: string;
  bg_rows: number;
  bg_cols: number;
  backgrounds_grid_prompt: string;
  grid_generation_aspect_ratio?: GridAspectRatio;
  grid_generation_resolution?: GridResolution;
  [key: string]: unknown;
};

interface GridRow {
  id: string;
  type: 'objects' | 'backgrounds' | string;
  status: 'pending' | 'processing' | 'generated' | 'failed' | string;
}

interface QueueResult {
  target: 'objects' | 'backgrounds';
  success: boolean;
  requestId: string | null;
  error: string | null;
}

function isValidTarget(value: unknown): value is RegenerateTarget {
  return value === 'objects' || value === 'backgrounds' || value === 'both';
}

function isRefPlanShape(plan: unknown): plan is RefPlanShape {
  if (!plan || typeof plan !== 'object') return false;
  const p = plan as Record<string, unknown>;
  return (
    typeof p.objects_rows === 'number' &&
    typeof p.objects_cols === 'number' &&
    typeof p.objects_grid_prompt === 'string' &&
    typeof p.bg_rows === 'number' &&
    typeof p.bg_cols === 'number' &&
    typeof p.backgrounds_grid_prompt === 'string'
  );
}

function normalizePrompt(prompt: unknown): string | null {
  if (typeof prompt !== 'string') return null;
  const trimmed = prompt.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function selectedTargets(
  target: RegenerateTarget
): Array<'objects' | 'backgrounds'> {
  if (target === 'both') return ['objects', 'backgrounds'];
  return [target];
}

async function queueGridGeneration(
  // biome-ignore lint/suspicious/noExplicitAny: service-role supabase client type is untyped in repo
  supabase: any,
  params: {
    storyboardId: string;
    gridImageId: string;
    target: 'objects' | 'backgrounds';
    prompt: string;
    rows: number;
    cols: number;
    width: number;
    height: number;
    gridAspectRatio: GridAspectRatio;
    gridResolution: GridResolution;
  },
  provider: GenerationProvider,
  webhookBase: string,
  log: ReturnType<typeof createLogger>
): Promise<QueueResult> {
  const {
    storyboardId,
    gridImageId,
    target,
    prompt,
    rows,
    cols,
    width,
    height,
    gridAspectRatio,
    gridResolution,
  } = params;

  const falPrompt = applyGridGenerationSettingsToPrompt(
    prompt,
    gridAspectRatio,
    gridResolution
  );

  await supabase
    .from('grid_images')
    .update({
      status: 'pending',
      prompt,
      error_message: null,
      request_id: null,
      detected_rows: rows,
      detected_cols: cols,
      dimension_detection_status: 'success',
    })
    .eq('id', gridImageId);

  const webhookParams = new URLSearchParams({
    step: 'GenGridImage',
    grid_image_id: gridImageId,
    storyboard_id: storyboardId,
    rows: rows.toString(),
    cols: cols.toString(),
    width: width.toString(),
    height: height.toString(),
  });

  const callbackPath =
    provider === 'kie' ? '/api/webhook/kieai' : '/api/webhook/fal';
  const webhookUrl = `${webhookBase}${callbackPath}?${webhookParams.toString()}`;

  log.api(
    provider === 'kie' ? 'kie.ai' : 'fal.ai',
    `octupost/generategridimage:${target}`,
    {
      grid_image_id: gridImageId,
      prompt_length: falPrompt.length,
      grid_aspect_ratio: gridAspectRatio,
      grid_resolution: gridResolution,
    }
  );
  let requestId: string | null = null;

  if (provider === 'kie') {
    try {
      const queued = await queueKieImageTask({
        prompt: falPrompt,
        callbackUrl: webhookUrl,
        aspectRatio: gridAspectRatio,
        resolution: gridResolution,
        outputFormat: 'jpg',
      });
      requestId = queued.requestId;
    } catch (error) {
      await supabase
        .from('grid_images')
        .update({ status: 'failed', error_message: 'request_error' })
        .eq('id', gridImageId)
        .in('status', ['pending', 'processing']);

      return {
        target,
        success: false,
        requestId: null,
        error:
          error instanceof Error
            ? `kie.ai request failed: ${error.message}`
            : 'kie.ai request failed',
      };
    }
  } else {
    const falUrl = new URL(
      'https://queue.fal.run/workflows/octupost/generategridimage'
    );
    falUrl.searchParams.set('fal_webhook', webhookUrl);

    const response = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: falPrompt, web_search: true }),
    });

    if (!response.ok) {
      const text = await response.text();

      await supabase
        .from('grid_images')
        .update({ status: 'failed', error_message: 'request_error' })
        .eq('id', gridImageId)
        .in('status', ['pending', 'processing']);

      return {
        target,
        success: false,
        requestId: null,
        error: `fal.ai request failed: ${response.status} ${text}`,
      };
    }

    const result = await response.json();
    requestId =
      typeof result?.request_id === 'string' ? result.request_id : null;
  }

  if (!requestId) {
    await supabase
      .from('grid_images')
      .update({ status: 'failed', error_message: 'missing_request_id' })
      .eq('id', gridImageId)
      .in('status', ['pending', 'processing']);

    return {
      target,
      success: false,
      requestId: null,
      error: 'fal.ai response missing request_id',
    };
  }

  await supabase
    .from('grid_images')
    .update({ status: 'processing', request_id: requestId })
    .eq('id', gridImageId)
    .eq('status', 'pending');

  return {
    target,
    success: true,
    requestId,
    error: null,
  };
}

export async function POST(req: NextRequest) {
  const log = createLogger();
  log.setContext({ step: 'RegenerateRefGrid' });

  try {
    const authClient = await createClient('studio');
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const storyboardId = body.storyboardId as string | undefined;
    const target = body.target as RegenerateTarget | undefined;
    const providerResolution = await resolveProvider({
      service: 'video',
      req,
      body,
    });

    if (!storyboardId) {
      return NextResponse.json(
        { error: 'storyboardId is required' },
        { status: 400 }
      );
    }

    if (providerResolution.provider === 'fal' && !process.env.FAL_KEY) {
      return NextResponse.json({ error: 'Missing FAL_KEY' }, { status: 500 });
    }

    if (!isValidTarget(target)) {
      return NextResponse.json(
        { error: 'target must be objects, backgrounds, or both' },
        { status: 400 }
      );
    }

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    const supabase = createServiceClient();

    const { data: storyboard, error: storyboardError } = await supabase
      .from('storyboards')
      .select('id, mode, plan_status, plan, aspect_ratio')
      .eq('id', storyboardId)
      .single();

    if (storyboardError || !storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    if (storyboard.mode !== 'ref_to_video') {
      return NextResponse.json(
        { error: 'This endpoint only supports ref_to_video storyboards' },
        { status: 400 }
      );
    }

    if (
      storyboard.plan_status !== 'grid_ready' &&
      storyboard.plan_status !== 'failed' &&
      storyboard.plan_status !== 'generating'
    ) {
      return NextResponse.json(
        {
          error: `Storyboard must be in grid_ready, failed, or generating status to regenerate (current: ${storyboard.plan_status ?? 'null'})`,
        },
        { status: 400 }
      );
    }

    if (!isRefPlanShape(storyboard.plan)) {
      return NextResponse.json(
        { error: 'Invalid or missing ref workflow plan' },
        { status: 400 }
      );
    }

    // Do not allow regenerate after split has created scenes
    const { count: sceneCount } = await supabase
      .from('scenes')
      .select('id', { count: 'exact', head: true })
      .eq('storyboard_id', storyboardId);

    if ((sceneCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'Cannot regenerate after split. Create a new storyboard instead.',
        },
        { status: 400 }
      );
    }

    const { data: grids, error: gridsError } = await supabase
      .from('grid_images')
      .select('id, type, status')
      .eq('storyboard_id', storyboardId)
      .in('type', ['objects', 'backgrounds']);

    if (gridsError || !grids || grids.length === 0) {
      return NextResponse.json(
        { error: 'No objects/background grids found for storyboard' },
        { status: 404 }
      );
    }

    const gridMap = new Map<string, GridRow>();
    for (const g of grids as GridRow[]) {
      gridMap.set(g.type, g);
    }

    const objectsGrid = gridMap.get('objects');
    const backgroundsGrid = gridMap.get('backgrounds');

    if (!objectsGrid || !backgroundsGrid) {
      return NextResponse.json(
        { error: 'Both objects and backgrounds grids are required' },
        { status: 400 }
      );
    }

    const targets = selectedTargets(target);

    for (const t of targets) {
      const row = t === 'objects' ? objectsGrid : backgroundsGrid;
      if (row.status === 'processing' || row.status === 'pending') {
        return NextResponse.json(
          { error: `${t} grid is already generating` },
          { status: 409 }
        );
      }
    }

    const existingPlan = storyboard.plan;
    const newObjectsPrompt =
      normalizePrompt(body.objectsPrompt) ?? existingPlan.objects_grid_prompt;
    const newBackgroundsPrompt =
      normalizePrompt(body.backgroundsPrompt) ??
      existingPlan.backgrounds_grid_prompt;

    const selectedGridAspectRatio = isGridAspectRatio(body.gridAspectRatio)
      ? body.gridAspectRatio
      : isGridAspectRatio(existingPlan.grid_generation_aspect_ratio)
        ? existingPlan.grid_generation_aspect_ratio
        : DEFAULT_GRID_ASPECT_RATIO;

    const selectedGridResolution = isGridResolution(body.gridResolution)
      ? body.gridResolution
      : isGridResolution(existingPlan.grid_generation_resolution)
        ? existingPlan.grid_generation_resolution
        : DEFAULT_GRID_RESOLUTION;

    const updatedPlan: RefPlanShape = {
      ...existingPlan,
      objects_grid_prompt: newObjectsPrompt,
      backgrounds_grid_prompt: newBackgroundsPrompt,
      grid_generation_aspect_ratio: selectedGridAspectRatio,
      grid_generation_resolution: selectedGridResolution,
    };

    await supabase
      .from('storyboards')
      .update({ plan: updatedPlan, plan_status: 'generating' })
      .eq('id', storyboardId)
      .in('plan_status', ['grid_ready', 'failed', 'generating']);

    const dims = getGridOutputDimensions(
      selectedGridAspectRatio,
      selectedGridResolution
    );

    const queueResults: QueueResult[] = [];

    for (const t of targets) {
      if (t === 'objects') {
        queueResults.push(
          await queueGridGeneration(
            supabase,
            {
              storyboardId,
              gridImageId: objectsGrid.id,
              target: 'objects',
              prompt: newObjectsPrompt,
              rows: updatedPlan.objects_rows,
              cols: updatedPlan.objects_cols,
              width: dims.width,
              height: dims.height,
              gridAspectRatio: selectedGridAspectRatio,
              gridResolution: selectedGridResolution,
            },
            providerResolution.provider,
            webhookBase,
            log
          )
        );
      } else {
        queueResults.push(
          await queueGridGeneration(
            supabase,
            {
              storyboardId,
              gridImageId: backgroundsGrid.id,
              target: 'backgrounds',
              prompt: newBackgroundsPrompt,
              rows: updatedPlan.bg_rows,
              cols: updatedPlan.bg_cols,
              width: dims.width,
              height: dims.height,
              gridAspectRatio: selectedGridAspectRatio,
              gridResolution: selectedGridResolution,
            },
            providerResolution.provider,
            webhookBase,
            log
          )
        );
      }
    }

    const successCount = queueResults.filter((r) => r.success).length;

    if (successCount === 0) {
      await supabase
        .from('storyboards')
        .update({ plan_status: 'failed' })
        .eq('id', storyboardId)
        .eq('plan_status', 'generating');

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to queue regeneration requests',
          results: queueResults,
        },
        { status: 500 }
      );
    }

    log.summary('success', {
      storyboard_id: storyboardId,
      provider: providerResolution.provider,
      target,
      queued: successCount,
      total: queueResults.length,
      requests: queueResults.map((r) => ({
        target: r.target,
        request_id: r.requestId,
        success: r.success,
      })),
    });

    return NextResponse.json({
      success: true,
      storyboard_id: storyboardId,
      target,
      provider: providerResolution.provider,
      queued: successCount,
      results: queueResults,
      grid_aspect_ratio: selectedGridAspectRatio,
      grid_resolution: selectedGridResolution,
    });
  } catch (error) {
    log.error('Regenerate ref grid error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
