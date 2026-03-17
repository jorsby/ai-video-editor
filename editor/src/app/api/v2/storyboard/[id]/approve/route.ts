import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { getSeriesStyleForProject } from '@/lib/prompts/style-injector';
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

const FAL_IMAGE_ENDPOINT = 'fal-ai/nano-banana-2';

function getWebhookBaseUrl() {
  return process.env.WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function appendPromptSuffix(prompt: string, suffix: string | null): string {
  if (!suffix) return prompt;
  return `${prompt.trim()} ${suffix}`.trim();
}

function appendStyleToScenePrompt(
  scenePrompt: string | string[],
  styleSuffix: string | null
): string | string[] {
  if (!styleSuffix) return scenePrompt;
  if (Array.isArray(scenePrompt)) {
    return scenePrompt.map((shotPrompt) =>
      appendPromptSuffix(shotPrompt, styleSuffix)
    );
  }
  return appendPromptSuffix(scenePrompt, styleSuffix);
}

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
  const requestId =
    typeof data?.request_id === 'string' ? data.request_id : null;

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
      isRecord(storyboard.plan) &&
      isRecord(storyboard.plan.v2_grid_jobs)
        ? storyboard.plan.v2_grid_jobs
        : null;

    if (existingGridJobs) {
      const existingObjectsJob =
        typeof existingGridJobs.objects === 'string'
          ? existingGridJobs.objects
          : null;
      const existingBackgroundsJob =
        typeof existingGridJobs.backgrounds === 'string'
          ? existingGridJobs.backgrounds
          : null;

      return NextResponse.json({
        status:
          existingObjectsJob || existingBackgroundsJob
            ? 'generating'
            : 'approved',
        grid_jobs: {
          objects: existingObjectsJob,
          backgrounds: existingBackgroundsJob,
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

    let seriesStyleSuffix: string | null = null;
    try {
      seriesStyleSuffix = await getSeriesStyleForProject(
        db,
        storyboard.project_id as string
      );
    } catch (styleError) {
      console.warn(
        '[v2/storyboard/approve] Failed to resolve series style (non-fatal):',
        styleError
      );
    }

    const styledObjectsGridPrompt = appendPromptSuffix(
      plan.objects_grid_prompt,
      seriesStyleSuffix
    );
    const styledBackgroundsGridPrompt = appendPromptSuffix(
      plan.backgrounds_grid_prompt,
      seriesStyleSuffix
    );
    const styledScenePrompts = plan.scene_prompts.map((scenePrompt) =>
      appendStyleToScenePrompt(scenePrompt, seriesStyleSuffix)
    );

    const sceneObjectMatches: Array<
      Array<{ url: string; variantId: string } | null>
    > = [];
    const sceneBackgroundMatches: Array<{
      url: string;
      variantId: string;
    } | null> = [];

    let missingObjectCount = 0;
    let missingBackgroundCount = 0;

    let seriesAssetMap: Awaited<
      ReturnType<typeof resolveSeriesAssetsForProject>
    > | null = null;

    try {
      seriesAssetMap = await resolveSeriesAssetsForProject(
        db,
        storyboard.project_id as string
      );
    } catch (seriesAssetError) {
      console.warn(
        '[v2/storyboard/approve] Series asset lookup failed (non-fatal):',
        seriesAssetError
      );
    }

    for (let sceneIdx = 0; sceneIdx < styledScenePrompts.length; sceneIdx++) {
      const objectIndices = plan.scene_object_indices[sceneIdx] ?? [];
      const objectMatches: Array<{ url: string; variantId: string } | null> =
        [];

      for (const gridPosition of objectIndices) {
        const objectName =
          plan.objects[gridPosition]?.name ?? `Object ${gridPosition + 1}`;

        const objectMatch = seriesAssetMap
          ? (matchSeriesAsset(seriesAssetMap, objectName, 'character') ??
            matchSeriesAsset(seriesAssetMap, objectName, 'prop'))
          : null;

        objectMatches.push(
          objectMatch
            ? { url: objectMatch.url, variantId: objectMatch.variantId }
            : null
        );

        if (!objectMatch) {
          missingObjectCount++;
        }
      }

      sceneObjectMatches.push(objectMatches);

      const bgIndex = plan.scene_bg_indices[sceneIdx];
      const bgName =
        plan.background_names[bgIndex] ?? `Background ${bgIndex + 1}`;

      const bgMatch = seriesAssetMap
        ? matchSeriesAsset(seriesAssetMap, bgName, 'location')
        : null;

      sceneBackgroundMatches.push(
        bgMatch ? { url: bgMatch.url, variantId: bgMatch.variantId } : null
      );

      if (!bgMatch) {
        missingBackgroundCount++;
      }
    }

    const needsObjectsGrid = missingObjectCount > 0;
    const needsBackgroundsGrid = missingBackgroundCount > 0;

    const { data: objectsGrid, error: objectsGridError } = await db
      .from('grid_images')
      .insert({
        storyboard_id: storyboardId,
        type: 'objects',
        prompt: styledObjectsGridPrompt,
        status: needsObjectsGrid ? 'pending' : 'success',
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
        prompt: styledBackgroundsGridPrompt,
        status: needsBackgroundsGrid ? 'pending' : 'success',
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

    const sceneIds: string[] = [];
    const sceneCount = styledScenePrompts.length;
    const languages = Object.keys(plan.voiceover_list);

    for (let i = 0; i < sceneCount; i++) {
      const scenePrompt = styledScenePrompts[i];

      const { data: scene, error: sceneError } = await db
        .from('scenes')
        .insert({
          storyboard_id: storyboardId,
          order: i,
          prompt: Array.isArray(scenePrompt) ? null : scenePrompt,
          multi_prompt: Array.isArray(scenePrompt) ? scenePrompt : null,
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
      const objectMatches = sceneObjectMatches[sceneIdx] ?? [];

      for (let position = 0; position < objectIndices.length; position++) {
        const gridPosition = objectIndices[position];
        const object = plan.objects[gridPosition];
        const matchedAsset = objectMatches[position];

        const { error: objectError } = await db.from('objects').insert({
          grid_image_id: objectsGrid.id,
          scene_id: sceneIds[sceneIdx],
          scene_order: position,
          grid_position: gridPosition,
          name: object?.name ?? `Object ${gridPosition + 1}`,
          description: object?.description ?? null,
          url: matchedAsset?.url ?? null,
          final_url: matchedAsset?.url ?? null,
          series_asset_variant_id: matchedAsset?.variantId ?? null,
          status: matchedAsset ? 'success' : 'processing',
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
      const matchedBg = sceneBackgroundMatches[sceneIdx];

      const { error: bgError } = await db.from('backgrounds').insert({
        grid_image_id: backgroundsGrid.id,
        scene_id: sceneIds[sceneIdx],
        grid_position: bgIndex,
        name: plan.background_names[bgIndex] ?? `Background ${bgIndex + 1}`,
        url: matchedBg?.url ?? null,
        final_url: matchedBg?.url ?? null,
        series_asset_variant_id: matchedBg?.variantId ?? null,
        status: matchedBg ? 'success' : 'processing',
      });

      if (bgError) {
        return NextResponse.json(
          { error: 'Failed to create background rows' },
          { status: 500 }
        );
      }
    }

    let objectsRequestId: string | null = null;
    let backgroundsRequestId: string | null = null;

    if (needsObjectsGrid || needsBackgroundsGrid) {
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

      const queueTasks: Array<Promise<void>> = [];

      if (needsObjectsGrid) {
        const objectsWebhook = `${webhookBase}/api/webhook/fal?step=GenGridImage&grid_image_id=${objectsGrid.id}&storyboard_id=${storyboardId}&rows=${plan.objects_rows}&cols=${plan.objects_cols}&width=${RESOLUTION_TO_SIZE[resolution].width}&height=${RESOLUTION_TO_SIZE[resolution].height}`;

        queueTasks.push(
          (async () => {
            objectsRequestId = await queueGridJob({
              prompt: styledObjectsGridPrompt,
              resolution,
              webhookUrl: objectsWebhook,
            });

            await db
              .from('grid_images')
              .update({ status: 'processing', request_id: objectsRequestId })
              .eq('id', objectsGrid.id);
          })()
        );
      }

      if (needsBackgroundsGrid) {
        const backgroundsWebhook = `${webhookBase}/api/webhook/fal?step=GenGridImage&grid_image_id=${backgroundsGrid.id}&storyboard_id=${storyboardId}&rows=${plan.bg_rows}&cols=${plan.bg_cols}&width=${RESOLUTION_TO_SIZE[resolution].width}&height=${RESOLUTION_TO_SIZE[resolution].height}`;

        queueTasks.push(
          (async () => {
            backgroundsRequestId = await queueGridJob({
              prompt: styledBackgroundsGridPrompt,
              resolution,
              webhookUrl: backgroundsWebhook,
            });

            await db
              .from('grid_images')
              .update({
                status: 'processing',
                request_id: backgroundsRequestId,
              })
              .eq('id', backgroundsGrid.id);
          })()
        );
      }

      await Promise.all(queueTasks);
    }

    const planWithJobMetadata = {
      ...(storyboard.plan as Record<string, unknown>),
      objects_grid_prompt: styledObjectsGridPrompt,
      backgrounds_grid_prompt: styledBackgroundsGridPrompt,
      scene_prompts: styledScenePrompts,
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

    const isGenerating = !!objectsRequestId || !!backgroundsRequestId;

    return NextResponse.json({
      status: isGenerating ? 'generating' : 'approved',
      grid_jobs: {
        objects: objectsRequestId,
        backgrounds: backgroundsRequestId,
      },
      reused_series_assets: {
        objects: !needsObjectsGrid,
        backgrounds: !needsBackgroundsGrid,
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
