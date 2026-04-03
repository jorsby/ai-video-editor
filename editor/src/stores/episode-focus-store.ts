import { create } from 'zustand';

/**
 * Lightweight store for cross-panel episode focus.
 * When an episode is focused (e.g. from Storyboard/Roadmap),
 * the Assets panel can filter to show only that episode's used assets.
 */

interface EpisodeFocusState {
  /** Currently focused episode ID, or null for "show all" */
  focusedEpisodeId: string | null;
  /** Variant slugs used by the focused episode (from asset_variant_map) */
  focusedVariantSlugs: Set<string>;
  /** Set focus to a specific episode */
  setFocus: (episodeId: string, variantSlugs: string[]) => void;
  /** Clear focus — show all assets */
  clearFocus: () => void;
}

export const useEpisodeFocusStore = create<EpisodeFocusState>((set) => ({
  focusedEpisodeId: null,
  focusedVariantSlugs: new Set(),
  setFocus: (episodeId, variantSlugs) =>
    set({
      focusedEpisodeId: episodeId,
      focusedVariantSlugs: new Set(variantSlugs),
    }),
  clearFocus: () =>
    set({ focusedEpisodeId: null, focusedVariantSlugs: new Set() }),
}));
