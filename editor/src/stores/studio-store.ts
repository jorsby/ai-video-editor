import { create } from 'zustand';
import type { Studio, IClip } from 'openvideo';

interface PendingTransitionClipIds {
  fromClipId: string;
  toClipId: string;
}

interface StudioState {
  studio: Studio | null;
  setStudio: (studio: Studio | null) => void;
  selectedClips: IClip[];
  setSelectedClips: (clips: IClip[]) => void;
  selectedTransitionKeys: string[];
  toggleTransitionKey: (key: string) => void;
  clearTransitionKeys: () => void;
  pendingTransitionClipIds: PendingTransitionClipIds | null;
  setPendingTransitionClipIds: (ids: PendingTransitionClipIds | null) => void;
  isExporting: boolean;
  setIsExporting: (v: boolean) => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  studio: null,
  setStudio: (studio) => set({ studio }),
  selectedClips: [],
  setSelectedClips: (clips) => set({ selectedClips: clips }),
  selectedTransitionKeys: [],
  toggleTransitionKey: (key) =>
    set((state) => ({
      selectedTransitionKeys: state.selectedTransitionKeys.includes(key)
        ? state.selectedTransitionKeys.filter((k) => k !== key)
        : [...state.selectedTransitionKeys, key],
    })),
  clearTransitionKeys: () => set({ selectedTransitionKeys: [] }),
  pendingTransitionClipIds: null,
  setPendingTransitionClipIds: (ids) => set({ pendingTransitionClipIds: ids }),
  isExporting: false,
  setIsExporting: (v) => set({ isExporting: v }),
}));
