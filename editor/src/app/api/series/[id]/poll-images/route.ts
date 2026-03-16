import { createServiceClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { validateApiKey } from '@/lib/auth/api-key';
import { getSeries } from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

const FAL_KEY = process.env.FAL_KEY!;
const SERIES_ASSETS_BUCKET = 'series-assets';

type RouteContext = { params: Promise<{ id: string }> };

interface PendingJob {
  request_id: string;
  model: string;
  type: 'grid' | 'single';
  variant_ids: string[];
  cols?: number;
  rows?: number;
}

/**
 * POST /api/series/[id]/poll-images
 *
 * Polls fal.ai for pending image generation jobs and processes completed ones.
 * This is a fallback for when webhooks don't land.
 *
 * Body: { jobs: PendingJob[] }
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
    const jobs: PendingJob[] = body.jobs;

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
        // Check fal.ai status
        const statusUrl = `https://queue.fal.run/${job.model}/requests/${job.request_id}/status`;
        const statusRes = await fetch(statusUrl, {
          headers: { Authorization: `Key ${FAL_KEY}` },
        });
        const statusData = await statusRes.json();

        if (statusData.status !== 'COMPLETED') {
          results.push({
            request_id: job.request_id,
            status: statusData.status ?? 'UNKNOWN',
            images_saved: 0,
          });
          continue;
        }

        // Fetch result
        const resultUrl = `https://queue.fal.run/${job.model}/requests/${job.request_id}`;
        const resultRes = await fetch(resultUrl, {
          headers: { Authorization: `Key ${FAL_KEY}` },
        });
        const resultData = await resultRes.json();
        const images = resultData.images ?? resultData.output?.images ?? [];

        if (!images.length || !images[0]?.url) {
          results.push({
            request_id: job.request_id,
            status: 'COMPLETED',
            images_saved: 0,
            error: 'No images in fal.ai response',
          });
          continue;
        }

        if (job.type === 'grid') {
          // Grid: download, crop, upload each cell
          const cols = job.cols ?? 2;
          const rows = job.rows ?? Math.ceil(job.variant_ids.length / cols);
          const imgRes = await fetch(images[0].url);
          const imgBuf = Buffer.from(await imgRes.arrayBuffer());
          const meta = await sharp(imgBuf).metadata();
          const cellW = Math.floor((meta.width ?? cols * 1024) / cols);
          const cellH = Math.floor((meta.height ?? rows * 1024) / rows);

          let saved = 0;
          for (let idx = 0; idx < job.variant_ids.length; idx++) {
            const vid = job.variant_ids[idx];
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
              if (paths.length)
                await dbClient.storage.from(SERIES_ASSETS_BUCKET).remove(paths);
              await dbClient
                .from('series_asset_variant_images')
                .delete()
                .eq('variant_id', vid);
            }

            // Crop
            const cellBuf = await sharp(imgBuf)
              .extract({
                left: col * cellW,
                top: row * cellH,
                width: cellW,
                height: cellH,
              })
              .jpeg({ quality: 95 })
              .toBuffer();

            // Upload
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
          // Single image: upload directly
          const vid = job.variant_ids[0];
          if (!vid) {
            results.push({
              request_id: job.request_id,
              status: 'COMPLETED',
              images_saved: 0,
              error: 'No variant_id',
            });
            continue;
          }

          // Delete old
          const { data: old } = await dbClient
            .from('series_asset_variant_images')
            .select('id, storage_path')
            .eq('variant_id', vid);
          if (old?.length) {
            const paths = old
              .map((x: { storage_path?: string }) => x.storage_path)
              .filter(Boolean);
            if (paths.length)
              await dbClient.storage.from(SERIES_ASSETS_BUCKET).remove(paths);
            await dbClient
              .from('series_asset_variant_images')
              .delete()
              .eq('variant_id', vid);
          }

          // Download and upload
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
