import { create } from 'zustand';

export interface ClipboardEntry {
  json: any;
  sourceTrackId: string;
  displayFrom: number;
  duration: number;
}

interface ClipboardStore {
  entries: ClipboardEntry[];
  setEntries: (entries: ClipboardEntry[]) => void;
  clear: () => void;
}

export const useClipboardStore = create<ClipboardStore>((set) => ({
  entries: [],
  setEntries: (entries) => set({ entries }),
  clear: () => set({ entries: [] }),
}));
