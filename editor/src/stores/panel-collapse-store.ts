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
        // Toggle: expand all ↔ collapse all
        const next = current === true ? false : true;
        set({ panels: { ...get().panels, [panel]: next } });
      },
      getForceOpen: (panel: string) => {
        const val = get().panels[panel];
        if (val === true) return true; // force expanded
        if (val === false) return false; // force collapsed
        return null; // individual
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
