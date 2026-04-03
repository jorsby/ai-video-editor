import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Persistent series selection per project.
 * Survives tab switches and page reloads (localStorage).
 */
interface SeriesSelectorState {
  /** Map: projectId → selected seriesId */
  selections: Record<string, string>;
  getSeriesId: (projectId: string) => string | null;
  setSeriesId: (projectId: string, seriesId: string) => void;
}

export const useSeriesSelectorStore = create<SeriesSelectorState>()(
  persist(
    (set, get) => ({
      selections: {},
      getSeriesId: (projectId: string) =>
        get().selections[projectId] ?? null,
      setSeriesId: (projectId: string, seriesId: string) =>
        set({
          selections: { ...get().selections, [projectId]: seriesId },
        }),
    }),
    {
      name: 'series-selector-state',
      partialize: (state) => ({ selections: state.selections }),
    }
  )
);
