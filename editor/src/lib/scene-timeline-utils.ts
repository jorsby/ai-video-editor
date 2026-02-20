import type { Studio } from 'openvideo';
import { Video, Audio } from 'openvideo';

/**
 * Find a track of the given type that has no clips overlapping [from, to].
 * Returns undefined if all matching tracks have conflicts.
 */
export function findCompatibleTrack(
  studio: Studio,
  clipType: string,
  displayFrom: number,
  displayTo: number
) {
  return studio.tracks.find((track) => {
    if (track.type !== clipType) return false;
    return track.clipIds.every((clipId) => {
      const existing = studio.clips.find((c) => c.id === clipId);
      if (!existing) return true;
      const existingEnd =
        existing.display.to > 0
          ? existing.display.to
          : existing.display.from + existing.duration;
      return displayFrom >= existingEnd || displayTo <= existing.display.from;
    });
  });
}

interface SceneInput {
  videoUrl: string;
  voiceover?: { audioUrl: string } | null;
}

interface AddSceneOptions {
  startTime: number;
  videoTrackId?: string;
  audioTrackId?: string;
  videoVolume?: number;
  /** When true, still match video duration to voiceover but don't add the audio clip to the timeline. */
  skipAudioClip?: boolean;
}

interface AddSceneResult {
  endTime: number;
  videoTrackId?: string;
  audioTrackId?: string;
}

/**
 * Add a single scene (video + optional audio) to the studio timeline.
 * Returns the end time and track IDs used, for chaining in batch operations.
 */
export async function addSceneToTimeline(
  studio: Studio,
  scene: SceneInput,
  options: AddSceneOptions
): Promise<AddSceneResult> {
  const { startTime, videoTrackId, audioTrackId } = options;
  const canvasWidth = studio.opts.width;
  const canvasHeight = studio.opts.height;

  const videoClip = await Video.fromUrl(scene.videoUrl);
  await videoClip.scaleToFit(canvasWidth, canvasHeight);
  videoClip.centerInScene(canvasWidth, canvasHeight);
  videoClip.volume = options.videoVolume ?? 0;

  let endTime: number;
  let usedVideoTrackId = videoTrackId;
  let usedAudioTrackId = audioTrackId;

  if (scene.voiceover?.audioUrl) {
    const audioClip = await Audio.fromUrl(scene.voiceover.audioUrl);
    const audioDuration = audioClip.duration;

    // Match video duration to voiceover
    const nativeVideoDuration = videoClip.duration;

    const MAX_SPEED = 2.0;

    if (nativeVideoDuration < audioDuration) {
      // Video shorter than voiceover: slow down to fill
      videoClip.playbackRate = nativeVideoDuration / audioDuration;
      videoClip.trim.to = nativeVideoDuration;
    } else {
      // Video longer than voiceover: speed up to preserve content, minimize trimming
      const idealRate = nativeVideoDuration / audioDuration;
      videoClip.playbackRate = Math.min(idealRate, MAX_SPEED);
      videoClip.trim.to = audioDuration * videoClip.playbackRate;
    }

    videoClip.duration = videoClip.trim.to / videoClip.playbackRate;

    videoClip.display.from = startTime;
    videoClip.display.to = startTime + videoClip.duration;

    audioClip.display.from = startTime;
    audioClip.display.to = startTime + audioClip.duration;

    endTime = startTime + videoClip.duration;

    await studio.addClip(videoClip, { trackId: usedVideoTrackId });

    if (!options.skipAudioClip) {
      await studio.addClip(audioClip, {
        trackId: usedAudioTrackId,
        audioSource: scene.voiceover.audioUrl,
      });
    }

    // Capture the actual track IDs that were used/created
    if (!usedVideoTrackId) {
      const vTrack = studio.tracks.find(
        (t) => t.type === 'Video' && t.clipIds.includes(videoClip.id)
      );
      usedVideoTrackId = vTrack?.id;
    }
    if (!options.skipAudioClip && !usedAudioTrackId) {
      const aTrack = studio.tracks.find(
        (t) => t.type === 'Audio' && t.clipIds.includes(audioClip.id)
      );
      usedAudioTrackId = aTrack?.id;
    }
  } else {
    videoClip.display.from = startTime;
    videoClip.display.to = startTime + videoClip.duration;
    endTime = startTime + videoClip.duration;

    await studio.addClip(videoClip, { trackId: usedVideoTrackId });

    if (!usedVideoTrackId) {
      const vTrack = studio.tracks.find(
        (t) => t.type === 'Video' && t.clipIds.includes(videoClip.id)
      );
      usedVideoTrackId = vTrack?.id;
    }
  }

  return {
    endTime,
    videoTrackId: usedVideoTrackId,
    audioTrackId: usedAudioTrackId,
  };
}

interface VoiceoverInput {
  audioUrl: string;
}

interface AddVoiceoverOptions {
  startTime: number;
  audioTrackId?: string;
}

interface AddVoiceoverResult {
  endTime: number;
  audioTrackId?: string;
}

/**
 * Add a voiceover-only audio clip to the studio timeline.
 */
export async function addVoiceoverToTimeline(
  studio: Studio,
  voiceover: VoiceoverInput,
  options: AddVoiceoverOptions
): Promise<AddVoiceoverResult> {
  const { startTime, audioTrackId } = options;
  let usedAudioTrackId = audioTrackId;

  const audioClip = await Audio.fromUrl(voiceover.audioUrl);

  audioClip.display.from = startTime;
  audioClip.display.to = startTime + audioClip.duration;

  const endTime = startTime + audioClip.duration;

  await studio.addClip(audioClip, {
    trackId: usedAudioTrackId,
    audioSource: voiceover.audioUrl,
  });

  if (!usedAudioTrackId) {
    const aTrack = studio.tracks.find(
      (t) => t.type === 'Audio' && t.clipIds.includes(audioClip.id)
    );
    usedAudioTrackId = aTrack?.id;
  }

  return {
    endTime,
    audioTrackId: usedAudioTrackId,
  };
}
