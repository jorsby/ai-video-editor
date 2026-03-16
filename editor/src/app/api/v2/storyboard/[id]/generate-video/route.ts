/**
 * POST /api/v2/storyboard/{id}/generate-video
 *
 * Queues video generation for scenes in a storyboard using Kling O3.
 * Only generates for scenes where objects + backgrounds are "ready".
 *
 * Body: {
 *   scene_indices?: number[],  // which scenes (0-based order). Omit → all ready scenes
 *   audio?: boolean            // Kling native audio. default false
 * }
 *
 * Response: {
 *   jobs: [{ scene_index, scene_id, fal_request_id, estimated_cost_usd }]
 * }
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';

type RouteContext = { params: Promise<{ id: string }> };

// Kling O3 standard reference-to-video
const KLING_O3_ENDPOINT = 'fal-ai/kling-video/o3/standard/reference-to-video';

// Cost estimates (USD) based on Kling O3 pricing
const KLING_COST_PER_SECOND = 0.045; // ~$0.045/s for standard O3

const WEBHOOK_BASE_URL =
  process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL!;

function estimateCost(durationSeconds: number): number {
  return Math.round(durationSeconds * KLING_COST_PER_SECOND * 100) / 100;
}

function bucketDuration(raw: number): number {
  return Math.max(3, Math.min(15, raw));
}

export async function POST(req: NextRequest, context: RouteContext) {
  const log = createLogger();
  log.setContext({ step: 'V2GenerateVideo' });

  try {
    const { id: storyboardId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const sceneIndicesFilter: number[] | undefined = Array.isArray(
      body?.scene_indices
    )
      ? (body.scene_indices as unknown[]).filter(
          (v): v is number => typeof v === 'number'
        )
      : undefined;

    const enableAudio = typeof body?.audio === 'boolean' ? body.audio : false;

    const db = createServiceClient('studio');

    // Fetch storyboard + verify ownership via project
    const { data: storyboard, error: sbError } = await db
      .from('storyboards')
      .select('id, project_id, plan_status, mode, model, aspect_ratio')
      .eq('id', storyboardId)
      .single();

    if (sbError || !storyboard) {
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

    if (storyboard.plan_status !== 'approved') {
      return NextResponse.json(
        {
          error: `Storyboard must be approved before generating video (current status: ${storyboard.plan_status})`,
        },
        { status: 400 }
      );
    }

    // Fetch scenes with their assets
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
        voiceovers (id, status, duration, language),
        objects (id, final_url, scene_order, status),
        backgrounds (id, final_url, status)
      `
      )
      .eq('storyboard_id', storyboardId)
      .order('order', { ascending: true });

    if (scenesError || !scenes) {
      console.error('[v2/generate-video] Failed to load scenes:', scenesError);
      return NextResponse.json(
        { error: 'Failed to load scenes' },
        { status: 500 }
      );
    }

    const aspectRatio = (storyboard.aspect_ratio as string | null) ?? '9:16';

    const jobs: Array<{
      scene_index: number;
      scene_id: string;
      fal_request_id: string;
      estimated_cost_usd: number;
    }> = [];

    const skipped: Array<{
      scene_index: number;
      reason: string;
    }> = [];

    for (const scene of scenes as Array<{
      id: string;
      order: number;
      prompt: string | null;
      multi_prompt: string[] | null;
      multi_shots: boolean | null;
      video_status: string | null;
      voiceovers: Array<{
        id: string;
        status: string;
        duration: number | null;
        language: string;
      }>;
      objects: Array<{
        id: string;
        final_url: string | null;
        scene_order: number;
        status: string;
      }>;
      backgrounds: Array<{
        id: string;
        final_url: string | null;
        status: string;
      }>;
    }>) {
      const sceneIndex = scene.order;

      // Filter by requested scene_indices if provided
      if (
        sceneIndicesFilter !== undefined &&
        !sceneIndicesFilter.includes(sceneIndex)
      ) {
        continue;
      }

      // Skip if video already processing or done
      if (
        scene.video_status === 'processing' ||
        scene.video_status === 'success'
      ) {
        skipped.push({
          scene_index: sceneIndex,
          reason: `video_status is ${scene.video_status}`,
        });
        continue;
      }

      // Check assets are ready
      const objectsReady = scene.objects.every(
        (o) => o.status === 'success' && o.final_url
      );
      const bgReady = scene.backgrounds.every(
        (b) => b.status === 'success' && b.final_url
      );

      if (!objectsReady || !bgReady) {
        skipped.push({
          scene_index: sceneIndex,
          reason: `assets not ready (objects: ${objectsReady}, backgrounds: ${bgReady})`,
        });
        continue;
      }

      const background = scene.backgrounds[0];
      if (!background?.final_url) {
        skipped.push({ scene_index: sceneIndex, reason: 'no background url' });
        continue;
      }

      // Determine duration from voiceovers
      const maxDuration = Math.max(
        0,
        ...(scene.voiceovers ?? []).map((v) => v.duration ?? 0)
      );
      const rawDuration = maxDuration > 0 ? Math.ceil(maxDuration) : 5;
      const duration = bucketDuration(rawDuration);

      // Build Kling elements from objects (sorted by scene_order)
      const sortedObjects = [...scene.objects].sort(
        (a, b) => a.scene_order - b.scene_order
      );
      const elements = sortedObjects
        .filter((o) => o.final_url)
        .map((o) => ({
          frontal_image_url: o.final_url!,
          reference_image_urls: [o.final_url!],
        }));

      // Resolve prompt
      const prompt =
        scene.multi_prompt && scene.multi_prompt.length > 0
          ? scene.multi_prompt[0]
          : (scene.prompt ?? '');

      const payload: Record<string, unknown> = {
        elements,
        image_urls: [background.final_url],
        aspect_ratio: aspectRatio,
        generate_audio: enableAudio,
      };

      if (scene.multi_prompt && scene.multi_prompt.length > 1) {
        const count = scene.multi_prompt.length;
        const base = Math.floor(duration / count);
        payload.multi_prompt = scene.multi_prompt.map((p, i) => ({
          prompt: p,
          duration: String(
            Math.max(3, base + (i < duration - base * count ? 1 : 0))
          ),
        }));
      } else {
        payload.prompt = prompt;
        payload.duration = String(duration);
      }

      // Mark as processing (atomic set)
      await db
        .from('scenes')
        .update({
          video_status: 'processing',
          video_resolution: '720p',
          video_model: 'klingo3',
        })
        .eq('id', scene.id);

      // Queue fal.ai job
      const webhookParams = new URLSearchParams({
        step: 'GenerateVideo',
        scene_id: scene.id,
      });
      const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhook/fal?${webhookParams.toString()}`;

      const falUrl = new URL(`https://queue.fal.run/${KLING_O3_ENDPOINT}`);
      falUrl.searchParams.set('fal_webhook', webhookUrl);

      try {
        const falRes = await fetch(falUrl.toString(), {
          method: 'POST',
          headers: {
            Authorization: `Key ${process.env.FAL_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!falRes.ok) {
          const errText = await falRes.text();
          console.error(
            `[v2/generate-video] fal.ai error for scene ${sceneIndex}:`,
            errText
          );
          await db
            .from('scenes')
            .update({
              video_status: 'failed',
              video_error_message: 'request_error',
            })
            .eq('id', scene.id);

          skipped.push({
            scene_index: sceneIndex,
            reason: `fal.ai request failed: ${falRes.status}`,
          });
          continue;
        }

        const falData = await falRes.json();
        const requestId = falData.request_id as string;

        await db
          .from('scenes')
          .update({ video_request_id: requestId })
          .eq('id', scene.id);

        jobs.push({
          scene_index: sceneIndex,
          scene_id: scene.id,
          fal_request_id: requestId,
          estimated_cost_usd: estimateCost(duration),
        });

        log.info('Video queued', {
          scene_id: scene.id,
          scene_index: sceneIndex,
          request_id: requestId,
          duration,
        });
      } catch (err) {
        console.error(
          `[v2/generate-video] Exception for scene ${sceneIndex}:`,
          err
        );
        await db
          .from('scenes')
          .update({
            video_status: 'failed',
            video_error_message: 'request_exception',
          })
          .eq('id', scene.id);

        skipped.push({
          scene_index: sceneIndex,
          reason: err instanceof Error ? err.message : 'Request exception',
        });
      }

      // Small delay between requests to avoid rate-limiting
      if (jobs.length > 0 && scenes.indexOf(scene) < scenes.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return NextResponse.json({
      jobs,
      ...(skipped.length > 0 ? { skipped } : {}),
      summary: {
        queued: jobs.length,
        skipped: skipped.length,
        total_estimated_cost_usd:
          Math.round(
            jobs.reduce((sum, j) => sum + j.estimated_cost_usd, 0) * 100
          ) / 100,
      },
    });
  } catch (error) {
    console.error('[v2/generate-video] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
