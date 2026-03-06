import { create } from 'zustand';
import type { PlaybackState, PlaybackControls } from '@/types/playback';
import { useStudioStore } from '@/stores/studio-store';

interface PlaybackStore extends PlaybackState, PlaybackControls {
  setDuration: (duration: number) => void;
  setCurrentTime: (time: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
}

export const usePlaybackStore = create<PlaybackStore>((set, get) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  previousVolume: 1,
  speed: 1.0,

  play: async () => {
    const { studio } = useStudioStore.getState();
    if (!studio) return;
    await studio.play();
    set({ isPlaying: true });
  },

  pause: () => {
    const { studio } = useStudioStore.getState();
    if (!studio) return;
    studio.pause();
    set({ isPlaying: false });
  },

  toggle: () => {
    const { isPlaying } = get();
    if (isPlaying) {
      get().pause();
    } else {
      get().play();
    }
  },

  seek: (time: number) => {
    const { studio } = useStudioStore.getState();
    const { duration } = get();
    // Clamp time
    const clampedTime = Math.max(0, Math.min(duration, time));

    if (studio) {
      // Convert seconds to microseconds
      studio.seek(clampedTime * 1_000_000);
    }

    // Optimistic update
    set({ currentTime: clampedTime });
  },

  setVolume: (volume: number) => {
    const clamped = Math.max(0, Math.min(1, volume));
    const { studio } = useStudioStore.getState();
    if (studio) {
      studio.transport.setVolume(clamped);
      studio.transport.setMuted(clamped === 0);
    }
    set((state) => ({
      volume: clamped,
      muted: clamped === 0,
      previousVolume: clamped > 0 ? clamped : state.previousVolume,
    }));
  },

  setSpeed: (speed: number) => {
    const newSpeed = Math.max(0.1, Math.min(2.0, speed));
    const { studio } = useStudioStore.getState();
    if (studio) {
      studio.transport.setSpeed(newSpeed);
    }
    set({ speed: newSpeed });
  },

  setDuration: (duration: number) => set({ duration }),
  setCurrentTime: (time: number) => set({ currentTime: time }),
  setIsPlaying: (isPlaying: boolean) => set({ isPlaying }),
}));
