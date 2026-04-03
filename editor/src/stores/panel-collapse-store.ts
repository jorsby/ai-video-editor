import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Persistent collapse/expand state for panel sections.
 * Survives tab switches and page reloads (localStorage).
 */

interface PanelCollapseState {
  /** Per-panel "all collapsed" flag: true = all collapsed, false = all expanded, null = individual */
  panels: Record<string, boolean | null>;
  /** Set all sections in a panel to collapsed or expanded */
  toggleAll: (panel: string) => void;
  /** Get the forced state for a panel (null = individual control) */
  getForceOpen: (panel: string) => boolean | null;
  /** Reset to individual control (called after sections respond to force) */
  resetForce: (panel: string) => void;
}

export const usePanelCollapseStore = create<PanelCollapseState>()(
  persist(
    (set, get) => ({
      panels: {},
      toggleAll: (panel: string) => {
        const current = get().panels[panel];
        // null/false → true (expand), true → false (collapse)
        // But we want: click = toggle. If expanded or null → collapse. If collapsed → expand.
        const next = current === false ? null : false;
        set({ panels: { ...get().panels, [panel]: next } });
      },
      getForceOpen: (panel: string) => {
        const val = get().panels[panel];
        if (val === false) return false; // force collapsed
        if (val === null || val === undefined) return null; // individual
        return null;
      },
      resetForce: (panel: string) => {
        set({ panels: { ...get().panels, [panel]: null } });
      },
    }),
    {
      name: 'panel-collapse-state',
      partialize: (state) => ({ panels: state.panels }),
    }
  )
);
