import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Persistent video selection per project.
 * Survives tab switches and page reloads (localStorage).
 */
interface VideoSelectorState {
  /** Map: projectId → selected videoId */
  selections: Record<string, string>;
  getVideoId: (projectId: string) => string | null;
  setVideoId: (projectId: string, videoId: string) => void;
}

export const useVideoSelectorStore = create<VideoSelectorState>()(
  persist(
    (set, get) => ({
      selections: {},
      getVideoId: (projectId: string) => get().selections[projectId] ?? null,
      setVideoId: (projectId: string, videoId: string) =>
        set({
          selections: { ...get().selections, [projectId]: videoId },
        }),
    }),
    {
      name: 'video-selector-state',
      partialize: (state) => ({ selections: state.selections }),
    }
  )
);
