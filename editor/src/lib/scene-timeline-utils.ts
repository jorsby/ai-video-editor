import type { Studio, IClip } from 'openvideo';
import { Video, Audio } from 'openvideo';
import { createClient } from '@/lib/supabase/client';
import type { Voiceover } from '@/lib/supabase/workflow-service';
import { DEFAULT_VOICE_MAP, FALLBACK_VOICE } from '@/lib/constants/languages';

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
  voiceover?: { audioUrl: string; voiceoverId?: string } | null;
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
    if (scene.voiceover.voiceoverId) {
      audioClip.style = {
        ...audioClip.style,
        voiceoverId: scene.voiceover.voiceoverId,
      };
    }
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
  voiceoverId?: string;
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
  if (voiceover.voiceoverId) {
    audioClip.style = {
      ...audioClip.style,
      voiceoverId: voiceover.voiceoverId,
    };
  }

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

/**
 * Look up the voiceover record for a timeline audio clip.
 * Fast path: uses voiceoverId cached in clip.style.
 * Fallback: queries by audio_url matching clip.src.
 */
export async function getVoiceoverForClip(
  clip: IClip
): Promise<Voiceover | null> {
  const supabase = createClient('studio');
  const voiceoverId = (clip as any).style?.voiceoverId;

  if (voiceoverId) {
    const { data } = await supabase
      .from('voiceovers')
      .select('*')
      .eq('id', voiceoverId)
      .single();
    if (data) return data as Voiceover;
  }

  // Fallback: lookup by audio URL
  if (clip.src) {
    const { data } = await supabase
      .from('voiceovers')
      .select('*')
      .eq('audio_url', clip.src)
      .single();
    if (data) return data as Voiceover;
  }

  return null;
}

const REGEN_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Regenerate a voiceover and replace the audio clip in the timeline.
 * Returns an object with a promise for the result and an abort function for cleanup.
 */
export function regenerateVoiceover(
  studio: Studio,
  clip: IClip,
  voiceover: Voiceover
): {
  promise: Promise<{ success: boolean; error?: string }>;
  abort: () => void;
} {
  const supabase = createClient('studio');
  const oldSrc = clip.src;
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let aborted = false;

  const promise = new Promise<{ success: boolean; error?: string }>(
    (resolve) => {
      const cleanup = () => {
        if (channel) {
          supabase.removeChannel(channel);
          channel = null;
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      // Set up realtime subscription before triggering TTS
      channel = supabase
        .channel(`voiceover_regen_${voiceover.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'voiceovers',
            filter: `id=eq.${voiceover.id}`,
          },
          async (payload) => {
            const updated = payload.new as Voiceover;

            if (updated.status === 'success' && updated.audio_url) {
              cleanup();
              if (aborted) {
                resolve({ success: false, error: 'Aborted' });
                return;
              }

              try {
                await studio.timeline.replaceClipsBySource(
                  oldSrc,
                  async (oldClip) => {
                    const newClip = await Audio.fromUrl(updated.audio_url!);
                    newClip.id = oldClip.id;
                    newClip.display.from = oldClip.display.from;
                    newClip.display.to =
                      oldClip.display.from + newClip.duration;
                    newClip.volume = oldClip.volume;
                    newClip.style = {
                      ...newClip.style,
                      voiceoverId: voiceover.id,
                    };
                    return newClip;
                  }
                );
                resolve({ success: true });
              } catch (err) {
                resolve({
                  success: false,
                  error: 'Failed to replace audio clip',
                });
              }
            } else if (updated.status === 'failed') {
              cleanup();
              resolve({ success: false, error: 'Voiceover generation failed' });
            }
          }
        )
        .subscribe();

      // Timeout after 2 minutes
      timeoutId = setTimeout(() => {
        cleanup();
        resolve({ success: false, error: 'Voiceover generation timed out' });
      }, REGEN_TIMEOUT_MS);

      // Reset voiceover record and trigger TTS
      (async () => {
        try {
          await supabase
            .from('voiceovers')
            .update({ status: 'pending', audio_url: null, duration: null })
            .eq('id', voiceover.id);

          const voice = DEFAULT_VOICE_MAP[voiceover.language] ?? FALLBACK_VOICE;
          const ttsRes = await fetch('/api/workflow/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              scene_ids: [voiceover.scene_id],
              voice,
              model: 'multilingual-v2',
              language: voiceover.language,
              speed: 1.0,
            }),
          });
          const error = ttsRes.ok ? null : new Error('TTS request failed');

          if (error) {
            cleanup();
            resolve({ success: false, error: 'Failed to invoke TTS' });
          }
        } catch (err) {
          cleanup();
          resolve({ success: false, error: 'Failed to start regeneration' });
        }
      })();
    }
  );

  const abort = () => {
    aborted = true;
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return { promise, abort };
}
