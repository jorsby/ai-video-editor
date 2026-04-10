import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const FFMPEG_CORE_VERSION = '0.12.6';
const FFMPEG_BASE_URL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

/**
 * Extract a segment from a video blob using ffmpeg.wasm.
 *
 * Uses stream copy (-c copy) so there is no re-encoding — this is
 * near-instant and preserves original quality.
 *
 * @param inputBlob  The full video MP4 blob
 * @param startTime  Segment start in seconds
 * @param endTime    Segment end in seconds
 * @param segmentIndex  Index for output filename uniqueness
 * @param onProgress Optional progress callback (0-1)
 * @returns A new MP4 blob containing only the specified segment
 */
export async function splitVideoSegment(
  inputBlob: Blob,
  startTime: number,
  endTime: number,
  segmentIndex: number,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ffmpeg = new FFmpeg();

  ffmpeg.on('progress', ({ progress }) => {
    onProgress?.(Math.min(progress, 1));
  });

  await ffmpeg.load({
    coreURL: await toBlobURL(
      `${FFMPEG_BASE_URL}/ffmpeg-core.js`,
      'text/javascript'
    ),
    wasmURL: await toBlobURL(
      `${FFMPEG_BASE_URL}/ffmpeg-core.wasm`,
      'application/wasm'
    ),
  });

  await ffmpeg.writeFile('input.mp4', await fetchFile(inputBlob));

  const outputName = `short_${segmentIndex}.mp4`;

  const exitCode = await ffmpeg.exec([
    '-ss',
    startTime.toFixed(3),
    '-to',
    endTime.toFixed(3),
    '-i',
    'input.mp4',
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    '-movflags',
    '+faststart',
    outputName,
  ]);

  if (exitCode !== 0) {
    throw new Error(`ffmpeg segment extraction failed (exit code ${exitCode})`);
  }

  const data = await ffmpeg.readFile(outputName);
  return new Blob([data as BlobPart], { type: 'video/mp4' });
}

/**
 * Overlay a hook PNG on the first 3 seconds of a short video.
 *
 * Re-encodes the video with the PNG composited on top, then outputs
 * a faststart MP4 suitable for social media upload.
 */
export async function overlayHookOnShort(
  shortBlob: Blob,
  hookPngBlob: Blob,
  segmentIndex: number
): Promise<Blob> {
  const ffmpeg = new FFmpeg();

  await ffmpeg.load({
    coreURL: await toBlobURL(
      `${FFMPEG_BASE_URL}/ffmpeg-core.js`,
      'text/javascript'
    ),
    wasmURL: await toBlobURL(
      `${FFMPEG_BASE_URL}/ffmpeg-core.wasm`,
      'application/wasm'
    ),
  });

  await ffmpeg.writeFile('input.mp4', await fetchFile(shortBlob));
  await ffmpeg.writeFile('hook.png', await fetchFile(hookPngBlob));

  const HOOK_DURATION = 3;

  // Step 1: Encode only the first 3s with hook overlay
  let exitCode = await ffmpeg.exec([
    '-t',
    String(HOOK_DURATION),
    '-i',
    'input.mp4',
    '-i',
    'hook.png',
    '-filter_complex',
    '[0:v][1:v]overlay=(W-w)/2:(H-h)/2',
    '-c:v',
    'libx264',
    '-b:v',
    '3500k',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    'part_hook.mp4',
  ]);
  if (exitCode !== 0) {
    throw new Error(`ffmpeg hook encode failed (exit ${exitCode})`);
  }

  // Step 2: Stream-copy the rest (after 3s) — near-instant
  exitCode = await ffmpeg.exec([
    '-ss',
    String(HOOK_DURATION),
    '-i',
    'input.mp4',
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    'part_rest.mp4',
  ]);
  if (exitCode !== 0) {
    throw new Error(`ffmpeg rest copy failed (exit ${exitCode})`);
  }

  // Step 3: Concat both parts without re-encoding
  await ffmpeg.writeFile(
    'list.txt',
    "file 'part_hook.mp4'\nfile 'part_rest.mp4'\n"
  );
  const outputName = `hooked_${segmentIndex}.mp4`;
  exitCode = await ffmpeg.exec([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    'list.txt',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    outputName,
  ]);
  if (exitCode !== 0) {
    throw new Error(`ffmpeg concat failed (exit ${exitCode})`);
  }

  const data = await ffmpeg.readFile(outputName);
  return new Blob([data as BlobPart], { type: 'video/mp4' });
}
