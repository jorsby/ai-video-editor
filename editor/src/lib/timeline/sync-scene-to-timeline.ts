import { Video, Audio } from 'openvideo';
import type { Studio } from 'openvideo';
import { MICROSECONDS_PER_SECOND } from '@/types/timeline';
import {
  type SceneForTimeline,
  type SceneTimelineSettings,
  calculateSceneTiming,
} from './scene-to-timeline';

/**
 * Wrap an external URL through our CORS proxy so openvideo can fetch it
 * from the browser.
 */
function proxyUrl(url: string): string {
  if (url.startsWith('/') || url.startsWith('blob:')) return url;
  return `/api/proxy/media?url=${encodeURIComponent(url)}`;
}

/**
 * Sync a single scene's clips in the timeline with the latest scene data.
 *
 * Finds all clips whose metadata.sceneId matches, then replaces their
 * media source while preserving timeline position (display.from).
 */
export async function syncSceneToTimeline(params: {
  sceneId: string;
  scene: SceneForTimeline;
  studio: Studio;
  matchVideoToAudio: boolean;
  canvasWidth: number;
  canvasHeight: number;
}): Promise<{ replaced: number }> {
  const {
    sceneId,
    scene,
    studio,
    matchVideoToAudio,
    canvasWidth,
    canvasHeight,
  } = params;

  let replaced = 0;

  // Pre-build new clips from scene data so we can use them in the factory
  let newVideoClip: InstanceType<typeof Video> | null = null;
  let newAudioClip: InstanceType<typeof Audio> | null = null;

  if (scene.video_url) {
    newVideoClip = await Video.fromUrl(proxyUrl(scene.video_url));
    await newVideoClip.scaleToFit(canvasWidth, canvasHeight);
    newVideoClip.centerInScene(canvasWidth, canvasHeight);
  }

  if (scene.audio_url) {
    newAudioClip = await Audio.fromUrl(proxyUrl(scene.audio_url));
    // Audio.fromUrl skips `await clip.ready` for perf; we need the real
    // duration for matching, so wait for the PCM decode here.
    await newAudioClip.ready;
  }

  // Calculate timing
  const realAudioDur = newAudioClip
    ? newAudioClip.duration / MICROSECONDS_PER_SECOND
    : 0;
  const realVideoDur = newVideoClip
    ? newVideoClip.duration / MICROSECONDS_PER_SECOND
    : 0;
  const isNarrative = !!scene.audio_text;

  const settings: SceneTimelineSettings = {
    sceneId,
    matchVideoToAudio,
  };

  const timing = calculateSceneTiming(
    realAudioDur,
    realVideoDur,
    isNarrative,
    settings
  );

  // Track whether we've already used each new clip (they can only be inserted once)
  let videoUsed = false;
  let audioUsed = false;

  await studio.timeline.replaceClipsByPredicate(
    (clip) => (clip.metadata?.sceneId as string) === sceneId,
    async (oldClip) => {
      const displayFrom = oldClip.display.from;

      if (oldClip.type === 'Video' && newVideoClip && !videoUsed) {
        videoUsed = true;
        const clip = await newVideoClip.clone();
        clip.metadata = { sceneId };
        clip.name = oldClip.name;

        const videoDurUs = Math.round(
          timing.videoDuration * MICROSECONDS_PER_SECOND
        );
        clip.display = { from: displayFrom, to: displayFrom + videoDurUs };
        clip.duration = videoDurUs;
        clip.playbackRate = timing.videoPlaybackRate;

        const rawVideoDurUs = Math.round(
          realVideoDur * MICROSECONDS_PER_SECOND
        );
        clip.trim = { from: 0, to: rawVideoDurUs };

        replaced++;
        return clip;
      }

      if (oldClip.type === 'Audio' && newAudioClip && !audioUsed) {
        audioUsed = true;
        const clip = await newAudioClip.clone();
        clip.metadata = { sceneId };
        clip.name = oldClip.name;

        const audioDurUs = Math.round(
          timing.audioDuration * MICROSECONDS_PER_SECOND
        );
        clip.display = { from: displayFrom, to: displayFrom + audioDurUs };
        clip.duration = audioDurUs;

        const rawAudioDurUs = Math.round(
          realAudioDur * MICROSECONDS_PER_SECOND
        );
        clip.trim = { from: 0, to: rawAudioDurUs };

        replaced++;
        return clip;
      }

      // No matching new media — remove the old clip
      return null;
    }
  );

  return { replaced };
}
