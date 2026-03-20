import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

type Resolution = '0.5K' | '1K' | '2K' | '4K';

type AspectRatio =
  | 'auto'
  | '21:9'
  | '16:9'
  | '3:2'
  | '4:3'
  | '5:4'
  | '1:1'
  | '4:5'
  | '3:4'
  | '2:3'
  | '9:16'
  | '4:1'
  | '1:4'
  | '8:1'
  | '1:8';

const RESOLUTIONS = ['0.5K', '1K', '2K', '4K'] as const;
const ASPECT_RATIOS = [
  'auto',
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '5:4',
  '1:1',
  '4:5',
  '3:4',
  '2:3',
  '9:16',
  '4:1',
  '1:4',
  '8:1',
  '1:8',
] as const;

const bodySchema = z.object({
  asset_ids: z.array(z.string().min(1)).optional(),
  resolution: z
    .string()
    .optional()
    .transform((value) => value?.toUpperCase())
    .refine((value) => !value || RESOLUTIONS.includes(value as Resolution), {
      message: `resolution must be one of: ${RESOLUTIONS.join(', ')}`,
    }),
  aspect_ratio: z
    .string()
    .optional()
    .refine((value) => !value || ASPECT_RATIOS.includes(value as AspectRatio), {
      message: `aspect_ratio must be one of: ${ASPECT_RATIOS.join(', ')}`,
    }),
  output_format: z.enum(['jpeg', 'png', 'webp']).optional(),
  safety_tolerance: z.enum(['1', '2', '3', '4', '5', '6']).optional(),
  enable_web_search: z.boolean().optional(),
  thinking_level: z.enum(['minimal', 'high']).optional(),
  limit_generations: z.boolean().optional(),
});

const PREFIX_BY_ASSET_TYPE: Record<string, string> = {
  character:
    'Front-facing full-body character, isolated cutout on transparent background (alpha), no text, clean edges. ',
  location:
    'Empty environment, no people, neutral baseline lighting, reusable location plate, avoid explicit time-of-day styling. ',
  prop: 'Single isolated prop cutout on transparent background (alpha), no text, clean edges, no background scene. ',
};

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: seriesId } = await context.params;

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

    const requestedAssetIds = parsedBody.data.asset_ids;
    const resolution =
      (parsedBody.data.resolution as Resolution | undefined) ?? '1K';
    const aspectRatio =
      (parsedBody.data.aspect_ratio as AspectRatio | undefined) ?? '1:1';
    const outputFormat = parsedBody.data.output_format ?? 'png';
    const safetyTolerance = parsedBody.data.safety_tolerance ?? '4';
    const limitGenerations = parsedBody.data.limit_generations ?? true;

    const db = createServiceClient('studio');

    const { data: series, error: seriesError } = await db
      .from('series')
      .select('id')
      .eq('id', seriesId)
      .eq('user_id', user.id)
      .single();

    if (seriesError || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    let assetsQuery = db
      .from('series_assets')
      .select(
        'id, name, type, description, series_asset_variants(id, is_default, description, series_asset_variant_images(id))'
      )
      .eq('series_id', seriesId)
      .order('sort_order', { ascending: true });

    if (requestedAssetIds && requestedAssetIds.length > 0) {
      assetsQuery = assetsQuery.in('id', requestedAssetIds);
    }

    const { data: assets, error: assetsError } = await assetsQuery;

    if (assetsError) {
      return NextResponse.json(
        { error: 'Failed to load series assets' },
        { status: 500 }
      );
    }

    if (!assets || assets.length === 0) {
      return NextResponse.json({ jobs: [] });
    }

    const assetsWithoutImages = (
      assets as Array<{
        id: string;
        name: string;
        type: string;
        description: string | null;
        series_asset_variants: Array<{
          id: string;
          is_default: boolean;
          description: string | null;
          series_asset_variant_images: Array<{ id: string }>;
        }>;
      }>
    ).filter((asset) => {
      const hasAnyImage = (asset.series_asset_variants ?? []).some(
        (variant) => (variant.series_asset_variant_images ?? []).length > 0
      );
      return !hasAnyImage;
    });

    if (assetsWithoutImages.length === 0) {
      return NextResponse.json({ jobs: [] });
    }

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    if (!process.env.FAL_KEY) {
      return NextResponse.json({ error: 'Missing FAL_KEY' }, { status: 500 });
    }

    const jobs: Array<{
      asset_id: string;
      asset_name: string;
      type: string;
      fal_request_id: string;
      status: 'queued';
    }> = [];

    for (const asset of assetsWithoutImages) {
      let variantId =
        asset.series_asset_variants?.find((variant) => variant.is_default)
          ?.id ??
        asset.series_asset_variants?.[0]?.id ??
        null;

      if (!variantId) {
        const { data: variant, error: variantError } = await db
          .from('series_asset_variants')
          .insert({
            asset_id: asset.id,
            label: 'Default',
            is_default: true,
          })
          .select('id')
          .single();

        if (variantError || !variant) {
          return NextResponse.json(
            { error: `Failed to create default variant for asset ${asset.id}` },
            { status: 500 }
          );
        }

        variantId = variant.id as string;
      }

      const prefix =
        PREFIX_BY_ASSET_TYPE[asset.type] ?? PREFIX_BY_ASSET_TYPE.prop;
      const basePrompt =
        typeof asset.description === 'string' &&
        asset.description.trim().length > 0
          ? asset.description.trim()
          : asset.name;
      const prompt = `${prefix}${basePrompt}`;

      const webhookUrl = `${webhookBase}/api/webhook/fal?step=SeriesAssetImage&variant_id=${variantId}`;

      const falUrl = new URL('https://queue.fal.run/fal-ai/nano-banana-2');
      falUrl.searchParams.set('fal_webhook', webhookUrl);

      const falPayload: Record<string, unknown> = {
        prompt,
        num_images: 1,
        resolution,
        aspect_ratio: aspectRatio,
        output_format: outputFormat,
        safety_tolerance: safetyTolerance,
        limit_generations: limitGenerations,
      };

      if (parsedBody.data.enable_web_search !== undefined) {
        falPayload.enable_web_search = parsedBody.data.enable_web_search;
      }

      if (parsedBody.data.thinking_level) {
        falPayload.thinking_level = parsedBody.data.thinking_level;
      }

      const falRes = await fetch(falUrl.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Key ${process.env.FAL_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(falPayload),
      });

      if (!falRes.ok) {
        const errText = await falRes.text();
        return NextResponse.json(
          { error: `fal.ai request failed for asset ${asset.id}: ${errText}` },
          { status: 500 }
        );
      }

      const result = await falRes.json();
      const requestId =
        typeof result?.request_id === 'string' ? result.request_id : null;

      if (!requestId) {
        return NextResponse.json(
          { error: `fal.ai response missing request_id for asset ${asset.id}` },
          { status: 500 }
        );
      }

      const { error: jobInsertError } = await db
        .from('series_generation_jobs')
        .insert({
          series_id: seriesId,
          request_id: requestId,
          type: 'asset_image',
          prompt,
          model: 'fal-ai/nano-banana-2',
          config: {
            asset_id: asset.id,
            variant_id: variantId,
            asset_type: asset.type,
            resolution,
            aspect_ratio: aspectRatio,
            output_format: outputFormat,
            safety_tolerance: safetyTolerance,
            limit_generations: limitGenerations,
            enable_web_search: parsedBody.data.enable_web_search ?? null,
            thinking_level: parsedBody.data.thinking_level ?? null,
          },
        });

      if (jobInsertError) {
        return NextResponse.json(
          { error: `Failed to persist generation job for asset ${asset.id}` },
          { status: 500 }
        );
      }

      jobs.push({
        asset_id: asset.id,
        asset_name: asset.name,
        type: asset.type,
        fal_request_id: requestId,
        status: 'queued',
      });
    }

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('[v2/series/generate-assets] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
