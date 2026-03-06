# Vendor Changes Report

**Comparison:** `prod` (your branch) → `main` (vendor's latest)
**Date:** January 14, 2026
**Total Commits:** 17 new commits
**Contributors:** Dany Boza, pablituuu, luis-ar, Octupost App

---

## Executive Summary

The vendor has made **significant architectural and feature changes** to the codebase. The main highlights include:

1. **Monorepo Restructuring** - Project converted to a monorepo with separate packages
2. **New Core Video Library** - `@designcombo/video` package for video processing
3. **Node.js Renderer** - `@designcombo/node` package for server-side rendering
4. **Caption Presets System** - New preset-based caption styling
5. **Stock Media Integration** - Pexels API integration for stock images/videos
6. **Music & SFX Libraries** - New audio content panels
7. **Performance Improvements** - Multiple optimizations for clips and JSON import
8. **Bug Fixes** - Audio export fix

---

## Major Changes

### 1. Monorepo Architecture (Breaking Change)

**Commit:** `f25d4b0` - "added packages"

The project has been restructured from a single Next.js app to a **monorepo** with multiple packages:

```
├── editor/          # Next.js web editor (moved from root)
├── packages/
│   ├── video/       # @designcombo/video - Core video library
│   └── node/        # @designcombo/node - Server-side renderer
├── turbo.json       # Turborepo configuration
└── pnpm-workspace.yaml
```

**Impact:**
- All editor source files moved from `src/` to `editor/src/`
- Root `package.json` now manages the workspace
- Build system uses Turborepo for monorepo orchestration
- pnpm workspace configuration added

**Files Changed:** 258 files, +35,973 / -1,089 lines

---

### 2. New `@designcombo/video` Package

**Location:** `packages/video/`

A comprehensive video rendering and processing library with:

- **Clip Types:** Video, Audio, Image, Text, Caption, Effect, Transition
- **Video Compositor** - WebCodecs-based rendering engine
- **Timeline Model** - Track and clip management
- **Effects System** - GLSL-based visual effects
- **Transitions** - GL Transitions support
- **Sprite Rendering** - PixiJS-based sprite system
- **Transformer** - Interactive clip manipulation
- **JSON Serialization** - Import/export project state

**Key Dependencies:**
- `pixi.js` - 2D WebGL renderer
- `gl-transitions` - Video transitions
- `opfs-tools` - File system utilities
- `wave-resampler` - Audio processing

---

### 3. New `@designcombo/node` Package

**Location:** `packages/node/`

Server-side video rendering using Playwright and WebCodecs:

**Features:**
- Self-contained (no external server required)
- Automatic browser setup via Playwright
- JSON-based video configuration
- Progress events during rendering
- Hardware-accelerated via WebCodecs

**Use Case:** Automated video generation, batch processing, API-driven rendering

---

### 4. Caption Presets System

**Commits:** `33e29a1`, `469ec51`
**Authors:** luis-ar, Dany Boza

New UI system for applying preset caption styles:

**New Files:**
- `editor/src/components/editor/constant/caption.ts` - Preset definitions
- `editor/src/components/editor/floating-controls/caption-preset-picker.tsx` - Picker UI
- `editor/src/components/editor/floating-controls/floating-control.tsx` - Control wrapper
- `editor/src/components/editor/interface/captions.ts` - Caption interfaces
- `editor/src/components/editor/store/use-layout-store.ts` - Layout state
- `editor/src/components/ui/tabs.tsx` - Tab component

**Modified:**
- `packages/video/src/clips/caption-clip.ts` - Extended caption clip capabilities
- `editor/src/components/editor/properties-panel/caption-properties.tsx` - Properties panel

---

### 5. Stock Media Integration (Pexels)

**Commit:** `671f1e4`
**Author:** Dany Boza

Integration with Pexels API for royalty-free stock content:

**New Files:**
- `editor/src/app/api/pexels/route.ts` - Pexels API endpoint
- `editor/src/components/editor/media-panel/panel/images.tsx` - Stock images panel
- `editor/src/components/editor/media-panel/panel/videos.tsx` - Stock videos panel

**Changes:**
- `visuals.tsx` renamed to `uploads.tsx` - Now dedicated to user uploads
- Media panel tabs reorganized: Images, Videos, Uploads (separate)
- Environment variable: `PEXELS_API_KEY` required

**Removed (AI Assistant Integration):**
- All `assistant-ui/` components deleted
- AI chat route removed
- AI-related dependencies removed from package.json

---

### 6. Music & SFX Libraries

**Commit:** `5e6c510`
**Author:** Dany Boza

New audio content panels with pre-loaded audio libraries:

**New Files:**
- `editor/src/app/api/audio/music/route.ts` - Music API endpoint
- `editor/src/app/api/audio/sfx/route.ts` - SFX API endpoint

**Enhanced Panels:**
- `editor/src/components/editor/media-panel/panel/music.tsx` - Music browser (+123 lines)
- `editor/src/components/editor/media-panel/panel/sfx.tsx` - Sound effects browser (+125 lines)

---

## Performance Improvements

### 7. Import from JSON Performance

**Commit:** `01d11d1`
**Author:** Dany Boza

Optimizations for loading project JSON:

- Improved `timeline-model.ts` (+280/-107 lines)
- Enhanced `studio.ts` initialization
- Optimized `timeline-studio-sync.tsx` synchronization

### 8. Editing Multiple Clips Performance

**Commit:** `a566df8`
**Author:** Dany Boza

Better handling of multi-clip operations:

- `caption-preset-picker.tsx` - Optimized preset application
- `studio.ts` - Batch update improvements
- `timeline-model.ts` - Efficient multi-clip editing

### 9. Add Clips Performance

**Commit:** `5e03803`
**Author:** Dany Boza

Faster clip addition to timeline:

- `timeline-studio-sync.tsx` - Sync optimization (+56 lines)
- `timeline-model.ts` - Add operation improvements

---

## Bug Fixes

### 10. Export Audio Item Fix

**Commit:** `bcbfaa4`
**Author:** pablituuu

Fixed audio export issues:

- `packages/video/src/clips/audio-clip.ts` - Refactored audio handling (+40/-39 lines)

---

## UI/UX Improvements

### 11. Header Update

**Commit:** `b3dfe28`
**Author:** Dany Boza

- Updated editor header styling
- Added shared logo components
- Caption utility improvements

### 12. Sidebar Styling

**Commit:** `de5ce42`
**Author:** Dany Boza

- Improved images panel styling
- Enhanced uploads panel layout
- Better videos panel presentation

---

## Housekeeping

### 13. Code Formatting

**Commit:** `681aff9` - Formatted `audio-clip.ts`

### 14. Lock Files Cleanup

**Commit:** `da5c568` - Removed unused lock files, renamed editor

### 15. Package Entrypoint Updates

**Commits:** `e93d070`, `820b801`, `1d5cfb8` - Updated package exports configuration

---

## Files Summary

| Category | Added | Modified | Deleted | Renamed |
|----------|-------|----------|---------|---------|
| Editor App | 15 | 30 | 20 | 100+ |
| Video Package | 50+ | - | - | - |
| Node Package | 10+ | - | - | - |
| Config Files | 5 | 8 | 2 | - |

**Total:** 273 files changed, +30,508 / -4,497 lines

---

## Breaking Changes Checklist

1. **Directory Structure** - All imports from `src/` need updating to `editor/src/`
2. **Package Dependencies** - New workspace setup requires `pnpm install` from root
3. **Environment Variables** - New `PEXELS_API_KEY` required for stock media
4. **AI Assistant Removed** - All assistant-ui components deleted
5. **Media Panel Tabs** - Reorganized (Images, Videos, Uploads now separate)

---

## Migration Notes

To update your branch to include these changes:

1. **Backup your changes** - Note any custom modifications
2. **Merge main** - `git merge main` (expect conflicts in restructured files)
3. **Resolve conflicts** - Focus on:
   - Files moved to `editor/` directory
   - Media panel component changes
   - Package.json dependencies
4. **Install dependencies** - `pnpm install` from root
5. **Set environment** - Add `PEXELS_API_KEY` to `.env`
6. **Test build** - `pnpm build` to verify monorepo setup

---

## Commit Timeline (Chronological)

| Date | Commit | Author | Description |
|------|--------|--------|-------------|
| Jan 13 | `f25d4b0` | Dany Boza | Added packages (monorepo setup) |
| Jan 13 | `3f87585` | Dany Boza | Update readme |
| Jan 13 | `b3dfe28` | Dany Boza | Editor: update header |
| Jan 13 | `671f1e4` | Dany Boza | Integrate stock images and videos |
| Jan 13 | `de5ce42` | Dany Boza | Editor: improve sidebar styling |
| Jan 13 | `e93d070` | Dany Boza | Update package entrypoint |
| Jan 13 | `da5c568` | Dany Boza | Remove unused lock files |
| Jan 13 | `33e29a1` | luis-ar | Implement preset captions |
| Jan 13 | `5e6c510` | Dany Boza | Add music and sfx |
| Jan 13 | `469ec51` | Dany Boza | Add caption presets |
| Jan 13 | `bcbfaa4` | pablituuu | Fix: export audio item |
| Jan 14 | `5e03803` | Dany Boza | Improve add clips performance |
| Jan 14 | `681aff9` | Dany Boza | Format code |
| Jan 14 | `a566df8` | Dany Boza | Improve performance editing multiple clips |
| Jan 14 | `01d11d1` | Dany Boza | Improve import from json performance |
| Jan 14 | `820b801` | Dany Boza | Update package entrypoint |
| Jan 14 | `1d5cfb8` | Octupost App | Vendor push |

---

*Generated: January 14, 2026*
