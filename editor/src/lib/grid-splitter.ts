import sharp from 'sharp';
import { createLogger, type Logger } from '@/lib/logger';
import { createServiceClient } from '@/lib/supabase/admin';
import { R2StorageService } from '@/lib/r2';
import { config } from '@/lib/config';

// ── Types ────────────────────────────────────────────────────────────────

export interface SplitGridInput {
  imageUrl: string;
  rows?: number;
  cols?: number;
  outPadding?: number;
  storyboardId: string;
  gridImageId: string;
  type: 'first_frames' | 'objects' | 'backgrounds';
}

export interface SplitTile {
  row: number;
  col: number;
  index: number;
  url: string;
  paddedUrl?: string;
}

export interface SplitGridResult {
  success: boolean;
  rows: number;
  cols: number;
  tiles: SplitTile[];
  error?: string;
}

// ── Auto-detection ───────────────────────────────────────────────────────

function findSeparators(
  means: Float64Array,
  size: number,
  expectedCount?: number
): number[] {
  // Compute global mean and std dev
  let globalSum = 0;
  for (let i = 0; i < size; i++) globalSum += means[i];
  const globalMean = globalSum / size;

  let varianceSum = 0;
  for (let i = 0; i < size; i++) {
    varianceSum += (means[i] - globalMean) ** 2;
  }
  const stdDev = Math.sqrt(varianceSum / size);

  // If stdDev is very low, the image has no clear separators
  if (stdDev < 2) return [];

  // Determine if separators are dark (valleys) or bright (peaks)
  // Try both and pick whichever yields more consistent results
  const darkSeps = findSeparatorRuns(means, size, globalMean, stdDev, 'dark');
  const brightSeps = findSeparatorRuns(
    means,
    size,
    globalMean,
    stdDev,
    'bright'
  );

  // Pick the result closer to expected count, or the one with more separators
  if (expectedCount !== undefined) {
    const expectedSeps = expectedCount - 1;
    const darkDiff = Math.abs(darkSeps.length - expectedSeps);
    const brightDiff = Math.abs(brightSeps.length - expectedSeps);
    return darkDiff <= brightDiff ? darkSeps : brightSeps;
  }

  return darkSeps.length >= brightSeps.length ? darkSeps : brightSeps;
}

function findSeparatorRuns(
  means: Float64Array,
  size: number,
  globalMean: number,
  stdDev: number,
  mode: 'dark' | 'bright'
): number[] {
  // Threshold: mean +/- 1 stddev
  const threshold =
    mode === 'dark' ? globalMean - stdDev * 0.5 : globalMean + stdDev * 0.5;

  const separators: number[] = [];
  let inSeparator = false;
  let sepStart = 0;
  const minRunLength = Math.max(2, Math.floor(size * 0.002));

  for (let i = 0; i < size; i++) {
    const isSep = mode === 'dark' ? means[i] < threshold : means[i] > threshold;

    if (isSep && !inSeparator) {
      sepStart = i;
      inSeparator = true;
    } else if (!isSep && inSeparator) {
      const runLength = i - sepStart;
      if (runLength >= minRunLength) {
        separators.push(Math.round((sepStart + i) / 2));
      }
      inSeparator = false;
    }
  }

  // Merge separators that are too close (within 3% of image size)
  const mergeThreshold = Math.floor(size * 0.03);
  const merged: number[] = [];
  for (const sep of separators) {
    if (merged.length > 0 && sep - merged[merged.length - 1] < mergeThreshold) {
      merged[merged.length - 1] = Math.round(
        (merged[merged.length - 1] + sep) / 2
      );
    } else {
      merged.push(sep);
    }
  }

  return merged;
}

interface DetectedGrid {
  rows: number;
  cols: number;
  xBounds: number[];
  yBounds: number[];
}

async function detectGridLayout(
  imageBuffer: Buffer,
  expectedRows?: number,
  expectedCols?: number,
  log?: Logger
): Promise<DetectedGrid> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width!;
  const height = metadata.height!;

  // Get raw greyscale pixels
  const { data } = await sharp(imageBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Compute column-wise mean intensity
  const colMeans = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      sum += data[y * width + x];
    }
    colMeans[x] = sum / height;
  }

  // Compute row-wise mean intensity
  const rowMeans = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      sum += data[y * width + x];
    }
    rowMeans[y] = sum / width;
  }

  const verticalSeparators = findSeparators(colMeans, width, expectedCols);
  const horizontalSeparators = findSeparators(rowMeans, height, expectedRows);

  const detectedCols = verticalSeparators.length + 1;
  const detectedRows = horizontalSeparators.length + 1;

  log?.info('Grid detection result', {
    detected_rows: detectedRows,
    detected_cols: detectedCols,
    expected_rows: expectedRows,
    expected_cols: expectedCols,
    v_separators: verticalSeparators.length,
    h_separators: horizontalSeparators.length,
  });

  // If detection seems reasonable, use it; otherwise fall back
  const useDetected =
    detectedRows >= 2 &&
    detectedCols >= 2 &&
    detectedRows <= 8 &&
    detectedCols <= 8;

  if (useDetected) {
    return {
      rows: detectedRows,
      cols: detectedCols,
      xBounds: [0, ...verticalSeparators, width],
      yBounds: [0, ...horizontalSeparators, height],
    };
  }

  // Fallback to uniform division
  const rows = expectedRows || 3;
  const cols = expectedCols || 3;
  log?.warn('Detection failed, using uniform division', { rows, cols });

  const cellW = Math.floor(width / cols);
  const cellH = Math.floor(height / rows);
  const xBounds = Array.from({ length: cols + 1 }, (_, i) =>
    i === cols ? width : i * cellW
  );
  const yBounds = Array.from({ length: rows + 1 }, (_, i) =>
    i === rows ? height : i * cellH
  );

  return { rows, cols, xBounds, yBounds };
}

// ── Core split function ──────────────────────────────────────────────────

function createR2() {
  return new R2StorageService({
    bucketName: config.r2.bucket,
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
    accountId: config.r2.accountId,
    cdn: config.r2.cdn,
  });
}

export async function splitGrid(
  input: SplitGridInput,
  log?: Logger
): Promise<SplitGridResult> {
  const _log = log || createLogger();
  _log.setContext({ step: 'SplitGrid' });

  try {
    // 1. Fetch the grid image
    _log.startTiming('fetch_image');
    const response = await fetch(input.imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    _log.info('Image fetched', {
      size_bytes: imageBuffer.length,
      time_ms: _log.endTiming('fetch_image'),
    });

    // 2. Auto-detect grid dimensions
    _log.startTiming('detect_grid');
    const grid = await detectGridLayout(
      imageBuffer,
      input.rows,
      input.cols,
      _log
    );
    _log.info('Grid layout resolved', {
      rows: grid.rows,
      cols: grid.cols,
      time_ms: _log.endTiming('detect_grid'),
    });

    // 3. Split into tiles
    _log.startTiming('split_tiles');
    const r2 = createR2();
    const outPadding = input.outPadding ?? 32;
    const tiles: SplitTile[] = [];

    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const left = grid.xBounds[c];
        const top = grid.yBounds[r];
        const cellWidth = grid.xBounds[c + 1] - left;
        const cellHeight = grid.yBounds[r + 1] - top;
        const index = r * grid.cols + c;

        // Raw tile
        const rawBuffer = await sharp(imageBuffer)
          .extract({ left, top, width: cellWidth, height: cellHeight })
          .png()
          .toBuffer();

        const rawKey = `grid-tiles/${input.storyboardId}/${input.gridImageId}/tile_${r}_${c}.png`;
        const rawUrl = await r2.uploadData(rawKey, rawBuffer, 'image/png');

        // Out-padded tile
        let paddedUrl: string | undefined;
        if (input.type === 'first_frames' && outPadding > 0) {
          const paddedBuffer = await sharp(imageBuffer)
            .extract({ left, top, width: cellWidth, height: cellHeight })
            .extend({
              top: outPadding,
              bottom: outPadding,
              left: outPadding,
              right: outPadding,
              extendWith: 'mirror',
            })
            .png()
            .toBuffer();

          const paddedKey = `grid-tiles/${input.storyboardId}/${input.gridImageId}/tile_${r}_${c}_padded.png`;
          paddedUrl = await r2.uploadData(paddedKey, paddedBuffer, 'image/png');
        }

        tiles.push({ row: r, col: c, index, url: rawUrl, paddedUrl });
      }
    }

    _log.info('Tiles split and uploaded', {
      count: tiles.length,
      time_ms: _log.endTiming('split_tiles'),
    });

    // 4. Update DB
    _log.startTiming('db_update');
    const supabase = createServiceClient();

    if (input.type === 'first_frames') {
      await updateFirstFrames(
        supabase,
        input.storyboardId,
        input.gridImageId,
        tiles,
        _log
      );
    } else if (input.type === 'objects') {
      await updateObjects(supabase, input.gridImageId, tiles, _log);
    } else if (input.type === 'backgrounds') {
      await updateBackgrounds(supabase, input.gridImageId, tiles, _log);
    }

    _log.info('DB updated', { time_ms: _log.endTiming('db_update') });

    _log.summary('success', {
      grid_image_id: input.gridImageId,
      rows: grid.rows,
      cols: grid.cols,
      tiles: tiles.length,
    });

    return {
      success: true,
      rows: grid.rows,
      cols: grid.cols,
      tiles,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    _log.error('Grid split failed', { error: message });

    // Mark grid_image as failed
    try {
      const supabase = createServiceClient();
      await supabase
        .from('grid_images')
        .update({ status: 'failed', error_message: 'split_error' })
        .eq('id', input.gridImageId);
    } catch {}

    return {
      success: false,
      rows: input.rows || 0,
      cols: input.cols || 0,
      tiles: [],
      error: message,
    };
  }
}

// ── DB update helpers ────────────────────────────────────────────────────

async function updateFirstFrames(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  storyboardId: string,
  gridImageId: string,
  tiles: SplitTile[],
  log: Logger
) {
  const { data: scenes } = await supabase
    .from('scenes')
    .select('id, order, first_frames (id)')
    .eq('storyboard_id', storyboardId)
    .order('order', { ascending: true });

  if (!scenes) {
    log.error('No scenes found for storyboard', {
      storyboard_id: storyboardId,
    });
    return;
  }

  let successCount = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const firstFrame = (
      scene.first_frames as unknown as Array<{ id: string }>
    )?.[0];
    if (!firstFrame) continue;

    const tile = tiles[i];
    const imageUrl = tile?.url || null;
    const outPaddedUrl = tile?.paddedUrl || null;
    const status = imageUrl ? 'success' : 'failed';

    await supabase
      .from('first_frames')
      .update({
        url: imageUrl,
        out_padded_url: outPaddedUrl,
        grid_image_id: gridImageId,
        status,
        error_message: status === 'failed' ? 'split_error' : null,
      })
      .eq('id', firstFrame.id);

    if (status === 'success') successCount++;
  }

  log.success('first_frames updated', {
    total: scenes.length,
    success: successCount,
  });
}

async function updateObjects(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  gridImageId: string,
  tiles: SplitTile[],
  log: Logger
) {
  let successCount = 0;
  for (const tile of tiles) {
    const status = tile.url ? 'success' : 'failed';
    await supabase
      .from('objects')
      .update({ url: tile.url, final_url: tile.url, status })
      .eq('grid_image_id', gridImageId)
      .eq('grid_position', tile.index);
    if (status === 'success') successCount++;
  }
  log.success('Objects updated', {
    total: tiles.length,
    success: successCount,
  });
}

async function updateBackgrounds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  gridImageId: string,
  tiles: SplitTile[],
  log: Logger
) {
  let successCount = 0;
  for (const tile of tiles) {
    const status = tile.url ? 'success' : 'failed';
    await supabase
      .from('backgrounds')
      .update({ url: tile.url, final_url: tile.url, status })
      .eq('grid_image_id', gridImageId)
      .eq('grid_position', tile.index);
    if (status === 'success') successCount++;
  }
  log.success('Backgrounds updated', {
    total: tiles.length,
    success: successCount,
  });
}
