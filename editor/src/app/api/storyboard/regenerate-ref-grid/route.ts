import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

const FAL_API_KEY = process.env.FAL_KEY!;
const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL!;

const ASPECT_RATIOS: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

type RegenerateTarget = 'objects' | 'backgrounds' | 'both';

type RefPlanShape = {
  objects_rows: number;
  objects_cols: number;
  objects_grid_prompt: string;
  bg_rows: number;
  bg_cols: number;
  backgrounds_grid_prompt: string;
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
  },
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
  } = params;

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

  const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/fal?${webhookParams.toString()}`;
  const falUrl = new URL(
    'https://queue.fal.run/workflows/octupost/generategridimage'
  );
  falUrl.searchParams.set('fal_webhook', webhookUrl);

  log.api('fal.ai', `octupost/generategridimage:${target}`, {
    grid_image_id: gridImageId,
    prompt_length: prompt.length,
  });

  const response = await fetch(falUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt }),
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
  const requestId = result.request_id as string | undefined;

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

    if (!storyboardId) {
      return NextResponse.json(
        { error: 'storyboardId is required' },
        { status: 400 }
      );
    }

    if (!isValidTarget(target)) {
      return NextResponse.json(
        { error: 'target must be objects, backgrounds, or both' },
        { status: 400 }
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

    if (storyboard.plan_status !== 'grid_ready') {
      return NextResponse.json(
        { error: 'Storyboard must be in grid_ready status to regenerate' },
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

    const updatedPlan: RefPlanShape = {
      ...existingPlan,
      objects_grid_prompt: newObjectsPrompt,
      backgrounds_grid_prompt: newBackgroundsPrompt,
    };

    await supabase
      .from('storyboards')
      .update({ plan: updatedPlan, plan_status: 'generating' })
      .eq('id', storyboardId)
      .eq('plan_status', 'grid_ready');

    const dims =
      ASPECT_RATIOS[storyboard.aspect_ratio] || ASPECT_RATIOS['9:16'];

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
            },
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
            },
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
      queued: successCount,
      results: queueResults,
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
