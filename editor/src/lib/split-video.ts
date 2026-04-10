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
