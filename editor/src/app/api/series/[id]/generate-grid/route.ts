import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import { queueKieImageTask } from '@/lib/kie-image';
import { resolveProvider } from '@/lib/provider-routing';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

// ── Model configuration ───────────────────────────────────────────────────────
const MODELS: Record<string, { endpoint: string; useImageSize: boolean }> = {
  'nano-banana-2': { endpoint: 'fal-ai/nano-banana-2', useImageSize: false },
};
const DEFAULT_MODEL = 'nano-banana-2';

// ── nano-banana-2 supported aspect ratios (per docs) ─────────────────────────
const NANO_ASPECT_RATIOS = [
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
const NANO_ASPECT_RATIO_SET = new Set<string>(NANO_ASPECT_RATIOS);

type NanoAspectRatio = (typeof NANO_ASPECT_RATIOS)[number];

function parseRatio(ratio: string): { w: number; h: number } | null {
  const [wRaw, hRaw] = ratio.split(':');
  const w = Number(wRaw);
  const h = Number(hRaw);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return null;
  }
  return { w, h };
}

function resolutionBasePx(resolution: string): number {
  switch (resolution) {
    case '0.5K':
      return 384;
    case '1K':
      return 512;
    case '4K':
      return 1365;
    case '2K':
    default:
      return 1024;
  }
}

// ── Cell pixel sizes per aspect ratio ─────────────────────────────────────────
function cellPixels(
  ratio: string,
  resolution: string
): { w: number; h: number } {
  const parsed = parseRatio(ratio);
  const base = resolutionBasePx(resolution);

  if (!parsed) {
    return { w: base, h: base };
  }

  // Keep shorter edge at `base`, scale the longer edge by ratio
  if (parsed.w >= parsed.h) {
    return { w: Math.round(base * (parsed.w / parsed.h)), h: base };
  }

  return { w: base, h: Math.round(base * (parsed.h / parsed.w)) };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function closestNanoAspect(width: number, height: number): NanoAspectRatio {
  const g = gcd(width, height);
  const reduced = `${Math.floor(width / g)}:${Math.floor(height / g)}`;

  if (NANO_ASPECT_RATIO_SET.has(reduced)) {
    return reduced as NanoAspectRatio;
  }

  const target = width / height;
  let best: NanoAspectRatio = '1:1';
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const ratio of NANO_ASPECT_RATIOS) {
    const parsed = parseRatio(ratio);
    if (!parsed) continue;
    const value = parsed.w / parsed.h;
    const delta = Math.abs(target - value);
    if (delta < bestDelta) {
      best = ratio;
      bestDelta = delta;
    }
  }

  return best;
}

// ── Position labels for up to 6×6 ────────────────────────────────────────────
function positionLabel(idx: number, cols: number, rows: number): string {
  if (rows === 1) {
    const labels = [
      'left',
      'left-center',
      'center',
      'right-center',
      'right',
      'far-right',
    ];
    return labels[idx] ?? `position ${idx + 1}`;
  }
  const row = Math.floor(idx / cols);
  const col = idx % cols;
  const rowLabel =
    row === 0 ? 'top' : row === rows - 1 ? 'bottom' : `row-${row + 1}`;
  const colLabel =
    col === 0 ? 'left' : col === cols - 1 ? 'right' : `col-${col + 1}`;
  return `${rowLabel}-${colLabel}`;
}

// ── Type-specific prompt suffixes ─────────────────────────────────────────────
const TYPE_SUFFIXES: Record<string, string> = {
  character:
    'Each person shown full body, front-facing, well-lit, neutral background, consistent art style across all panels, high detail character reference sheet',
  location:
    'Each location shown as wide establishing shot, consistent art style across all panels, cinematic composition, atmospheric lighting',
  prop: 'Each object shown as a clean product shot, front-facing, well-lit, studio lighting, white or neutral background, consistent style across all panels, high detail',
};

// ── Item label by type (avoids baking names as text) ──────────────────────────
function itemLabel(type: string, idx: number): string {
  if (type === 'character') return `Person ${idx + 1}`;
  if (type === 'prop') return `Object ${idx + 1}`;
  return `Scene ${idx + 1}`;
}

/**
 * POST /api/series/[id]/generate-grid
 *
 * Configurable grid image generation.
 *
 * Body: {
 *   type: "character" | "location" | "prop",
 *   items: Array<{ asset_id, variant_id }>,           // 2-16 items
 *   grid?: { cols?, rows?, cell_ratio?, resolution? }, // defaults: auto cols/rows, 1:1, 2K
 *   allow_text?: boolean,                              // default false
 *   skip_genre?: boolean,                              // default: auto (true for character/prop)
 *   custom_suffix?: string                             // extra prompt instructions
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
    const body = await req.json();

    // ── Parse & validate ────────────────────────────────────────────────────
    const {
      type,
      items,
      grid: gridOpts,
      allow_text,
      skip_genre,
      custom_suffix,
      model: modelOverride,
    } = body as {
      type: string;
      items: Array<{ asset_id: string; variant_id: string }>;
      model?: string;
      grid?: {
        cols?: number;
        rows?: number;
        cell_ratio?: string;
        resolution?: string;
      };
      allow_text?: boolean;
      skip_genre?: boolean;
      custom_suffix?: string;
    };

    const providerResolution = await resolveProvider({
      service: 'image',
      req,
      body,
    });

    if (providerResolution.provider === 'fal' && !process.env.FAL_KEY) {
      return NextResponse.json({ error: 'Missing FAL_KEY' }, { status: 500 });
    }

    if (!type || !['character', 'location', 'prop'].includes(type)) {
      return NextResponse.json(
        { error: 'type must be "character", "location", or "prop"' },
        { status: 400 }
      );
    }

    if (
      !items ||
      !Array.isArray(items) ||
      items.length < 2 ||
      items.length > 16
    ) {
      return NextResponse.json(
        { error: 'items must be an array of 2-16 { asset_id, variant_id }' },
        { status: 400 }
      );
    }

    // Grid configuration with smart defaults
    const cellRatio = gridOpts?.cell_ratio ?? '1:1';
    const resolutionRaw = gridOpts?.resolution ?? '2K';
    const resolution =
      typeof resolutionRaw === 'string' ? resolutionRaw.toUpperCase() : '2K';

    if (!NANO_ASPECT_RATIO_SET.has(cellRatio)) {
      return NextResponse.json(
        {
          error: `cell_ratio must be one of: ${NANO_ASPECT_RATIOS.join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (!['0.5K', '1K', '2K', '4K'].includes(resolution)) {
      return NextResponse.json(
        { error: 'resolution must be "0.5K", "1K", "2K", or "4K"' },
        { status: 400 }
      );
    }

    // Auto-compute cols/rows if not provided
    const count = items.length;
    let cols = gridOpts?.cols ?? 0;
    let rows = gridOpts?.rows ?? 0;

    if (cols && rows) {
      if (cols * rows < count) {
        return NextResponse.json(
          {
            error: `Grid ${cols}×${rows} = ${cols * rows} cells, but ${count} items provided`,
          },
          { status: 400 }
        );
      }
    } else if (cols) {
      rows = Math.ceil(count / cols);
    } else if (rows) {
      cols = Math.ceil(count / rows);
    } else {
      // Auto: prefer square-ish grids
      if (count <= 2) {
        cols = 2;
        rows = 1;
      } else if (count <= 4) {
        cols = 2;
        rows = 2;
      } else if (count <= 6) {
        cols = 3;
        rows = 2;
      } else if (count <= 9) {
        cols = 3;
        rows = 3;
      } else {
        cols = 4;
        rows = Math.ceil(count / 4);
      }
    }

    if (cols < 1 || cols > 6 || rows < 1 || rows > 6) {
      return NextResponse.json(
        { error: 'cols and rows must be between 1 and 6' },
        { status: 400 }
      );
    }

    // Cell and total dimensions
    const cell = cellPixels(cellRatio, resolution);
    const gridWidth = cols * cell.w;
    const gridHeight = rows * cell.h;

    // ── Verify series ownership ─────────────────────────────────────────────
    const { data: series, error: seriesError } = await dbClient
      .from('series')
      .select('id, name, genre, tone, bible')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (seriesError || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    // ── Load assets + variants ──────────────────────────────────────────────
    const assetIds = items.map((i) => i.asset_id);
    const variantIds = items.map((i) => i.variant_id);

    const { data: assets } = (await dbClient
      .from('series_assets')
      .select('id, type, name, description')
      .eq('series_id', id)
      .in('id', assetIds)) as {
      data: Array<{
        id: string;
        type: string;
        name: string;
        description: string | null;
      }> | null;
    };

    const { data: variants } = (await dbClient
      .from('series_asset_variants')
      .select('id, asset_id, label, description, is_finalized')
      .in('id', variantIds)) as {
      data: Array<{
        id: string;
        asset_id: string;
        label: string;
        description: string | null;
        is_finalized: boolean;
      }> | null;
    };

    if (!assets || assets.length !== new Set(assetIds).size) {
      return NextResponse.json(
        { error: 'One or more assets not found in this series' },
        { status: 404 }
      );
    }

    if (!variants || variants.length !== new Set(variantIds).size) {
      return NextResponse.json(
        { error: 'One or more variants not found' },
        { status: 404 }
      );
    }

    const finalizedVariantIds = variants
      .filter((v) => v.is_finalized)
      .map((v) => v.id);
    if (finalizedVariantIds.length > 0) {
      return NextResponse.json(
        {
          error: 'One or more variants are finalized and cannot be regenerated',
          variant_ids: finalizedVariantIds,
        },
        { status: 409 }
      );
    }

    const { data: usedVariants } = await dbClient
      .from('episode_asset_variants')
      .select('variant_id')
      .in('variant_id', variantIds)
      .limit(1);

    if ((usedVariants?.length ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'One or more variants are already used in episodes and cannot be regenerated',
        },
        { status: 409 }
      );
    }

    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    // ── Build prompt ────────────────────────────────────────────────────────
    // Genre/tone: auto-skip for character/prop, include for location
    const shouldSkipGenre =
      skip_genre !== undefined ? skip_genre : type !== 'location';

    const stylePrefix: string[] = [];
    if (!shouldSkipGenre) {
      if (series.genre) stylePrefix.push(`${series.genre} genre`);
      if (series.tone) stylePrefix.push(`${series.tone} tone`);
    }

    const itemDescriptions = items.map((item, idx) => {
      const asset = assetMap.get(item.asset_id);
      const variant = variantMap.get(item.variant_id);
      const label = itemLabel(type, idx);
      const desc = [asset?.description, variant?.description]
        .filter(Boolean)
        .join(', ');
      return `${positionLabel(idx, cols, rows)}: ${label}${desc ? ` — ${desc}` : ''}`;
    });

    // Cell-specific prompts (shown in UI as the generation prompt per image)
    const cellPrompts = items.map((item, idx) => {
      const asset = assetMap.get(item.asset_id);
      const variant = variantMap.get(item.variant_id);
      const label = itemLabel(type, idx);
      const desc = [asset?.description, variant?.description]
        .filter(Boolean)
        .join(', ');

      const parts = [
        ...stylePrefix,
        `${label}${desc ? ` — ${desc}` : ''}`,
        TYPE_SUFFIXES[type] ?? '',
        !allow_text
          ? 'Absolutely no text, no words, no letters, no writing, no labels, no captions'
          : '',
        custom_suffix ?? '',
      ].filter(Boolean);

      return {
        variant_id: item.variant_id,
        prompt: parts.join('. '),
      };
    });

    const noTextSuffix = allow_text
      ? ''
      : 'Absolutely no text, no words, no letters, no writing, no labels, no captions';

    const promptParts = [
      `A ${cols}x${rows} grid image with clear dividing lines between panels`,
      ...stylePrefix,
      ...itemDescriptions,
      TYPE_SUFFIXES[type] ?? '',
      'Same unified visual style across all panels',
      noTextSuffix,
      custom_suffix ?? '',
    ].filter(Boolean);

    const prompt = promptParts.join('. ');

    // ── Compute fal.ai aspect ratio from total grid dimensions ──────────────
    const gridAspect = closestNanoAspect(gridWidth, gridHeight);

    // ── Build webhook URL ───────────────────────────────────────────────────
    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    const callbackPath =
      providerResolution.provider === 'kie'
        ? '/api/webhook/kieai'
        : '/api/webhook/fal';
    const webhookUrl = new URL(`${webhookBase}${callbackPath}`);
    webhookUrl.searchParams.set('step', 'SeriesGridImage');
    webhookUrl.searchParams.set('variant_ids', variantIds.join(','));
    webhookUrl.searchParams.set('cols', String(cols));
    webhookUrl.searchParams.set('rows', String(rows));

    // ── Submit to provider (with fal-specific resolution fallback) ─────────
    const modelKey =
      modelOverride && MODELS[modelOverride] ? modelOverride : DEFAULT_MODEL;
    const modelConfig = MODELS[modelKey];

    let requestId: string;
    let resolutionUsed = resolution;
    let modelForJob = modelKey;
    let endpointForJob = modelConfig.endpoint;

    if (providerResolution.provider === 'kie') {
      try {
        const queued = await queueKieImageTask({
          prompt,
          callbackUrl: webhookUrl.toString(),
          aspectRatio: gridAspect,
          resolution,
          outputFormat: 'jpg',
        });

        requestId = queued.requestId;
        modelForJob = queued.model;
        endpointForJob = queued.endpoint;
      } catch (error) {
        console.error('[SeriesGrid] kie.ai request failed:', error);
        return NextResponse.json(
          { error: 'Image generation request failed' },
          { status: 500 }
        );
      }
    } else {
      async function submitToFal(
        res: string
      ): Promise<{ request_id: string; resolution_used: string }> {
        const falUrl = new URL(`https://queue.fal.run/${modelConfig.endpoint}`);
        falUrl.searchParams.set('fal_webhook', webhookUrl.toString());

        // Models use different size params
        const sizeParams = modelConfig.useImageSize
          ? { image_size: { width: gridWidth, height: gridHeight } }
          : { resolution: res, aspect_ratio: gridAspect };

        const falRes = await fetch(falUrl.toString(), {
          method: 'POST',
          headers: {
            Authorization: `Key ${process.env.FAL_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt,
            num_images: 1,
            ...sizeParams,
            output_format: 'jpeg',
            safety_tolerance: '6',
          }),
        });

        if (!falRes.ok) {
          const errText = await falRes.text();
          throw new Error(
            `fal.ai ${falRes.status}: ${errText.substring(0, 200)}`
          );
        }

        const data = await falRes.json();
        return { request_id: data.request_id, resolution_used: res };
      }

      try {
        const result = await submitToFal(resolution);
        requestId = result.request_id;
        resolutionUsed = result.resolution_used;
      } catch (err) {
        // If 2K/4K fails, retry at 1K
        if (resolution !== '1K') {
          console.warn(
            `[SeriesGrid] ${resolution} failed, retrying at 1K:`,
            err
          );
          try {
            const result = await submitToFal('1K');
            requestId = result.request_id;
            resolutionUsed = '1K';
          } catch (retryErr) {
            console.error('[SeriesGrid] 1K retry also failed:', retryErr);
            return NextResponse.json(
              { error: 'Image generation failed at all resolutions' },
              { status: 500 }
            );
          }
        } else {
          console.error('[SeriesGrid] fal.ai request failed:', err);
          return NextResponse.json(
            { error: 'Image generation request failed' },
            { status: 500 }
          );
        }
      }
    }

    console.log('[SeriesGrid] Submitted', {
      request_id: requestId,
      provider: providerResolution.provider,
      model: modelForJob,
      endpoint: endpointForJob,
      type,
      items: count,
      grid: `${cols}x${rows}`,
      cell: `${cell.w}x${cell.h}`,
      total: `${gridWidth}x${gridHeight}`,
      aspect: gridAspect,
      resolution_requested: resolution,
      resolution_used: resolutionUsed,
      allow_text: !!allow_text,
      skip_genre: shouldSkipGenre,
    });

    // Store prompt + config for webhook to attach later
    await dbClient.from('series_generation_jobs').insert({
      series_id: id,
      request_id: requestId,
      type: 'grid',
      prompt,
      model: modelForJob,
      config: {
        provider: providerResolution.provider,
        type,
        items,
        cols,
        rows,
        cell_ratio: cellRatio,
        resolution_requested: resolution,
        resolution_used: resolutionUsed,
        allow_text: !!allow_text,
        skip_genre: shouldSkipGenre,
        custom_suffix: custom_suffix ?? null,
        cell_prompts: cellPrompts,
      },
    });

    // ── Background polling fallback ─────────────────────────────────────────
    // Fire a delayed poll after 60s in case the webhook doesn't land.
    // Uses waitUntil-style fire-and-forget via setTimeout in the runtime.
    const pollUrl = `${req.nextUrl.origin}/api/series/${id}/poll-images`;
    const authHeader = req.headers.get('authorization') ?? '';
    const fallbackAuth =
      authHeader ||
      (process.env.OCTUPOST_API_KEY
        ? `Bearer ${process.env.OCTUPOST_API_KEY}`
        : '');

    setTimeout(async () => {
      try {
        const res = await fetch(pollUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(fallbackAuth ? { Authorization: fallbackAuth } : {}),
          },
          body: JSON.stringify({
            jobs: [
              {
                request_id: requestId,
                provider: providerResolution.provider,
                model: modelForJob,
                type: 'grid',
                variant_ids: variantIds,
                cols,
                rows,
              },
            ],
          }),
        });
        const result = await res.json();
        console.log(
          '[SeriesGrid] Background poll result:',
          JSON.stringify(result)
        );
      } catch (err) {
        console.error('[SeriesGrid] Background poll failed:', err);
      }
    }, 60_000);

    return NextResponse.json({
      request_id: requestId,
      grid: {
        cols,
        rows,
        cell_width: cell.w,
        cell_height: cell.h,
        total_width: gridWidth,
        total_height: gridHeight,
      },
      prompt,
      variant_ids: variantIds,
      config: {
        type,
        provider: providerResolution.provider,
        model: modelForJob,
        endpoint: endpointForJob,
        allow_text: !!allow_text,
        skip_genre: shouldSkipGenre,
        resolution_requested: resolution,
        resolution_used: resolutionUsed,
        cell_ratio: cellRatio,
        cell_prompts_count: cellPrompts.length,
      },
      poll_fallback: '60s automatic',
    });
  } catch (error) {
    console.error('[SeriesGrid] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
