import { type NextRequest, NextResponse } from 'next/server';
import { splitGrid, type SplitGridInput } from '@/lib/grid-splitter';
import { createClient } from '@/lib/supabase/server';
import { createLogger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  const log = createLogger();
  log.setContext({ step: 'SplitGrid' });

  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    const {
      imageUrl,
      rows,
      cols,
      outPadding,
      storyboardId,
      gridImageId,
      type,
    } = body as SplitGridInput;

    if (!imageUrl || !storyboardId || !gridImageId || !type) {
      return NextResponse.json(
        { error: 'imageUrl, storyboardId, gridImageId, and type are required' },
        { status: 400 }
      );
    }

    if (!['first_frames', 'objects', 'backgrounds'].includes(type)) {
      return NextResponse.json(
        { error: 'type must be first_frames, objects, or backgrounds' },
        { status: 400 }
      );
    }

    log.info('Split grid request', {
      storyboard_id: storyboardId,
      grid_image_id: gridImageId,
      type,
      rows,
      cols,
    });

    const result = await splitGrid(
      { imageUrl, rows, cols, outPadding, storyboardId, gridImageId, type },
      log
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      rows: result.rows,
      cols: result.cols,
      tiles: result.tiles.map((t) => ({
        row: t.row,
        col: t.col,
        url: t.url,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Split grid error', { error: message });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
