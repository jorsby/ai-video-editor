import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/series/[id]/generate-grid
 *
 * Generate a grid image containing multiple assets for visual consistency,
 * then split and upload each crop to the corresponding variant.
 *
 * Body: {
 *   type: "character" | "location",
 *   items: Array<{ asset_id: string, variant_id: string }>  // 2-4 items, order = grid position
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
    const { type, items } = body as {
      type: 'character' | 'location';
      items: Array<{ asset_id: string; variant_id: string }>;
    };

    if (!type || !['character', 'location'].includes(type)) {
      return NextResponse.json(
        { error: 'type must be "character" or "location"' },
        { status: 400 }
      );
    }

    if (
      !items ||
      !Array.isArray(items) ||
      items.length < 2 ||
      items.length > 4
    ) {
      return NextResponse.json(
        { error: 'items must be an array of 2-4 { asset_id, variant_id }' },
        { status: 400 }
      );
    }

    // Verify series ownership
    const { data: series, error: seriesError } = await dbClient
      .from('series')
      .select('id, name, genre, tone, bible')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (seriesError || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    // Load all assets + variants
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
      .select('id, asset_id, label, description')
      .in('id', variantIds)) as {
      data: Array<{
        id: string;
        asset_id: string;
        label: string;
        description: string | null;
      }> | null;
    };

    if (!assets || assets.length !== items.length) {
      return NextResponse.json(
        { error: 'One or more assets not found in this series' },
        { status: 404 }
      );
    }

    if (!variants || variants.length !== items.length) {
      return NextResponse.json(
        { error: 'One or more variants not found' },
        { status: 404 }
      );
    }

    // Compute grid layout
    const count = items.length;
    const cols = count <= 2 ? 2 : 2;
    const rows = count <= 2 ? 1 : 2;
    const cellSize = 1024;
    const gridWidth = cols * cellSize;
    const gridHeight = rows * cellSize;

    // Build asset map for quick lookup
    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    // Build grid prompt
    // For character grids, skip genre/tone — they make portraits too dark/moody
    // Character reference sheets should be clean and well-lit
    const stylePrefix: string[] = [];
    if (type !== 'character') {
      if (series.genre) stylePrefix.push(`${series.genre} genre`);
      if (series.tone) stylePrefix.push(`${series.tone} tone`);
    }

    const positionLabels =
      count <= 2
        ? ['left', 'right']
        : ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

    const itemDescriptions = items.map((item, idx) => {
      const asset = assetMap.get(item.asset_id);
      const variant = variantMap.get(item.variant_id);
      // Use generic labels instead of asset names to prevent Flux from
      // rendering names as text in the image
      const label =
        type === 'character' ? `Person ${idx + 1}` : `Scene ${idx + 1}`;
      const desc = [asset?.description, variant?.description]
        .filter(Boolean)
        .join(', ');
      return `${positionLabels[idx]}: ${label}${desc ? ` — ${desc}` : ''}`;
    });

    const typeSuffix =
      type === 'character'
        ? 'Each person shown full body, front-facing, well-lit, neutral background, consistent art style across all panels, high detail character reference sheet'
        : 'Each location shown as wide establishing shot, consistent art style across all panels, cinematic composition, atmospheric lighting';

    const prompt = [
      `A ${cols}x${rows} grid image with clear dividing lines between panels`,
      ...stylePrefix,
      ...itemDescriptions,
      typeSuffix,
      'Same unified visual style across all panels, absolutely no text, no words, no letters, no writing, no labels, no captions',
    ]
      .filter(Boolean)
      .join('. ');

    // Build webhook URL with variant IDs and grid info
    const webhookUrl = new URL(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/fal`
    );
    webhookUrl.searchParams.set('step', 'SeriesGridImage');
    webhookUrl.searchParams.set('variant_ids', variantIds.join(','));
    webhookUrl.searchParams.set('cols', String(cols));
    webhookUrl.searchParams.set('rows', String(rows));

    // Submit to fal.ai queue
    // Note: fal.ai queue drops version suffix for status/result polling
    // but requires it for submission
    const falUrl = new URL('https://queue.fal.run/fal-ai/nano-banana-2');
    falUrl.searchParams.set('fal_webhook', webhookUrl.toString());

    const falRes = await fetch(falUrl.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        num_images: 1,
        resolution: '2K',
        aspect_ratio: cols === rows ? '1:1' : cols > rows ? '16:9' : '9:16',
        output_format: 'jpeg',
        safety_tolerance: '6',
      }),
    });

    if (!falRes.ok) {
      const errText = await falRes.text();
      console.error(
        '[SeriesGrid] fal.ai request failed:',
        falRes.status,
        errText
      );
      return NextResponse.json(
        { error: 'Image generation request failed' },
        { status: 500 }
      );
    }

    const falData = await falRes.json();

    console.log('[SeriesGrid] Submitted grid generation', {
      request_id: falData.request_id,
      type,
      items: items.length,
      grid: `${cols}x${rows}`,
      size: `${gridWidth}x${gridHeight}`,
    });

    return NextResponse.json({
      request_id: falData.request_id,
      grid: { cols, rows, width: gridWidth, height: gridHeight },
      prompt,
      variant_ids: variantIds,
    });
  } catch (error) {
    console.error('[SeriesGrid] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
