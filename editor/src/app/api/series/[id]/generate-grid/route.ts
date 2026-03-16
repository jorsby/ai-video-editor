import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';

type RouteContext = { params: Promise<{ id: string }> };

// ── Model configuration ───────────────────────────────────────────────────────
const MODELS: Record<string, { endpoint: string; useImageSize: boolean }> = {
  'nano-banana-2': { endpoint: 'fal-ai/nano-banana-2', useImageSize: false },
  'flux-pro': { endpoint: 'fal-ai/flux-pro/v1.1', useImageSize: true },
  'flux-2-pro': { endpoint: 'fal-ai/flux-2-pro', useImageSize: true },
};
const DEFAULT_MODEL = 'nano-banana-2';

// ── Aspect ratio → fal.ai value mapping ───────────────────────────────────────
const ASPECT_RATIOS: Record<string, string> = {
  '1:1': '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '3:4': '3:4',
  '4:3': '4:3',
};

// ── Cell pixel sizes per aspect ratio ─────────────────────────────────────────
function cellPixels(
  ratio: string,
  resolution: string
): { w: number; h: number } {
  const base = resolution === '4K' ? 1365 : resolution === '1K' ? 512 : 1024;
  switch (ratio) {
    case '16:9':
      return { w: Math.round(base * (16 / 9)), h: base };
    case '9:16':
      return { w: base, h: Math.round(base * (16 / 9)) };
    case '3:4':
      return { w: base, h: Math.round(base * (4 / 3)) };
    case '4:3':
      return { w: Math.round(base * (4 / 3)), h: base };
    default:
      return { w: base, h: base }; // 1:1
  }
}

// ── Position labels for up to 4×4 ────────────────────────────────────────────
function positionLabel(idx: number, cols: number, rows: number): string {
  if (rows === 1) {
    const labels = ['left', 'center-left', 'center-right', 'right'];
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
    const resolution = gridOpts?.resolution ?? '2K';

    if (!ASPECT_RATIOS[cellRatio]) {
      return NextResponse.json(
        {
          error: `cell_ratio must be one of: ${Object.keys(ASPECT_RATIOS).join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (!['1K', '2K', '4K'].includes(resolution)) {
      return NextResponse.json(
        { error: 'resolution must be "1K", "2K", or "4K"' },
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

    if (cols < 1 || cols > 4 || rows < 1 || rows > 4) {
      return NextResponse.json(
        { error: 'cols and rows must be between 1 and 4' },
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
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(gridWidth, gridHeight);
    const ratioW = gridWidth / g;
    const ratioH = gridHeight / g;
    // Map to closest fal.ai supported ratio
    const gridAspect =
      ratioW === ratioH ? '1:1' : ratioW > ratioH ? '16:9' : '9:16';

    // ── Build webhook URL ───────────────────────────────────────────────────
    const webhookUrl = new URL(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/fal`
    );
    webhookUrl.searchParams.set('step', 'SeriesGridImage');
    webhookUrl.searchParams.set('variant_ids', variantIds.join(','));
    webhookUrl.searchParams.set('cols', String(cols));
    webhookUrl.searchParams.set('rows', String(rows));

    // ── Submit to fal.ai (with resolution fallback) ───────────────────────
    const modelKey =
      modelOverride && MODELS[modelOverride] ? modelOverride : DEFAULT_MODEL;
    const modelConfig = MODELS[modelKey];

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

    let requestId: string;
    let resolutionUsed = resolution;

    try {
      const result = await submitToFal(resolution);
      requestId = result.request_id;
      resolutionUsed = result.resolution_used;
    } catch (err) {
      // If 2K/4K fails, retry at 1K
      if (resolution !== '1K') {
        console.warn(`[SeriesGrid] ${resolution} failed, retrying at 1K:`, err);
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

    console.log('[SeriesGrid] Submitted', {
      request_id: requestId,
      model: modelKey,
      endpoint: modelConfig.endpoint,
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
      model: modelKey,
      config: {
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
      },
    });

    // ── Background polling fallback ─────────────────────────────────────────
    // Fire a delayed poll after 60s in case the webhook doesn't land.
    // Uses waitUntil-style fire-and-forget via setTimeout in the runtime.
    const pollUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/series/${id}/poll-images`;
    const authHeader = req.headers.get('authorization') ?? '';

    setTimeout(async () => {
      try {
        const res = await fetch(pollUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify({
            jobs: [
              {
                request_id: requestId,
                model: modelConfig.endpoint,
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
        model: modelKey,
        endpoint: modelConfig.endpoint,
        allow_text: !!allow_text,
        skip_genre: shouldSkipGenre,
        resolution_requested: resolution,
        resolution_used: resolutionUsed,
        cell_ratio: cellRatio,
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
