# Frontend Canonical UI Plan

**Date:** 2026-03-30
**Status:** DRAFT — pending Serhat review
**Goal:** Move the real product UI onto the approved canonical dataset so Serhat can enter the normal UI and see the real sample project/series/assets/episodes/scenes without using dev-only inspector screens.

---

## Core rule

**UI first.**

Order:
1. Frontend reads the new canonical dataset
2. Real-time updates work without refresh
3. Existing cards/tabs/shells are adapted to the new model
4. Only after UI review do we continue endpoint-by-endpoint cleanup/review

---

## Approved canonical model

```txt
Project
└─ Series[]
   ├─ SeriesAssets[]
   │  └─ SeriesAssetVariants[]
   └─ Episodes[]
      └─ Scenes[]
```

Canonical field decisions already approved:
- `series.creative_brief`
- `episodes.asset_variant_map`
- `series_asset_variants.slug` is the canonical variant token
- scene fields:
  - `location_variant_slug`
  - `character_variant_slugs`
  - `prop_variant_slugs`
- statuses use `in_progress`
- no storyboard-first product model

---

## What the frontend must do

### A) Dashboard / project discovery
When Serhat opens the normal UI, the sample project must appear in the real project list.

Needs:
- dashboard project list must read the current `projects` table correctly
- remove assumptions about removed fields like `archived_at` if they no longer exist in canonical schema
- opening a project should lead into the canonical series/episode/scene flow, not a storyboard-era path

### B) Series view
Series screen should show:
- project/series identity
- `creative_brief`
- assets grouped by type
- variants under each asset
- episode list
- episode statuses

### C) Episode / scene view
Episode/editor surface should show:
- episode header + metadata
- `asset_variant_map`
- scenes list/cards
- scene variant-slug refs
- prompt/audio/video/status visibility

### D) Real-time updates
If Serhat changes something, UI should update without manual refresh.

Preferred implementation:
- Supabase Realtime subscriptions
- subscribe at the project/series level for:
  - `projects`
  - `series`
  - `series_assets`
  - `series_asset_variants`
  - `episodes`
  - `scenes`
- merge realtime updates into local client state/store
- fallback: route refresh only if a specific surface is too server-heavy to patch live in this phase

**Rule:** realtime should be product-visible, not just dev-tool visible.

---

## Reuse strategy (do not invent a brand-new UI unnecessarily)

Use existing shells/components where possible.

### Reuse targets
- dashboard project shell
  - `editor/src/components/dashboard/project-card.tsx`
  - `editor/src/components/dashboard/project-list.tsx`
- series shell
  - `editor/src/components/series/series-content.tsx`
- assets shell
  - `editor/src/components/editor/media-panel/panel/series-assets-panel.tsx`
- roadmap shell
  - `editor/src/components/editor/media-panel/panel/series-roadmap-panel.tsx`
- scene cards
  - `editor/src/components/editor/media-panel/panel/scene-card.tsx`

### Replace / remove assumptions
- stop treating storyboard as the main product container
- treat episode as the primary container
- tabs/cards must read canonical episode+scene data, not storyboard-era intermediate objects

---

## Phase plan

## Phase 1 — Dashboard + project visibility

### Goal
Make the real sample project visible in the normal dashboard.

### Tasks
- fix `/api/projects` + dashboard project list so canonical projects appear
- remove old field filters/assumptions blocking visibility
- confirm sample project is clickable from normal UI

### Done when
- Serhat opens `/dashboard`
- sees `Schema Inspector Review: Neon Backroads`
- can click into the real project flow

---

## Phase 2 — Series screen on canonical data

### Goal
Make the normal series/product screen read canonical `series + assets + variants + episodes`.

### Tasks
- bind series screen to canonical tables/fields
- show `creative_brief`
- show assets grouped by `character / location / prop`
- show variants under each asset
- show episode list and statuses
- remove storyboard-first loading assumptions where they block the screen

### Done when
- Serhat can enter the series screen from normal UI
- sees real DB sample data there
- no dev-inspector required

---

## Phase 3 — Episode / scene UI migration

### Goal
Adapt the current editor/storyboard-style UI so it matches the canonical episode+scene model.

### Tasks
- episode becomes the primary parent object
- adapt scene cards to read:
  - `location_variant_slug`
  - `character_variant_slugs`
  - `prop_variant_slugs`
  - `prompt`
  - `audio_text`
  - `audio_url`
  - `video_url`
  - `status`
- adapt asset tabs/panels to the new `asset_variant_map`
- keep visualization rich: slugs, prompts, status badges, variant chips, JSON where useful

### Done when
- the normal editor UI shows episode + scene data correctly
- existing cards feel reused, not rebuilt from scratch
- storyboard-era mismatch is no longer visible in the main path

---

## Phase 4 — Realtime layer

### Goal
UI updates without refresh.

### Tasks
- add Supabase Realtime subscriptions for the active project/series/episode scope
- update state/store on insert/update/delete events
- ensure scene status / prompt / media URL / episode status changes appear live
- ensure asset + variant edits appear live too

### Done when
- Serhat edits data and the screen updates automatically
- no manual refresh needed for normal edits/status changes

---

## Phase 5 — UI review round

### Goal
Review the normal UI, not the dev inspector.

### Tasks
- Serhat reviews the real product UI against the real sample dataset
- capture keep / rename / move / remove / missing notes
- adjust UI grouping/labels only after seeing it in the real screen

### Done when
- Serhat says the normal UI is showing the canonical model correctly
- only then continue endpoint-by-endpoint API review/cleanup

---

## Phase 6 — Endpoint review after UI sign-off

### Goal
Review and tighten endpoints only after the frontend view is accepted.

### Tasks
- inspect remaining endpoint mismatches from the real UI usage path
- remove temporary compatibility aliases when safe
- clean remaining legacy endpoints systematically

---

## Realtime implementation note

Preferred technical direction:
- keep server fetch for initial load
- hydrate into client state/store
- attach Supabase Realtime channel subscriptions for current scope
- patch local state on change events

This gives:
- fast initial render
- no refresh requirement
- controlled migration without rebuilding the entire frontend architecture

---

## Immediate next execution order

1. **Phase 1** — dashboard project visibility
2. **Phase 2** — series screen canonical data
3. **Phase 3** — episode/scene UI migration
4. **Phase 4** — realtime subscriptions
5. **Phase 5** — Serhat review in real UI
6. **Phase 6** — endpoint review/cleanup

---

## Important non-goals for this plan

- no new dev-only review surfaces
- no new schema redesign
- no broad backend refactor before the frontend is visible
- no “storyboard as primary object” comeback

---

## One-line summary

**Make the real product UI show the approved canonical dataset first; then make it live/realtime; then review endpoints.**
