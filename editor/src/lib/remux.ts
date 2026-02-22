import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const FFMPEG_CORE_VERSION = '0.12.6';
const FFMPEG_BASE_URL = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

/**
 * Remux a Fragmented MP4 (fMP4) blob into a standard faststart MP4.
 *
 * The Jorsby renderer outputs fMP4 (fragmented / CMAF format) which is a
 * streaming container. Instagram's upload API requires a standard MP4 with
 * the `moov` atom at the front (faststart). This function converts the blob
 * in-browser using FFmpeg WebAssembly — no re-encoding, no quality loss.
 *
 * @param inputBlob  The fMP4 Blob produced by the renderer
 * @param onProgress Optional callback with progress 0→1 during remux
 * @returns          A standard faststart MP4 Blob ready for Instagram upload
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

  await ffmpeg.exec([
    '-i', 'input.mp4',
    '-c:v', 'copy',   // copy video stream — no re-encode
    '-c:a', 'copy',   // copy audio stream — no re-encode
    '-movflags', '+faststart', // move moov atom to front → standard MP4
    'output.mp4',
  ]);

  const data = await ffmpeg.readFile('output.mp4');
  return new Blob([data], { type: 'video/mp4' });
}
