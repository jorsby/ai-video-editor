import { create } from 'zustand';

/**
 * Lightweight store for cross-panel chapter focus.
 * When an chapter is focused (e.g. from Storyboard/Roadmap),
 * the Assets panel can filter to show only that chapter's used assets.
 */

interface ChapterFocusState {
  /** Currently focused chapter ID, or null for "show all" */
  focusedChapterId: string | null;
  /** Variant slugs used by the focused chapter (from asset_variant_map) */
  focusedVariantSlugs: Set<string>;
  /** Set focus to a specific chapter */
  setFocus: (chapterId: string, variantSlugs: string[]) => void;
  /** Clear focus — show all assets */
  clearFocus: () => void;
}

export const useChapterFocusStore = create<ChapterFocusState>((set) => ({
  focusedChapterId: null,
  focusedVariantSlugs: new Set(),
  setFocus: (chapterId, variantSlugs) =>
    set({
      focusedChapterId: chapterId,
      focusedVariantSlugs: new Set(variantSlugs),
    }),
  clearFocus: () =>
    set({ focusedChapterId: null, focusedVariantSlugs: new Set() }),
}));
