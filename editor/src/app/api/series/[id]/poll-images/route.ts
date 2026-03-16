import { createServiceClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { getSeries } from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

const FAL_KEY = process.env.FAL_KEY!;
const SERIES_ASSETS_BUCKET = 'series-assets';

type RouteContext = { params: Promise<{ id: string }> };

interface PendingJobInput {
  request_id: string;
  model?: string;
  type?: 'grid' | 'single';
  variant_ids?: string[];
  cols?: number;
  rows?: number;
}

interface JobMeta {
  prompt?: string | null;
  model?: string | null;
  type?: string | null;
  config?: {
    variant_id?: string;
    variant_ids?: string[];
    cols?: number;
    rows?: number;
    cell_prompts?: Array<{ variant_id?: string; prompt?: string }>;
  } | null;
}

function resolveModelEndpoint(model?: string | null): string {
  if (!model) return 'fal-ai/nano-banana-2';

  // Normalize known status/result endpoints
  const normalized = model
    .replace('fal-ai/flux-pro/v1.1', 'fal-ai/flux-pro')
    .replace('fal-ai/flux-pro/v1', 'fal-ai/flux-pro');

  if (normalized.includes('/')) return normalized;

  const aliases: Record<string, string> = {
    'nano-banana-2': 'fal-ai/nano-banana-2',
    'flux-pro': 'fal-ai/flux-pro',
    'flux-2-pro': 'fal-ai/flux-2-pro',
    banana: 'fal-ai/nano-banana-2',
  };

  return aliases[normalized] ?? normalized;
}

function extractImages(payload: any): Array<{ url?: string }> {
  if (Array.isArray(payload?.images)) return payload.images;
  if (Array.isArray(payload?.output?.images)) return payload.output.images;
  return [];
}

/**
 * POST /api/series/[id]/poll-images
 *
 * Polls fal.ai for pending image generation jobs and processes completed ones.
 * Fallback for missing webhooks.
 *
 * Body:
 * {
 *   jobs: [{ request_id, model?, type?, variant_ids?, cols?, rows? }]
 * }
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    const apiKeyResult = !sessionUser ? validateApiKey(req) : { valid: false };
    const user =
      sessionUser ??
      (apiKeyResult.valid && apiKeyResult.userId
        ? { id: apiKeyResult.userId }
        : null);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');
    const series = await getSeries(dbClient, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const body = await req.json();
    const jobs: PendingJobInput[] = body.jobs;

    if (!Array.isArray(jobs) || jobs.length === 0) {
      return NextResponse.json(
        { error: 'jobs array is required' },
        { status: 400 }
      );
    }

    const results: Array<{
      request_id: string;
      status: string;
      images_saved: number;
      error?: string;
    }> = [];

    for (const job of jobs) {
      try {
        if (!job.request_id) {
          results.push({
            request_id: '',
            status: 'ERROR',
            images_saved: 0,
            error: 'request_id is required',
          });
          continue;
        }

        // Lookup saved metadata for this request
        const { data: jobMetaRaw } = await dbClient
          .from('series_generation_jobs')
          .select('prompt, model, type, config')
          .eq('request_id', job.request_id)
          .maybeSingle();
        const jobMeta = (jobMetaRaw ?? null) as JobMeta | null;

        const modelEndpoint = resolveModelEndpoint(job.model ?? jobMeta?.model);
        const type = (job.type ?? jobMeta?.type ?? 'single') as
          | 'grid'
          | 'single';

        const inferredVariantIds =
          job.variant_ids && job.variant_ids.length > 0
            ? job.variant_ids
            : Array.isArray(jobMeta?.config?.variant_ids)
              ? jobMeta?.config?.variant_ids
              : jobMeta?.config?.variant_id
                ? [jobMeta.config.variant_id]
                : [];

        const cols = job.cols ?? jobMeta?.config?.cols ?? 2;
        const rows =
          job.rows ??
          jobMeta?.config?.rows ??
          Math.ceil(inferredVariantIds.length / cols);

        // Check fal.ai status
        const statusUrl = `https://queue.fal.run/${modelEndpoint}/requests/${job.request_id}/status`;
        const statusRes = await fetch(statusUrl, {
          headers: { Authorization: `Key ${FAL_KEY}` },
        });

        if (!statusRes.ok) {
          const errText = await statusRes.text();
          results.push({
            request_id: job.request_id,
            status: 'ERROR',
            images_saved: 0,
            error: `Status check failed: ${statusRes.status} ${errText.slice(0, 120)}`,
          });
          continue;
        }

        const statusData = await statusRes.json();

        if (statusData.status !== 'COMPLETED') {
          results.push({
            request_id: job.request_id,
            status: statusData.status ?? 'UNKNOWN',
            images_saved: 0,
            error:
              statusData.status === 'ERROR'
                ? (statusData.error ?? 'fal.ai error')
                : undefined,
          });
          continue;
        }

        // Fetch result
        const resultUrl = `https://queue.fal.run/${modelEndpoint}/requests/${job.request_id}`;
        const resultRes = await fetch(resultUrl, {
          headers: { Authorization: `Key ${FAL_KEY}` },
        });

        if (!resultRes.ok) {
          const errText = await resultRes.text();
          results.push({
            request_id: job.request_id,
            status: 'COMPLETED',
            images_saved: 0,
            error: `Result fetch failed: ${resultRes.status} ${errText.slice(0, 120)}`,
          });
          continue;
        }

        const resultData = await resultRes.json();
        const images = extractImages(resultData);

        if (!images.length || !images[0]?.url) {
          results.push({
            request_id: job.request_id,
            status: 'COMPLETED',
            images_saved: 0,
            error: 'No images in fal.ai response',
          });
          continue;
        }

        if (type === 'grid') {
          if (!inferredVariantIds.length) {
            results.push({
              request_id: job.request_id,
              status: 'COMPLETED',
              images_saved: 0,
              error: 'No variant_ids available for grid job',
            });
            continue;
          }

          const imgRes = await fetch(images[0].url);
          const imgBuf = Buffer.from(await imgRes.arrayBuffer());
          const meta = await sharp(imgBuf).metadata();
          const cellW = Math.floor((meta.width ?? cols * 1024) / cols);
          const cellH = Math.floor((meta.height ?? rows * 1024) / rows);

          let saved = 0;
          for (let idx = 0; idx < inferredVariantIds.length; idx++) {
            const vid = inferredVariantIds[idx];
            const col = idx % cols;
            const row = Math.floor(idx / cols);

            // Delete old images
            const { data: old } = await dbClient
              .from('series_asset_variant_images')
              .select('id, storage_path')
              .eq('variant_id', vid);
            if (old?.length) {
              const paths = old
                .map((x: { storage_path?: string }) => x.storage_path)
                .filter(Boolean);
              if (paths.length) {
                await dbClient.storage.from(SERIES_ASSETS_BUCKET).remove(paths);
              }
              await dbClient
                .from('series_asset_variant_images')
                .delete()
                .eq('variant_id', vid);
            }

            const cellBuf = await sharp(imgBuf)
              .extract({
                left: col * cellW,
                top: row * cellH,
                width: cellW,
                height: cellH,
              })
              .jpeg({ quality: 95 })
              .toBuffer();

            const storagePath = `generated/${vid}/${Date.now()}_grid_poll_${idx}.jpg`;
            const { error: upErr } = await dbClient.storage
              .from(SERIES_ASSETS_BUCKET)
              .upload(storagePath, cellBuf, { contentType: 'image/jpeg' });
            if (upErr) continue;

            const {
              data: { publicUrl },
            } = dbClient.storage
              .from(SERIES_ASSETS_BUCKET)
              .getPublicUrl(storagePath);

            const cellPrompt =
              jobMeta?.config?.cell_prompts?.find((p) => p?.variant_id === vid)
                ?.prompt ?? null;

            await dbClient.from('series_asset_variant_images').insert({
              variant_id: vid,
              angle: 'front',
              kind: 'frontal',
              url: publicUrl,
              storage_path: storagePath,
              source: 'generated',
              metadata: {
                fal_request_id: job.request_id,
                grid_position: idx,
                source: 'poll_fallback',
                generation_mode: 'grid',
                prompt: cellPrompt ?? jobMeta?.prompt ?? null,
                cell_prompt: cellPrompt,
                grid_prompt: jobMeta?.prompt ?? null,
                model: jobMeta?.model ?? modelEndpoint,
              },
            });
            saved++;
          }

          results.push({
            request_id: job.request_id,
            status: 'COMPLETED',
            images_saved: saved,
          });
        } else {
          const vid = inferredVariantIds[0];
          if (!vid) {
            results.push({
              request_id: job.request_id,
              status: 'COMPLETED',
              images_saved: 0,
              error: 'No variant_id available for single job',
            });
            continue;
          }

          const { data: old } = await dbClient
            .from('series_asset_variant_images')
            .select('id, storage_path')
            .eq('variant_id', vid);
          if (old?.length) {
            const paths = old
              .map((x: { storage_path?: string }) => x.storage_path)
              .filter(Boolean);
            if (paths.length) {
              await dbClient.storage.from(SERIES_ASSETS_BUCKET).remove(paths);
            }
            await dbClient
              .from('series_asset_variant_images')
              .delete()
              .eq('variant_id', vid);
          }

          const imgRes = await fetch(images[0].url);
          const imgBuf = Buffer.from(await imgRes.arrayBuffer());
          const storagePath = `generated/${vid}/${Date.now()}_poll.jpg`;
          const { error: upErr } = await dbClient.storage
            .from(SERIES_ASSETS_BUCKET)
            .upload(storagePath, imgBuf, { contentType: 'image/jpeg' });
          if (upErr) {
            results.push({
              request_id: job.request_id,
              status: 'COMPLETED',
              images_saved: 0,
              error: upErr.message,
            });
            continue;
          }

          const {
            data: { publicUrl },
          } = dbClient.storage
            .from(SERIES_ASSETS_BUCKET)
            .getPublicUrl(storagePath);

          await dbClient.from('series_asset_variant_images').insert({
            variant_id: vid,
            angle: 'front',
            kind: 'frontal',
            url: publicUrl,
            storage_path: storagePath,
            source: 'generated',
            metadata: {
              fal_request_id: job.request_id,
              source: 'poll_fallback',
              prompt: jobMeta?.prompt ?? null,
              model: jobMeta?.model ?? modelEndpoint,
            },
          });

          results.push({
            request_id: job.request_id,
            status: 'COMPLETED',
            images_saved: 1,
          });
        }
      } catch (jobErr) {
        results.push({
          request_id: job.request_id,
          status: 'ERROR',
          images_saved: 0,
          error: jobErr instanceof Error ? jobErr.message : String(jobErr),
        });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Poll images error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
