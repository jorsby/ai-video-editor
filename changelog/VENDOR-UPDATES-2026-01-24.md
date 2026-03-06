# Vendor Updates Report - January 24, 2026

## Summary
Updates from **designcombo/ai-video-editor** upstream repository.
- **Version Range**: v0.1.11 → v0.1.16
- **Total Commits**: 57 new commits
- **Files Changed**: 126 files
- **Lines Added**: ~10,417
- **Lines Removed**: ~3,685

---

## 🎯 Major Features

### 1. History Manager (Undo/Redo System) ⭐
**Files**: `packages/video/src/studio/history-manager.ts`, `packages/video/src/studio.ts`

A complete undo/redo system using diff-based patches:
- Uses `microdiff` library for efficient state diffing
- Configurable history size (default: 50 states)
- History grouping for batch operations (`beginHistoryGroup()` / `endHistoryGroup()`)
- New events: `history:changed` with `canUndo` and `canRedo` states
- Integrated into Studio class with automatic history tracking

```typescript
// New Studio methods:
studio.history.undo(currentState)
studio.history.redo(currentState)
studio.beginHistoryGroup()
studio.endHistoryGroup()
```

### 2. OPFS (Origin Private File System) Persistence ⭐
**Files**: `editor/src/lib/storage/storage-service.ts`, `editor/src/components/editor/media-panel/panel/uploads.tsx`

Persistent file storage for uploads panel:
- Files persist across browser sessions
- Uses Origin Private File System API
- Project-specific media adapters
- Combined IndexedDB (metadata) + OPFS (file blobs) approach
- Storage stats with quota tracking

### 3. Track Ordering / Reordering ⭐
**Files**: `packages/video/src/studio.ts`, `packages/video/src/studio/timeline-model.ts`

- New event: `track:order-changed`
- Track index management in history
- Updated timeline UI to support track reordering

### 4. Keyboard Shortcuts Modal
**File**: `editor/src/components/editor/shortcuts-modal.tsx` (new file, 143 lines)

New shortcuts modal UI component with `Kbd` component for keyboard styling.

---

## 🔧 Core Package Changes (`packages/video`)

### Clip Renaming (Breaking Change)
All clip classes have been renamed to simpler names:

| Old Name | New Name |
|----------|----------|
| `VideoClip` | `Video` |
| `ImageClip` | `Image` |
| `TextClip` | `Text` |
| `CaptionClip` | `Caption` |
| `EffectClip` | `Effect` |
| `TransitionClip` | `Transition` |
| `AudioClip` | `Audio` |

### Studio Class Updates
- New `spacing` option in `IStudioOpts`
- History management integration
- Clip caching with `clipCache` Map
- New methods: `beginHistoryGroup()`, `endHistoryGroup()`
- Private flags: `historyPaused`, `processingHistory`, `historyGroupDepth`
- Event signature update: `track:added` now includes optional `index`

### Timeline Model Enhancements
- Significant expansion (~434 lines → more)
- Track ordering support
- Improved clip management

### JSON Serialization Updates
- Transition links restoration fix (from JSON loading)
- Updated clip type handling

### Performance Improvements
- Improved scaling and centering utils (`a25e2789`)
- Better import from JSON performance
- Multiple clips editing performance boost

---

## 🎨 Editor UI Changes

### Header Component
**File**: `editor/src/components/editor/header.tsx`
- Major refactoring (~84 line changes)
- Updated layout

### Timeline Component
**File**: `editor/src/components/editor/timeline/index.tsx`
- Significant changes (~328 line changes)
- Timeline UI updates
- Improved scrollbar behavior
- Timeline item size refactoring

### Timeline Canvas
**File**: `editor/src/components/editor/timeline/timeline/canvas.ts`
- Major updates (~516 line changes)
- Performance improvements

### Clip Rendering Updates
All timeline clips updated:
- `clips/video.ts` - Major rewrite (~485 line changes), filmstrip improvements
- `clips/image.ts` - Custom image clip support (~128 lines)
- `clips/caption.ts` - New caption clip renderer (96 lines)
- `clips/audio.ts` - Minor updates
- `clips/text.ts` - Minor updates
- `clips/transition.ts` - Significant updates (~77 lines)
- `clips/effect.ts` - Minor updates

### New Utilities
- `timeline/utils/filmstrip.ts` - Video filmstrip generation (68 lines)
- `timeline/utils/thumbnail-cache.ts` - Thumbnail caching (23 lines)
- `timeline/scrollbar/util.ts` - Scrollbar utilities (148 lines)

### Media Panel Changes
- **Captions panel**: Major refactoring (~956 lines, significant reduction)
- **Uploads panel**: OPFS integration (~515 line changes)
- **Transitions panel**: Updated UI
- **Effects panel**: Minor updates
- **Videos panel**: Improvements
- **Images panel**: Improvements

### Properties Panel
- New `effect-properties.tsx` (55 lines)
- New `transition-properties.tsx` (132 lines)

### Preview Panel
- Updates for artboard spacing
- Zoom and layout improvements

---

## 📚 Documentation Added

### New `docs/` Directory
Complete documentation site added:
- Installation guide
- Basic usage
- API reference
- Clips documentation
- Tracks documentation
- Transitions documentation
- Effects documentation
- Events documentation
- Animations documentation
- Serialization documentation
- Rendering documentation
- Studio documentation

### ANTIGRAVITY.md
Project overview, structure, tech stack, and coding conventions (53 lines)

---

## 🐛 Bug Fixes

1. **Transition Links Restoration** (`cee2cf3e`)
   - Fixed: Transition links on target clips now restore correctly when loading from JSON

2. **Video Thumbnail Race Condition** (`d746e716`)
   - Fixed: Race condition errors with video thumbnails resolved

3. **Video Duration Fix** (`ee8a4f43`)
   - Fixed: Duration calculation for video items

4. **Scrollbar Behavior** (`f4ab5019`)
   - Fixed: Timeline scrollbar behavior issues

5. **Image Clip Blob URLs** (`a0ecd881`)
   - Fixed: Image clips now properly load blob URLs

6. **Apply Transitions on Studio** (`1dcaf382`)
   - Fixed: Transition application in studio

7. **React Types Mismatch** (`975cd72f`)
   - Fixed: React type mismatches resolved

---

## 📦 Dependency Updates

### New Dependencies
- `microdiff` - For history diffing

### Package Updates
- `packages/video/package.json` - Version updates
- `pnpm-lock.yaml` - Major updates (~3590 line changes)

---

## 🗑️ Removed Files

- `editor/src/hooks/use-clip-propertiesxxxx.ts` (137 lines removed)
- `editor/src/components/editor/timeline/timeline/updated.json` (352 lines removed)
- `editor/src/components/editor/timeline/timeline/utils.ts` (56 lines removed)
- `editor/src/components/editor/timeline/timeline/data.ts` - Partial removal

---

## ⚠️ Breaking Changes Summary

1. **Clip Class Renames**: All clip classes renamed (VideoClip → Video, etc.)
2. **Event Signature Changes**: `track:added` now has optional `index` parameter
3. **New History Events**: Components may need to listen to `history:changed`
4. **Studio Constructor**: New `spacing` option added

---

## 📋 Recommended Integration Steps

1. **Update Clip Imports**
   ```typescript
   // Before
   import { VideoClip, ImageClip } from '@designcombo/video';
   // After
   import { Video, Image } from '@designcombo/video';
   ```

2. **Handle History Events** (if using undo/redo UI)
   ```typescript
   studio.on('history:changed', ({ canUndo, canRedo }) => {
     // Update UI buttons
   });
   ```

3. **Test Transition Loading**
   - Verify existing saved projects load correctly with transition links

4. **Review Custom Components**
   - If you have custom timeline clips, review the new base implementations

---

## 🔍 Files to Review Manually

These files have significant changes that may conflict with your customizations:

| File | Priority | Reason |
|------|----------|--------|
| `packages/video/src/studio.ts` | HIGH | Core changes, history integration |
| `packages/video/src/studio/timeline-model.ts` | HIGH | Track ordering |
| `editor/src/components/editor/timeline/index.tsx` | HIGH | Major UI changes |
| `editor/src/components/editor/media-panel/panel/uploads.tsx` | MEDIUM | OPFS integration |
| `editor/src/components/editor/media-panel/panel/captions.tsx` | MEDIUM | Major refactoring |
| `editor/src/components/editor/header.tsx` | MEDIUM | Layout changes |

---

## Git Commands Reference

```bash
# Your backup branch
backup-dev-20260124-012533

# View specific commit
git show <commit-hash>

# View file at upstream version
git show upstream/main:<filepath>

# Compare specific file
git diff dev upstream/main -- <filepath>

# Cherry-pick specific commits
git cherry-pick <commit-hash>

# Merge specific features
git checkout dev
git merge upstream/main --no-commit
# Review and commit selectively
```
