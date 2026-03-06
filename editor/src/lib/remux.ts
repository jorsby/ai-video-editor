import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const FFMPEG_CORE_VERSION = '0.12.6';
const FFMPEG_BASE_URL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

/**
 * Convert a Fragmented MP4 (fMP4) blob into a standard, social-media-ready MP4.
 *
 * The Jorsby renderer outputs fMP4 (fragmented / CMAF format) which is a
 * streaming container. Social platforms (Instagram, TikTok, etc.) require a
 * standard MP4 with:
 *   - moov atom at the front (faststart)
 *   - AAC audio codec (Opus is rejected by Instagram with error 2207076)
 *   - Audio bitrate ≤ 128 kbps (target 96 kbps for VBR safety margin)
 *
 * This function:
 *   - Copies the video stream as-is (no re-encoding, no quality loss)
 *   - Transcodes the audio stream to AAC-LC @ 128 kbps / 48 kHz stereo,
 *     handling both Opus→AAC and AAC→AAC transparently
 *
 * @param inputBlob  The fMP4 Blob produced by the renderer
 * @param onProgress Optional callback with progress 0→1 during processing
 * @returns          A standard faststart MP4 Blob with AAC audio
 */
export async function remuxToInstagramMp4(
  inputBlob: Blob,
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

  // First attempt: video copy + audio transcode to AAC
  // -map 0:a? makes the audio stream optional (won't fail if no audio track)
  // -fflags +genpts regenerates timestamps, stripping fMP4 edit lists
  // -avoid_negative_ts make_zero shifts any negative timestamps to zero
  const exitCode = await ffmpeg.exec([
    '-fflags',
    '+genpts',
    '-i',
    'input.mp4',
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-avoid_negative_ts',
    'make_zero',
    '-movflags',
    '+faststart',
    'output.mp4',
  ]);

  // Fallback: if the above failed (e.g. unsupported audio codec), copy video only
  if (exitCode !== 0) {
    await ffmpeg.exec([
      '-fflags',
      '+genpts',
      '-i',
      'input.mp4',
      '-map',
      '0:v:0',
      '-c:v',
      'copy',
      '-an',
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      '+faststart',
      'output.mp4',
    ]);
  }

  const data = await ffmpeg.readFile('output.mp4');
  return new Blob([data as BlobPart], { type: 'video/mp4' });
}
