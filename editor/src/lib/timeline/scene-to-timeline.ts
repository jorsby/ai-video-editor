import { Video, Audio } from 'openvideo';
import { MICROSECONDS_PER_SECOND } from '@/types/timeline';

/**
 * Wrap an external URL through our CORS proxy so openvideo can fetch it
 * from the browser. Only proxies non-local URLs.
 */
function proxyUrl(url: string): string {
  if (url.startsWith('/') || url.startsWith('blob:')) return url;
  return `/api/proxy/media?url=${encodeURIComponent(url)}`;
}

/**
 * Scene data needed for timeline insertion
 */
export interface SceneForTimeline {
  id: string;
  order: number;
  title: string | null;
  audio_url: string | null;
  video_url: string | null;
  audio_text: string | null;
  audio_duration: number | null; // seconds (from DB, may be inaccurate)
  video_duration: number | null; // seconds (from DB, may be inaccurate)
}

/**
 * Per-scene settings from the pre-send UI.
 * matchVideoToAudio: slow/speed video so it plays for exactly the audio duration.
 */
export interface SceneTimelineSettings {
  sceneId: string;
  matchVideoToAudio: boolean;
}

/**
 * Result of preparing clips for a single scene
 */
export interface SceneClipResult {
  sceneId: string;
  videoClip: InstanceType<typeof Video> | null;
  audioClip: InstanceType<typeof Audio> | null;
  displayFrom: number; // microseconds
  videoDuration: number; // microseconds
  audioDuration: number; // microseconds
  videoPlaybackRate: number;
}

/**
 * Calculate the effective duration and playback rate for a scene.
 *
 * When matchVideoToAudio is true (narrative scenes):
 *   - playbackRate = videoDuration / audioDuration
 *   - video stretches/compresses to exactly match audio length
 *   - trim.to on the video source = full source duration (no trimming)
 *
 * The only "trim" is a micro-trim on the video source end to ensure
 * exact frame alignment (handled in buildSceneClips, not here).
 */
export function calculateSceneTiming(
  audioDurationSec: number,
  videoDurationSec: number,
  isNarrative: boolean,
  settings: SceneTimelineSettings
): {
  audioDuration: number; // seconds — full audio
  videoDuration: number; // seconds — timeline duration of video (after rate change)
  videoPlaybackRate: number;
  sceneDuration: number; // seconds — max of audio/video
} {
  let videoDuration = videoDurationSec;
  let videoPlaybackRate = 1;

  // For narrative scenes: match video speed to audio
  if (
    settings.matchVideoToAudio &&
    isNarrative &&
    audioDurationSec > 0 &&
    videoDurationSec > 0
  ) {
    // Rate < 1 = slow-mo, rate > 1 = speed-up
    videoPlaybackRate = videoDurationSec / audioDurationSec;
    videoPlaybackRate = Math.max(0.25, Math.min(4, videoPlaybackRate));
    // Video timeline duration = audio duration (they play together)
    videoDuration = audioDurationSec;
  }

  const sceneDuration = Math.max(audioDurationSec, videoDuration);

  return {
    audioDuration: audioDurationSec,
    videoDuration,
    videoPlaybackRate,
    sceneDuration,
  };
}

/**
 * Get the real duration from a loaded openvideo clip in seconds.
 * The clip's `duration` is set by fromUrl probe (in microseconds).
 */
function clipDurationSec(clip: { duration: number }): number {
  return clip.duration / MICROSECONDS_PER_SECOND;
}

/**
 * Build clips for multiple scenes and add them to the studio sequentially.
 *
 * IMPORTANT: Uses the clip's own probed duration (from fromUrl), NOT DB values.
 * DB audio_duration/video_duration are often stale or wrong.
 */
export async function buildSceneClips(params: {
  scenes: SceneForTimeline[];
  settings: SceneTimelineSettings[];
  canvasWidth: number;
  canvasHeight: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<SceneClipResult[]> {
  const { scenes, settings, canvasWidth, canvasHeight, onProgress } = params;
  const results: SceneClipResult[] = [];

  // Sort by scene order
  const sorted = [...scenes].sort((a, b) => a.order - b.order);

  let currentOffset = 0; // microseconds

  for (const [idx, scene] of sorted.entries()) {
    const sceneSettings = settings.find((s) => s.sceneId === scene.id);
    if (!sceneSettings) continue;

    onProgress?.(idx, sorted.length);

    let videoClip: InstanceType<typeof Video> | null = null;
    let audioClip: InstanceType<typeof Audio> | null = null;

    // ── Load clips first, probe real durations ──────────────────────

    if (scene.video_url) {
      videoClip = await Video.fromUrl(proxyUrl(scene.video_url));
      videoClip.name = scene.title
        ? `S${scene.order} – ${scene.title}`
        : `Scene ${scene.order}`;
      await videoClip.scaleToFit(canvasWidth, canvasHeight);
      videoClip.centerInScene(canvasWidth, canvasHeight);
    }

    if (scene.audio_url) {
      audioClip = await Audio.fromUrl(proxyUrl(scene.audio_url));
      audioClip.name = scene.title
        ? `VO – S${scene.order} – ${scene.title}`
        : `VO – Scene ${scene.order}`;
    }

    // ── Get real durations from probed clips ────────────────────────

    const realAudioDur = audioClip ? clipDurationSec(audioClip) : 0;
    const realVideoDur = videoClip ? clipDurationSec(videoClip) : 0;
    const isNarrative = !!scene.audio_text;

    const timing = calculateSceneTiming(
      realAudioDur,
      realVideoDur,
      isNarrative,
      sceneSettings
    );

    // ── Apply timing to video clip ──────────────────────────────────

    if (videoClip) {
      const videoDurUs = Math.round(
        timing.videoDuration * MICROSECONDS_PER_SECOND
      );
      videoClip.display = {
        from: currentOffset,
        to: currentOffset + videoDurUs,
      };
      videoClip.duration = videoDurUs;
      videoClip.playbackRate = timing.videoPlaybackRate;

      // Use full source — no user trimming.
      // Micro-trim: clamp to exact source length so player doesn't overshoot.
      const rawVideoDurUs = Math.round(realVideoDur * MICROSECONDS_PER_SECOND);
      videoClip.trim = { from: 0, to: rawVideoDurUs };

      // Video keeps its original audio volume — user adjusts via mixer
    }

    // ── Apply timing to audio clip ──────────────────────────────────

    if (audioClip) {
      const audioDurUs = Math.round(
        timing.audioDuration * MICROSECONDS_PER_SECOND
      );
      audioClip.display = {
        from: currentOffset,
        to: currentOffset + audioDurUs,
      };
      audioClip.duration = audioDurUs;

      // Full audio source, no trimming
      const rawAudioDurUs = Math.round(realAudioDur * MICROSECONDS_PER_SECOND);
      audioClip.trim = { from: 0, to: rawAudioDurUs };
    }

    // ── Record result ───────────────────────────────────────────────

    const videoDurUs = Math.round(
      timing.videoDuration * MICROSECONDS_PER_SECOND
    );
    const audioDurUs = Math.round(
      timing.audioDuration * MICROSECONDS_PER_SECOND
    );

    results.push({
      sceneId: scene.id,
      videoClip,
      audioClip,
      displayFrom: currentOffset,
      videoDuration: videoDurUs,
      audioDuration: audioDurUs,
      videoPlaybackRate: timing.videoPlaybackRate,
    });

    // Advance offset by the scene's total duration
    const sceneDurUs = Math.round(
      timing.sceneDuration * MICROSECONDS_PER_SECOND
    );
    currentOffset += sceneDurUs;
  }

  onProgress?.(sorted.length, sorted.length);
  return results;
}
