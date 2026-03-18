import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { klingO3PlanSchema } from '@/lib/schemas/kling-o3-plan';

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  scene_indices: z.array(z.number().int().min(0)).optional(),
  audio: z.boolean().optional(),
  confirm: z.boolean().optional(),
});

const KLING_O3_ENDPOINT = 'fal-ai/kling-video/o3/standard/reference-to-video';

const COST_PER_5S = {
  withAudio: 0.112,
  withoutAudio: 0.084,
};

function calculateSceneCost(
  durationSeconds: number,
  withAudio: boolean
): number {
  const rate = withAudio ? COST_PER_5S.withAudio : COST_PER_5S.withoutAudio;
  return (
    Math.round(((durationSeconds / 5) * rate + Number.EPSILON) * 1000) / 1000
  );
}

function buildMultiPromptPayload(
  prompts: string[],
  multiShots: Array<{ duration?: string }> | null,
  totalDuration: number
) {
  // If per-shot durations are stored, use them directly
  if (multiShots && multiShots.length === prompts.length) {
    return prompts.map((prompt, index) => ({
      prompt,
      duration: String(
        Math.max(3, Math.min(15, Number(multiShots[index]?.duration ?? '5')))
      ),
    }));
  }

  // Fallback: split total duration evenly
  const count = prompts.length;
  const base = Math.floor(totalDuration / count);
  const remainder = totalDuration - base * count;

  return prompts.map((prompt, index) => ({
    prompt,
    duration: String(
      Math.max(3, Math.min(15, base + (index < remainder ? 1 : 0)))
    ),
  }));
}

function getMultiShotTotalDuration(
  multiPromptPayload: Array<{ prompt: string; duration: string }>
): number {
  return multiPromptPayload.reduce(
    (sum, shot) => sum + Number(shot.duration),
    0
  );
}

function getWebhookBaseUrl() {
  return process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: storyboardId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: parsedBody.error.issues[0]?.message ?? 'Invalid request body',
        },
        { status: 400 }
      );
    }

    const sceneIndicesFilter = parsedBody.data.scene_indices;
    const withAudio = parsedBody.data.audio ?? true;
    const confirm = parsedBody.data.confirm ?? false;

    const db = createServiceClient('studio');

    const { data: storyboard, error: storyboardError } = await db
      .from('storyboards')
      .select('id, project_id, plan, plan_status, aspect_ratio')
      .eq('id', storyboardId)
      .single();

    if (storyboardError || !storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    const { data: project, error: projectError } = await db
      .from('projects')
      .select('id')
      .eq('id', storyboard.project_id)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const parsedPlan = klingO3PlanSchema.safeParse(storyboard.plan);
    if (!parsedPlan.success) {
      return NextResponse.json(
        { error: 'Storyboard plan is invalid or missing' },
        { status: 400 }
      );
    }

    const plan = parsedPlan.data;

    const { data: scenes, error: scenesError } = await db
      .from('scenes')
      .select(
        `
        id,
        order,
        prompt,
        multi_prompt,
        multi_shots,
        video_status,
        objects (scene_order, final_url, url, status),
        backgrounds (final_url, url, status)
      `
      )
      .eq('storyboard_id', storyboardId)
      .order('order', { ascending: true });

    // multi_shots comes as jsonb — type it properly
    type SceneRow = NonNullable<typeof scenes>[number] & {
      multi_shots: Array<{ duration?: string }> | null;
    };

    if (scenesError) {
      return NextResponse.json(
        { error: 'Failed to load scenes' },
        { status: 500 }
      );
    }

    const indexFilterSet = sceneIndicesFilter
      ? new Set(sceneIndicesFilter)
      : null;

    const candidates = (scenes ?? []).filter(
      (scene: {
        order: number;
        video_status: string | null;
        objects: Array<{
          scene_order: number;
          final_url: string | null;
          url: string | null;
          status: string | null;
        }>;
        backgrounds: Array<{
          final_url: string | null;
          url: string | null;
          status: string | null;
        }>;
      }) => {
        if (indexFilterSet && !indexFilterSet.has(scene.order)) {
          return false;
        }

        const objectsReady =
          scene.objects.length > 0 &&
          scene.objects.every(
            (object) =>
              object.status === 'success' &&
              Boolean(object.final_url ?? object.url)
          );

        const backgroundsReady =
          scene.backgrounds.length > 0 &&
          scene.backgrounds.every(
            (background) =>
              background.status === 'success' &&
              Boolean(background.final_url ?? background.url)
          );

        return objectsReady && backgroundsReady;
      }
    );

    const jobs: Array<{
      scene_index: number;
      estimated_cost_usd: number;
      fal_request_id?: string;
    }> = [];

    for (const scene of candidates as Array<{
      id: string;
      order: number;
      prompt: string | null;
      multi_prompt: string[] | null;
      multi_shots: Array<{ duration?: string }> | null;
      video_status: string | null;
      objects: Array<{
        scene_order: number;
        final_url: string | null;
        url: string | null;
      }>;
      backgrounds: Array<{
        final_url: string | null;
        url: string | null;
      }>;
    }>) {
      const planDuration = plan.scene_durations?.[scene.order] ?? 5;

      // For multi-shot, calculate actual total from per-shot durations
      let actualDuration = planDuration;
      let multiPromptPayload: Array<{
        prompt: string;
        duration: string;
      }> | null = null;
      if (scene.multi_prompt && scene.multi_prompt.length > 1) {
        multiPromptPayload = buildMultiPromptPayload(
          scene.multi_prompt,
          scene.multi_shots,
          planDuration
        );
        actualDuration = getMultiShotTotalDuration(multiPromptPayload);
      }

      const estimatedCost = calculateSceneCost(actualDuration, withAudio);

      if (!confirm) {
        jobs.push({
          scene_index: scene.order,
          estimated_cost_usd: estimatedCost,
        });
        continue;
      }

      if (
        scene.video_status === 'processing' ||
        scene.video_status === 'success'
      ) {
        jobs.push({
          scene_index: scene.order,
          estimated_cost_usd: estimatedCost,
        });
        continue;
      }

      const backgroundUrl =
        scene.backgrounds[0]?.final_url ?? scene.backgrounds[0]?.url;
      if (!backgroundUrl) {
        jobs.push({
          scene_index: scene.order,
          estimated_cost_usd: estimatedCost,
        });
        continue;
      }

      const objectUrls = [...scene.objects]
        .sort((a, b) => a.scene_order - b.scene_order)
        .map((object) => object.final_url ?? object.url)
        .filter((url): url is string => Boolean(url));

      const payload: Record<string, unknown> = {
        elements: objectUrls.map((url) => ({
          frontal_image_url: url,
          reference_image_urls: [url],
        })),
        image_urls: [backgroundUrl],
        aspect_ratio: storyboard.aspect_ratio ?? '9:16',
        generate_audio: withAudio,
      };

      if (multiPromptPayload) {
        payload.multi_prompt = multiPromptPayload;
        payload.shot_type = 'customize';
      } else {
        payload.prompt =
          scene.multi_prompt?.[0] ?? scene.prompt ?? `Scene ${scene.order + 1}`;
        payload.duration = String(planDuration);
      }

      await db
        .from('scenes')
        .update({
          video_status: 'processing',
          video_model: 'klingo3',
          video_resolution: '720p',
        })
        .eq('id', scene.id);

      const webhookBase = getWebhookBaseUrl();
      if (!webhookBase) {
        return NextResponse.json(
          { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
          { status: 500 }
        );
      }

      const falUrl = new URL(`https://queue.fal.run/${KLING_O3_ENDPOINT}`);
      falUrl.searchParams.set(
        'fal_webhook',
        `${webhookBase}/api/webhook/fal?step=GenerateVideo&scene_id=${scene.id}`
      );

      const falRes = await fetch(falUrl.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Key ${process.env.FAL_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!falRes.ok) {
        await db
          .from('scenes')
          .update({
            video_status: 'failed',
            video_error_message: 'request_error',
          })
          .eq('id', scene.id);

        return NextResponse.json(
          { error: `Failed to queue scene ${scene.order}` },
          { status: 500 }
        );
      }

      const falData = await falRes.json();
      const requestId = falData.request_id as string | undefined;

      if (!requestId) {
        await db
          .from('scenes')
          .update({
            video_status: 'failed',
            video_error_message: 'missing_request_id',
          })
          .eq('id', scene.id);

        return NextResponse.json(
          {
            error: `fal.ai response missing request_id for scene ${scene.order}`,
          },
          { status: 500 }
        );
      }

      await db
        .from('scenes')
        .update({ video_request_id: requestId })
        .eq('id', scene.id);

      jobs.push({
        scene_index: scene.order,
        estimated_cost_usd: estimatedCost,
        fal_request_id: requestId,
      });
    }

    const totalEstimatedCost =
      Math.round(
        jobs.reduce((sum, job) => sum + job.estimated_cost_usd, 0) * 1000
      ) / 1000;

    return NextResponse.json({
      jobs,
      total_estimated_cost_usd: totalEstimatedCost,
    });
  } catch (error) {
    console.error('[v2/storyboard/generate-video] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
