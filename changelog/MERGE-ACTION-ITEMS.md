# Merge Action Items - January 24, 2026

This document tracks decisions made during the merge from `upstream/main` into `dev`.

---

## Quick Reference

| Symbol | Meaning |
|--------|---------|
| ✅ | Resolved - Keep current (dev) |
| 🔄 | Resolved - Accept incoming (vendor) |
| ⚠️ | Needs manual merge |
| 📋 | Post-merge TODO |

---

## Resolved Conflicts

### 1. `README.md`
| | |
|---|---|
| **Vendor Change** | Added documentation content |
| **Your Version** | Deleted file |
| **Decision** | 🔄 Accept vendor's version |
| **Action Taken** | `git checkout --theirs README.md` |

### 2. `editor/src/components/editor/timeline/timeline/updated.json`
| | |
|---|---|
| **Vendor Change** | Deleted file (moved functionality elsewhere) |
| **Your Version** | Modified file |
| **Decision** | 🔄 Delete file |
| **Action Taken** | `git rm` |

### 3. `editor/src/components/editor/timeline/timeline/utils.ts`
| | |
|---|---|
| **Vendor Change** | Deleted file (moved to `timeline/utils/` folder) |
| **Your Version** | Modified file |
| **Decision** | 🔄 Delete file |
| **Action Taken** | `git rm` |

### 4. `package.json`
| | |
|---|---|
| **Vendor Change** | Updated lint-staged pattern, added pnpm overrides for React types |
| **Your Version** | Array format for lint-staged |
| **Decision** | 🔄 Accept vendor's version |
| **Reason** | Better lint pattern + React type fixes needed |

### 5. `editor/src/app/page.tsx`
| | |
|---|---|
| **Vendor Change** | Full editor UI (their main page) |
| **Your Version** | Auth redirect to `/dashboard` or `/login` |
| **Decision** | ✅ Keep your version |
| **Reason** | You moved editor to `/editor/[projectId]` route |

---

## Pending Conflicts

### 6. `editor/package.json`
| | |
|---|---|
| **Vendor Change** | Removed AI/Supabase deps, biome 2.2.0 |
| **Your Version** | Has AI SDK, assistant-ui, Supabase, FAL AI, Tavily, biome ^2.2.5 |
| **Decision** | ✅ Keep yours + update biome |
| **Result** | Kept all your deps, changed biome to exact 2.2.0 |

### 7. `editor/src/components/editor/header.tsx`
| | |
|---|---|
| **Vendor Change** | Added Undo/Redo buttons, ShortcutsModal, history tracking |
| **Your Version** | Supabase save, projectId context, File menu with Save |
| **Decision** | ✅ Merged both |
| **Result** | Kept your Supabase save + added vendor's Undo/Redo & Shortcuts |

### 8. `editor/src/components/editor/media-panel/index.tsx`
| | |
|---|---|
| **Vendor Change** | Added showProperties state, flex-col layout with TabBar on top, Separator, PanelElements |
| **Your Version** | Supabase asset fetching, Assistant tab, horizontal layout |
| **Decision** | ✅ Merged both |
| **Result** | Kept Supabase fetching + Assistant tab, used vendor's layout (TabBar top) + showProperties fix, skipped PanelElements |

### 9. `editor/src/components/editor/media-panel/panel/audio-item.tsx`
| | |
|---|---|
| **Vendor Change** | Removed hover action buttons |
| **Your Version** | Has delete + add buttons on hover |
| **Decision** | ✅ Keep yours |
| **Result** | Kept hover buttons for delete/add UX |

### 10. `editor/src/components/editor/media-panel/panel/transition.tsx`
| | |
|---|---|
| **Vendor Change** | Uses `studio.addTransition()` on click, removed selection state |
| **Your Version** | Uses selection state (`selectedTransitionKey`), had bug with undefined `loaded` |
| **Decision** | ✅ Merged both |
| **Result** | Kept selection state + added vendor's addTransition on click, fixed `loaded` bug with `isHovered` |

### 11. `editor/src/components/editor/media-panel/panel/uploads.tsx`
| | |
|---|---|
| **Vendor Change** | OPFS local storage, AssetCard component, storage stats footer |
| **Your Version** | Supabase backend storage, inline JSX |
| **Decision** | ✅ Merged both |
| **Result** | Kept Supabase storage + adopted AssetCard component, skipped OPFS/storage stats |

### 12. `editor/src/components/editor/media-panel/panel/voiceovers.tsx`
| | |
|---|---|
| **Vendor Change** | Direct `Audio.fromUrl()` + `studio.addClip()` |
| **Your Version** | Uses `addMediaToCanvas()` helper |
| **Decision** | ✅ Keep yours |
| **Result** | Kept helper function pattern, consistent with other files |

### 13. `editor/src/components/editor/preview-panel.tsx`
| | |
|---|---|
| **Vendor Change** | Simplified init, removed Supabase, added `spacing: 20` to Studio |
| **Your Version** | Supabase loading with `loadTimeline` + fallback to updated.json |
| **Decision** | ✅ Merged both |
| **Result** | Kept Supabase loading, removed fallback (updated.json deleted), kept vendor's `spacing: 20` |

### 14. `editor/src/components/editor/timeline/index.tsx`
| | |
|---|---|
| **Vendor Change** | Simplified first-track top separator |
| **Your Version** | Had duplicate track label code inside first-track block |
| **Decision** | 🔄 Accept vendor |
| **Result** | Fixed duplicate code, removed unused `TRACK_ACCENT_COLORS` constant |

### 15. `editor/src/components/editor/timeline/timeline-studio-sync.tsx`
| | |
|---|---|
| **Vendor Change** | Added `StudioClip` type alias, removed `jsonToClip` and `toast` |
| **Your Version** | Has `toast` for transition error, had unused `jsonToClip` |
| **Decision** | ✅ Merged both |
| **Result** | Kept `toast` (used for transition error), added `StudioClip` type, removed unused `jsonToClip` |

### 16. `pnpm-lock.yaml`
| | |
|---|---|
| **Vendor Change** | Updated dependencies |
| **Your Version** | Your dependencies |
| **Decision** | 🔄 Regenerated |
| **Result** | Deleted and regenerated with `pnpm install` |

---

## Post-Merge TODOs

These are improvements from vendor that you may want to add AFTER the merge is complete:

### 📋 Optional: Add FloatingControl to your editor
**File:** `editor/src/app/editor/[projectId]/page.tsx`

**What it does:** Adds floating control UI for caption presets and other quick actions.

**How to add:**
```tsx
import FloatingControl from '@/components/editor/floating-controls/floating-control';

// Inside your MediaPanel's ResizablePanel:
<ResizablePanel ...>
  <MediaPanel />
  <FloatingControl />  {/* Add this line */}
</ResizablePanel>
```

### 📋 Optional: Add overflow-visible class
**File:** `editor/src/app/editor/[projectId]/page.tsx`

**What it does:** Allows dropdowns/popovers to overflow outside the panel.

**How to add:**
```tsx
<ResizablePanel
  ...
  className="min-w-96 rounded-sm relative overflow-visible! bg-panel"
>
```

---

## Merge Commands Reference

```bash
# Check remaining conflicts
git status --short | grep "^UU\|^UD\|^DU"

# After resolving all conflicts
pnpm install
pnpm build

# Commit the merge
git add .
git commit -m "Merge upstream/main vendor updates (v0.1.11 → v0.1.16)"
```
