import type { Studio } from 'openvideo';
import { buildSceneClips, type SceneForTimeline } from './scene-to-timeline';

type StudioTrackLike = {
  id: string;
  name: string;
  type: string;
  clipIds: string[];
};

const SCENE_VIDEO_TRACK_NAME = 'Scene Video';
const SCENE_AUDIO_TRACK_NAME = 'Scene Audio';

function findOrCreateTrack(
  studio: Studio,
  type: 'Video' | 'Audio',
  preferredName: string
): StudioTrackLike {
  const existing =
    studio.tracks.find((t) => t.type === type && t.name === preferredName) ??
    studio.tracks.find((t) => t.type === type);
  if (existing) return existing;
  return studio.addTrack({ type, name: preferredName });
}

function trackEndOffset(studio: Studio, track: StudioTrackLike): number {
  if (track.clipIds.length === 0) return 0;
  const ids = new Set(track.clipIds);
  let end = 0;
  for (const clip of studio.clips) {
    if (ids.has(clip.id) && clip.display.to > end) end = clip.display.to;
  }
  return end;
}

export async function appendSceneToTimeline(params: {
  scene: SceneForTimeline;
  studio: Studio;
  canvasWidth: number;
  canvasHeight: number;
}): Promise<{ added: number }> {
  const { scene, studio, canvasWidth, canvasHeight } = params;

  const hasVideo = !!scene.video_url;
  const hasAudio = !!scene.audio_url;
  if (!hasVideo && !hasAudio) return { added: 0 };

  const videoTrack = hasVideo
    ? findOrCreateTrack(studio, 'Video', SCENE_VIDEO_TRACK_NAME)
    : null;
  const audioTrack = hasAudio
    ? findOrCreateTrack(studio, 'Audio', SCENE_AUDIO_TRACK_NAME)
    : null;

  // Append after whichever scene track currently ends latest, so video and
  // audio for this new scene stay aligned even if the two tracks had
  // drifted.
  const videoEnd = videoTrack ? trackEndOffset(studio, videoTrack) : 0;
  const audioEnd = audioTrack ? trackEndOffset(studio, audioTrack) : 0;
  const startOffset = Math.max(videoEnd, audioEnd);

  const [result] = await buildSceneClips({
    scenes: [scene],
    settings: [
      {
        sceneId: scene.id,
        matchVideoToAudio: !!(scene.audio_text || scene.audio_url),
      },
    ],
    canvasWidth,
    canvasHeight,
    startOffset,
  });

  if (!result) return { added: 0 };

  let added = 0;
  if (result.videoClip && videoTrack) {
    await studio.addClip(result.videoClip, { trackId: videoTrack.id });
    added++;
  }
  if (result.audioClip && audioTrack) {
    await studio.addClip(result.audioClip, { trackId: audioTrack.id });
    added++;
  }
  return { added };
}
