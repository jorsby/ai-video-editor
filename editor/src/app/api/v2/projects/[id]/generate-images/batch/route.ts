import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { queueImageTask } from '@/lib/image-provider';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/projects/{id}/generate-images/batch
 *
 * Queue image generation for multiple variants in a single call.
 * Uses Flux 2 Pro via kie.ai — 2K resolution, project aspect ratio.
 *
 * Body:
 * {
 *   "variant_ids": ["uuid1", "uuid2", ...],   // required, max 100
 *   "prompt_overrides": {                       // optional, per-variant prompt override
 *     "uuid1": "custom prompt for this variant"
 *   }
 * }
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id: projectId } = await ctx.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');

    // Verify project ownership
    const { data: project } = await db
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .maybeSingle();

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const variantIds: string[] = Array.isArray(body?.variant_ids)
      ? body.variant_ids.filter(
          (id: unknown) => typeof id === 'string' && id.trim()
        )
      : [];

    if (variantIds.length === 0) {
      return NextResponse.json(
        { error: 'variant_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    if (variantIds.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 variants per batch' },
        { status: 400 }
      );
    }

    const promptOverrides: Record<string, string> =
      typeof body?.prompt_overrides === 'object' && body.prompt_overrides
        ? body.prompt_overrides
        : {};

    // Load video settings (aspect ratio)
    const { data: video } = await db
      .from('videos')
      .select('id, genre, tone, aspect_ratio')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!video) {
      return NextResponse.json(
        { error: 'No video found for this project' },
        { status: 404 }
      );
    }

    // Load all requested variants with their asset info
    const { data: variants, error: variantsError } = await db
      .from('project_asset_variants')
      .select(
        'id, asset_id, slug, prompt, image_gen_status, asset:project_assets!inner(id, project_id, name, type, description)'
      )
      .in('id', variantIds)
      .eq('project_assets.project_id', projectId);

    if (variantsError) {
      return NextResponse.json(
        { error: 'Failed to load variants' },
        { status: 500 }
      );
    }

    const variantMap = new Map(
      (variants ?? []).map((v: Record<string, unknown>) => [v.id, v])
    );

    // Resolve webhook
    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    const aspectRatio = video.aspect_ratio ?? '9:16';

    type BatchResult = {
      variant_id: string;
      task_id?: string;
      model?: string;
      status: 'queued' | 'skipped' | 'failed';
      reason?: string;
    };

    const results: BatchResult[] = [];
    let queued = 0;
    let skipped = 0;

    for (const variantId of variantIds) {
      const variant = variantMap.get(variantId) as Record<string, unknown> | undefined;

      if (!variant) {
        results.push({
          variant_id: variantId,
          status: 'skipped',
          reason: 'not found in this project',
        });
        skipped++;
        continue;
      }

      if (variant.image_gen_status === 'generating') {
        results.push({
          variant_id: variantId,
          status: 'skipped',
          reason: 'already generating',
        });
        skipped++;
        continue;
      }

      // Build prompt
      const asset = variant.asset as Record<string, unknown>;
      let prompt: string;

      if (promptOverrides[variantId]) {
        prompt = promptOverrides[variantId];
      } else {
        const parts: string[] = [];
        const assetType = asset.type as string;

        if (assetType === 'character') {
          parts.push(
            'Single character portrait, front-facing, well-lit, neutral background'
          );
        } else if (assetType === 'location') {
          parts.push(
            'Wide establishing shot, cinematic composition, atmospheric lighting, no people'
          );
          if (video.genre) parts.push(`${video.genre} genre`);
          if (video.tone) parts.push(`${video.tone} tone`);
        } else {
          parts.push(
            'Clean product shot, centered, neutral background, studio lighting'
          );
        }

        const desc = [asset.description, variant.prompt]
          .filter(Boolean)
          .join('. ');
        if (desc) parts.push(desc as string);
        parts.push(
          'Absolutely no text, no words, no letters, no writing, no labels'
        );
        prompt = parts.join('. ');
      }

      // Queue image generation
      try {
        const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
        webhookUrl.searchParams.set('step', 'VideoAssetImage');
        webhookUrl.searchParams.set('variant_id', variantId);

        const taskResult = await queueImageTask({
          prompt,
          webhookUrl: webhookUrl.toString(),
          aspectRatio,
          resolution: '2K',
        });

        // Mark variant as generating
        await db
          .from('project_asset_variants')
          .update({
            image_gen_status: 'generating',
            image_task_id: taskResult.requestId,
          })
          .eq('id', variantId);

        results.push({
          variant_id: variantId,
          task_id: taskResult.requestId,
          model: taskResult.model,
          status: 'queued',
        });
        queued++;
      } catch (err) {
        results.push({
          variant_id: variantId,
          status: 'failed',
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      queued,
      skipped,
      failed: results.filter((r) => r.status === 'failed').length,
      total: variantIds.length,
      aspect_ratio: aspectRatio,
      resolution: '2K',
      results,
    });
  } catch (error) {
    console.error('[v2/projects/:id/generate-images/batch] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
