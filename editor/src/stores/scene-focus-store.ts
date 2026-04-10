import { create } from 'zustand';

/**
 * Lightweight store for cross-panel scene focus.
 * When a scene is focused (e.g. from timeline clip selection),
 * the Storyboard panel scrolls to and expands that scene card.
 */

interface SceneFocusState {
  /** Currently focused scene ID, or null */
  focusedSceneId: string | null;
  /** Focus a specific scene (triggers scroll + expand in storyboard) */
  focusScene: (sceneId: string) => void;
  /** Clear focus */
  clearSceneFocus: () => void;
}

export const useSceneFocusStore = create<SceneFocusState>((set) => ({
  focusedSceneId: null,
  focusScene: (sceneId) => set({ focusedSceneId: sceneId }),
  clearSceneFocus: () => set({ focusedSceneId: null }),
}));
