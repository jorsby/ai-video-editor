# API Rewiring Plan — Simplified Schema (Phase Track)

## Context

Schema reset is now live and approved (real DB reset + real seed verified). This plan tracks the incremental API rewiring from legacy storyboard-era tables to the approved canonical model:

- `video.creative_brief`
- `chapters.asset_variant_map`
- variant slug as canonical cross-entity reference
- scene variant fields (`location_variant_slug`, `character_variant_slugs`, `prop_variant_slugs`)
- status vocabulary including `in_progress`

## Canonical data model (API-facing)

- `video`
- `series_assets`
- `series_asset_variants`
- `chapters`
- `scenes`

## Inventory snapshot (start of rewiring)

### A) `/api/videos` surface

- **Core CRUD routes** (good Phase 1 candidates)
  - `/api/videos`
  - `/api/videos/{id}`
  - `/api/videos/{id}/assets`
  - `/api/videos/{id}/assets/{assetId}`
  - `/api/videos/{id}/assets/{assetId}/variants`
  - `/api/videos/{id}/assets/{assetId}/variants/{variantId}`
  - `/api/videos/{id}/chapters`
  - `/api/videos/{id}/chapters/{chapterId}`
  - `/api/videos/{id}/chapters/{chapterId}/asset-map`

- **Legacy-coupled routes under `/api/videos` (pending)**
  - `/api/videos/{id}/chapters/{chapterId}/create-project` (depends on `series_episodes`, `storyboards`)
  - `/api/videos/{id}/generate-grid`
  - `/api/videos/{id}/generate-images`
  - `/api/videos/{id}/poll-images`
  - `/api/videos/{id}/assets/{assetId}/variants/{variantId}/regenerate`
  - `/api/videos/{id}/assets/{assetId}/variants/{variantId}/edit-image`

### B) Storyboard API surface

- **Phase 2 rewired authoring subset**
  - `/api/v2/storyboard/create` (now writes canonical `chapters` + `video` fields; returns `chapter_id` + temporary `storyboard_id` alias)
  - `/api/v2/storyboard/{id}/scenes` (path id now resolves to canonical `chapter.id`; scene writes use variant-slug fields)
  - `/api/v2/storyboard/{id}/scenes/{sceneId}` (update/delete now scoped to canonical chapter+scene linkage)
- **Still legacy-coupled (pending)**
  - `/api/v2/storyboard/{id}/approve`
  - `/api/v2/storyboard/{id}/generate-video`
  - `/api/v2/storyboard/{id}/generate-tts`
  - `/api/v2/storyboard/{id}/prompts`
  - `/api/v2/storyboard/{id}/composite`
  - most `/api/storyboard/*` routes

## Phase plan

## Phase 1 (this pass)

### Goals

1. Rewire core `/api/videos` CRUD + chapter map routes to canonical schema.
2. Update shared `video-service` types/CRUD to query canonical tables (`chapters`, no `series_episodes`/`episode_assets`).
3. Keep incremental compatibility where feasible (legacy request aliases and response aliases) to avoid an all-at-once UI break.

### Done in Phase 1

- Rewired video CRUD to canonical fields:
  - supports `creative_brief` as canonical (legacy `metadata` accepted as alias)
  - supports text/object compatibility handling for `visual_style`
- Rewired chapters to `chapters` table (`order` canonical; `episode_number` alias preserved)
- Rewired chapter asset map to `chapters.asset_variant_map` with canonical grouped keys:
  - `characters`, `locations`, `props`
  - validates variant slug ownership/type
  - supports legacy `asset_ids` input by converting to default variant slugs
- Rewired asset/variant CRUD to canonical asset+variant columns (slug-first)
- Replaced deleted `series_asset_variant_images` dependency with compatibility adapter that stores canonical `series_asset_variants.image_url`
- Updated API ops registry entries for video/chapter asset-map semantics to reflect `asset_variant_map`

## Phase 2 (this pass — incremental rewiring)

### Goals executed

1. Rewired scene authoring endpoints to canonical chapter/scene linkage and variant slug fields.
2. Removed `series_episodes` / `episode_assets` dependencies from key authoring APIs.
3. Migrated `/api/v2/chapters/{chapterId}/assets` to canonical `chapters.asset_variant_map` contract with legacy alias compatibility.
4. Updated API ops registry + this plan doc to reflect current reality.

### Done in Phase 2

- `/api/v2/chapters/{chapterId}/assets`
  - now reads/writes `chapters.asset_variant_map`
  - validates variant slug ownership/type via `series_assets` + `series_asset_variants`
  - keeps legacy `asset_ids` input/output as compatibility adapter
- `/api/v2/storyboard/create`
  - no longer inserts/links `storyboards` / `series_episodes`
  - now creates or updates canonical `chapters` draft rows and updates `video.content_mode` / `video.plan_status`
  - returns `chapter_id` and temporary `storyboard_id` alias (same UUID)
- `/api/v2/storyboard/{id}/scenes` (create)
  - path id now treated as canonical `chapter.id` (legacy param name retained)
  - writes scene refs only to canonical fields:
    - `location_variant_slug`
    - `character_variant_slugs`
    - `prop_variant_slugs`
  - validates scene refs against both video variants and `chapter.asset_variant_map`
  - accepts `background_name` / `object_names` as temporary compatibility aliases
- `/api/v2/storyboard/{id}/scenes/{sceneId}` (update/delete)
  - now resolves by `(chapter_id, scene_id)` instead of `(storyboard_id, scene_id)`
  - same canonical variant-field validation path as create
  - enforces edit/delete lock when chapter is `in_progress` or `done`

### Remaining blockers after Phase 2

- Generation prep/execution endpoints are still tightly coupled to dropped storyboard-era tables/columns:
  - `/api/v2/storyboard/{id}/approve`
  - `/api/v2/storyboard/{id}/generate-video`
  - `/api/v2/storyboard/{id}/generate-tts`
  - `/api/v2/storyboard/{id}/prompts`
  - `/api/v2/storyboard/{id}/composite`
- Legacy `/api/storyboard/*` routes still assume dropped entities (`storyboards`, `voiceovers`, `objects`, `backgrounds`, etc.).
- Some UI hooks/components still reference `series_episodes` / `episode_assets` and need a dedicated UI migration pass.

## Phase 3 (this pass — generation-path migration on canonical chapter/scene)

### Goals executed

1. Rewired generation/approval routes to treat `/api/v2/storyboard/{id}` path id as canonical `chapters.id`.
2. Removed hard dependencies on dropped core tables from the Phase 3 endpoint set:
   - `storyboards`
   - `voiceovers`
   - `objects`
   - `backgrounds`
   - `generation_logs`
3. Added canonical webhook handling for chapter-scene generation callbacks:
   - `GenerateSceneTTS` (writes `scenes.audio_url`)
   - `GenerateSceneVideo` (writes `scenes.video_url`)
4. Kept temporary compatibility response aliases where needed (`storyboard_id` == `chapter_id`) to avoid full UI breakage in this pass.

### Done in Phase 3

- `/api/v2/storyboard/{id}/approve`
  - now validates + approves canonical `chapters + scenes`
  - scene refs validated against video variant slugs + chapter `asset_variant_map`
  - scene statuses normalized to `ready` and chapter status set to `ready`
- `/api/v2/storyboard/{id}/prompts`
  - now patches canonical `scenes.prompt` / `scenes.audio_text`
  - keeps prompt-contract compile path for payload validation/response, without writing removed storyboard-era rows
- `/api/v2/storyboard/{id}/generate-tts`
  - now queues per-scene TTS from `scenes.audio_text`
  - webhook callback target moved to `GenerateSceneTTS` with `scene_id`
  - runtime task metadata stored in `chapters.plan_json.generation_runtime`
- `/api/v2/storyboard/{id}/generate-video`
  - now generates from canonical scene refs (`location_variant_slug`, `character_variant_slugs`, `prop_variant_slugs`)
  - source images resolved from `series_asset_variants.image_url`
  - webhook callback target moved to `GenerateSceneVideo` with `scene_id`
  - runtime task metadata stored in `chapters.plan_json.generation_runtime`
- `/api/v2/storyboard/{id}/composite`
  - now composes from canonical scene media (`scenes.video_url`, `scenes.audio_url`, `scenes.duration`)
  - timeline persisted under `chapters.plan_json.composite`
  - chapter status moved toward `in_progress`/`done`
- `/api/webhook/kieai`
  - added canonical handlers for `GenerateSceneTTS` and `GenerateSceneVideo`
  - preserves legacy handlers for old steps during migration overlap

### Remaining blockers after Phase 3

1. Legacy storyboard endpoints outside this Phase 3 surface still depend on removed schema entities (notably many `/api/storyboard/*` and workflow routes tied to `storyboards`, `voiceovers`, `objects`, `backgrounds`, `grid_images`).
2. Compatibility aliases are still present and should be removed in a dedicated cleanup pass:
   - `storyboard_id` response alias in canonical chapter routes
   - legacy payload adapters (`asset_ids`, `background_name`, `object_names`) where still exposed
3. API docs / route registry still need final canonical-only contract tightening after UI/client migration is complete.

## Guardrails

- Keep each pass reviewable and table-scoped.
- Avoid reintroducing storyboard-era columns/contracts.
- Prefer explicit temporary compatibility shims over hidden legacy coupling.
