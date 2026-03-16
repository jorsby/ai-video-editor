import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { klingO3PlanSchema } from '@/lib/schemas/kling-o3-plan';
import { createServiceClient } from '@/lib/supabase/admin';
import {
  matchSeriesAsset,
  resolveSeriesAssetsForProject,
} from '@/lib/supabase/series-asset-resolver';

type RouteContext = { params: Promise<{ id: string }> };

type Resolution = '0.5k' | '1k' | '2k';

const bodySchema = z.object({
  resolution: z.enum(['0.5k', '1k', '2k']).optional(),
});

const RESOLUTION_TO_SIZE: Record<
  Resolution,
  { width: number; height: number }
> = {
  '0.5k': { width: 512, height: 512 },
  '1k': { width: 1024, height: 1024 },
  '2k': { width: 2048, height: 2048 },
};

const NEGATIVE_PROMPT = 'text, words, labels, watermark, blurry, low quality';

function getWebhookBaseUrl() {
  return process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
}

const FAL_IMAGE_ENDPOINT = 'fal-ai/nano-banana-2';

async function queueGridJob(params: {
  prompt: string;
  resolution: Resolution;
  webhookUrl: string;
}) {
  const size = RESOLUTION_TO_SIZE[params.resolution];
  const falUrl = new URL(`https://queue.fal.run/${FAL_IMAGE_ENDPOINT}`);
  falUrl.searchParams.set('fal_webhook', params.webhookUrl);

  const res = await fetch(falUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: params.prompt,
      negative_prompt: NEGATIVE_PROMPT,
      num_images: 1,
      image_size: { width: size.width, height: size.height },
      enable_safety_checker: false,
      output_format: 'jpeg',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal.ai queue failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const requestId = typeof data?.request_id === 'string' ? data.request_id : null;

  if (!requestId) {
    throw new Error('fal.ai response missing request_id');
  }

  return requestId;
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

    const resolution = parsedBody.data.resolution ?? '1k';

    const db = createServiceClient('studio');

    const { data: storyboard, error: storyboardError } = await db
      .from('storyboards')
      .select('id, project_id, plan, plan_status')
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

    const existingGridJobs =
      storyboard.plan_status === 'approved' &&
      storyboard.plan &&
      typeof storyboard.plan === 'object' &&
      !Array.isArray(storyboard.plan)
        ? (storyboard.plan as Record<string, unknown>).v2_grid_jobs
        : null;

    if (
      existingGridJobs &&
      typeof existingGridJobs === 'object' &&
      !Array.isArray(existingGridJobs) &&
      typeof (existingGridJobs as Record<string, unknown>).objects ===
        'string' &&
      typeof (existingGridJobs as Record<string, unknown>).backgrounds ===
        'string'
    ) {
      return NextResponse.json({
        status: 'generating',
        grid_jobs: {
          objects: (existingGridJobs as Record<string, string>).objects,
          backgrounds: (existingGridJobs as Record<string, string>).backgrounds,
        },
      });
    }

    const { data: existingScene } = await db
      .from('scenes')
      .select('id')
      .eq('storyboard_id', storyboardId)
      .limit(1)
      .maybeSingle();

    if (existingScene) {
      return NextResponse.json(
        { error: 'Storyboard already has scenes. Cannot approve twice.' },
        { status: 409 }
      );
    }

    const { data: objectsGrid, error: objectsGridError } = await db
      .from('grid_images')
      .insert({
        storyboard_id: storyboardId,
        type: 'objects',
        prompt: plan.objects_grid_prompt,
        status: 'pending',
        detected_rows: plan.objects_rows,
        detected_cols: plan.objects_cols,
        dimension_detection_status: 'success',
      })
      .select('id')
      .single();

    if (objectsGridError || !objectsGrid) {
      return NextResponse.json(
        { error: 'Failed to create objects grid record' },
        { status: 500 }
      );
    }

    const { data: backgroundsGrid, error: backgroundsGridError } = await db
      .from('grid_images')
      .insert({
        storyboard_id: storyboardId,
        type: 'backgrounds',
        prompt: plan.backgrounds_grid_prompt,
        status: 'pending',
        detected_rows: plan.bg_rows,
        detected_cols: plan.bg_cols,
        dimension_detection_status: 'success',
      })
      .select('id')
      .single();

    if (backgroundsGridError || !backgroundsGrid) {
      return NextResponse.json(
        { error: 'Failed to create backgrounds grid record' },
        { status: 500 }
      );
    }

    const webhookBase = getWebhookBaseUrl();
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    if (!process.env.FAL_KEY) {
      return NextResponse.json({ error: 'Missing FAL_KEY' }, { status: 500 });
    }

    fal.config({ credentials: process.env.FAL_KEY });

    const objectsWebhook = `${webhookBase}/api/webhook/fal?step=GenGridImage&grid_image_id=${objectsGrid.id}&storyboard_id=${storyboardId}&rows=${plan.objects_rows}&cols=${plan.objects_cols}&width=${RESOLUTION_TO_SIZE[resolution].width}&height=${RESOLUTION_TO_SIZE[resolution].height}`;
    const backgroundsWebhook = `${webhookBase}/api/webhook/fal?step=GenGridImage&grid_image_id=${backgroundsGrid.id}&storyboard_id=${storyboardId}&rows=${plan.bg_rows}&cols=${plan.bg_cols}&width=${RESOLUTION_TO_SIZE[resolution].width}&height=${RESOLUTION_TO_SIZE[resolution].height}`;

    const [objectsRequestId, backgroundsRequestId] = await Promise.all([
      queueGridJob({
        prompt: plan.objects_grid_prompt,
        resolution,
        webhookUrl: objectsWebhook,
      }),
      queueGridJob({
        prompt: plan.backgrounds_grid_prompt,
        resolution,
        webhookUrl: backgroundsWebhook,
      }),
    ]);

    await Promise.all([
      db
        .from('grid_images')
        .update({ status: 'processing', request_id: objectsRequestId })
        .eq('id', objectsGrid.id),
      db
        .from('grid_images')
        .update({ status: 'processing', request_id: backgroundsRequestId })
        .eq('id', backgroundsGrid.id),
    ]);

    const sceneIds: string[] = [];
    const sceneCount = plan.scene_prompts.length;
    const languages = Object.keys(plan.voiceover_list);

    for (let i = 0; i < sceneCount; i++) {
      const { data: scene, error: sceneError } = await db
        .from('scenes')
        .insert({
          storyboard_id: storyboardId,
          order: i,
          prompt: Array.isArray(plan.scene_prompts[i])
            ? null
            : (plan.scene_prompts[i] as string),
          multi_prompt: Array.isArray(plan.scene_prompts[i])
            ? (plan.scene_prompts[i] as string[])
            : null,
        })
        .select('id')
        .single();

      if (sceneError || !scene) {
        return NextResponse.json(
          { error: 'Failed to create scene rows' },
          { status: 500 }
        );
      }

      sceneIds.push(scene.id as string);

      for (const lang of languages) {
        const { error: voiceoverError } = await db.from('voiceovers').insert({
          scene_id: scene.id,
          text: plan.voiceover_list[lang]?.[i] ?? '',
          language: lang,
          status: 'success',
        });

        if (voiceoverError) {
          return NextResponse.json(
            { error: 'Failed to create voiceover rows' },
            { status: 500 }
          );
        }
      }
    }

    for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
      const objectIndices = plan.scene_object_indices[sceneIdx] ?? [];
      for (let position = 0; position < objectIndices.length; position++) {
        const gridPosition = objectIndices[position];
        const object = plan.objects[gridPosition];

        const { error: objectError } = await db.from('objects').insert({
          grid_image_id: objectsGrid.id,
          scene_id: sceneIds[sceneIdx],
          scene_order: position,
          grid_position: gridPosition,
          name: object?.name ?? `Object ${gridPosition + 1}`,
          description: object?.description ?? null,
          status: 'processing',
        });

        if (objectError) {
          return NextResponse.json(
            { error: 'Failed to create object rows' },
            { status: 500 }
          );
        }
      }
    }

    for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
      const bgIndex = plan.scene_bg_indices[sceneIdx];
      const { error: bgError } = await db.from('backgrounds').insert({
        grid_image_id: backgroundsGrid.id,
        scene_id: sceneIds[sceneIdx],
        grid_position: bgIndex,
        name: plan.background_names[bgIndex] ?? `Background ${bgIndex + 1}`,
        status: 'processing',
      });

      if (bgError) {
        return NextResponse.json(
          { error: 'Failed to create background rows' },
          { status: 500 }
        );
      }
    }

    try {
      const seriesAssetMap = await resolveSeriesAssetsForProject(
        db,
        storyboard.project_id as string
      );

      if (seriesAssetMap) {
        for (let sceneIdx = 0; sceneIdx < sceneIds.length; sceneIdx++) {
          const objectIndices = plan.scene_object_indices[sceneIdx] ?? [];

          for (const gridPosition of objectIndices) {
            const objectName =
              plan.objects[gridPosition]?.name ?? `Object ${gridPosition + 1}`;
            const objectMatch =
              matchSeriesAsset(seriesAssetMap, objectName, 'character') ??
              matchSeriesAsset(seriesAssetMap, objectName, 'prop');

            if (!objectMatch) continue;

            await db
              .from('objects')
              .update({
                url: objectMatch.url,
                final_url: objectMatch.url,
                status: 'success',
              })
              .eq('grid_image_id', objectsGrid.id)
              .eq('scene_id', sceneIds[sceneIdx])
              .eq('grid_position', gridPosition);
          }

          const bgIndex = plan.scene_bg_indices[sceneIdx];
          const bgName =
            plan.background_names[bgIndex] ?? `Background ${bgIndex + 1}`;
          const bgMatch = matchSeriesAsset(seriesAssetMap, bgName, 'location');

          if (!bgMatch) continue;

          await db
            .from('backgrounds')
            .update({
              url: bgMatch.url,
              final_url: bgMatch.url,
              status: 'success',
            })
            .eq('grid_image_id', backgroundsGrid.id)
            .eq('scene_id', sceneIds[sceneIdx])
            .eq('grid_position', bgIndex);
        }
      }
    } catch (seriesAssetError) {
      console.warn(
        '[v2/storyboard/approve] Series asset injection failed (non-fatal):',
        seriesAssetError
      );
    }

    const planWithJobMetadata = {
      ...(storyboard.plan as Record<string, unknown>),
      v2_grid_jobs: {
        objects: objectsRequestId,
        backgrounds: backgroundsRequestId,
        resolution,
      },
    };

    const { error: updateStoryboardError } = await db
      .from('storyboards')
      .update({
        plan_status: 'approved',
        plan: planWithJobMetadata,
      })
      .eq('id', storyboardId);

    if (updateStoryboardError) {
      return NextResponse.json(
        { error: 'Failed to update storyboard status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: 'generating',
      grid_jobs: {
        objects: objectsRequestId,
        backgrounds: backgroundsRequestId,
      },
    });
  } catch (error) {
    console.error('[v2/storyboard/approve] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
