# API Rewiring Plan — Simplified Schema (Phase Track)

## Context

Schema reset is now live and approved (real DB reset + real seed verified). This plan tracks the incremental API rewiring from legacy storyboard-era tables to the approved canonical model:

- `series.creative_brief`
- `episodes.asset_variant_map`
- variant slug as canonical cross-entity reference
- scene variant fields (`location_variant_slug`, `character_variant_slugs`, `prop_variant_slugs`)
- status vocabulary including `in_progress`

## Canonical data model (API-facing)

- `series`
- `series_assets`
- `series_asset_variants`
- `episodes`
- `scenes`

## Inventory snapshot (start of rewiring)

### A) `/api/series` surface

- **Core CRUD routes** (good Phase 1 candidates)
  - `/api/series`
  - `/api/series/{id}`
  - `/api/series/{id}/assets`
  - `/api/series/{id}/assets/{assetId}`
  - `/api/series/{id}/assets/{assetId}/variants`
  - `/api/series/{id}/assets/{assetId}/variants/{variantId}`
  - `/api/series/{id}/episodes`
  - `/api/series/{id}/episodes/{episodeId}`
  - `/api/series/{id}/episodes/{episodeId}/asset-map`

- **Legacy-coupled routes under `/api/series` (pending)**
  - `/api/series/{id}/episodes/{episodeId}/create-project` (depends on `series_episodes`, `storyboards`)
  - `/api/series/{id}/generate-grid`
  - `/api/series/{id}/generate-images`
  - `/api/series/{id}/poll-images`
  - `/api/series/{id}/assets/{assetId}/variants/{variantId}/regenerate`
  - `/api/series/{id}/assets/{assetId}/variants/{variantId}/edit-image`

### B) Storyboard API surface

- **Phase 2 rewired authoring subset**
  - `/api/v2/storyboard/create` (now writes canonical `episodes` + `series` fields; returns `episode_id` + temporary `storyboard_id` alias)
  - `/api/v2/storyboard/{id}/scenes` (path id now resolves to canonical `episode.id`; scene writes use variant-slug fields)
  - `/api/v2/storyboard/{id}/scenes/{sceneId}` (update/delete now scoped to canonical episode+scene linkage)
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

1. Rewire core `/api/series` CRUD + episode map routes to canonical schema.
2. Update shared `series-service` types/CRUD to query canonical tables (`episodes`, no `series_episodes`/`episode_assets`).
3. Keep incremental compatibility where feasible (legacy request aliases and response aliases) to avoid an all-at-once UI break.

### Done in Phase 1

- Rewired series CRUD to canonical fields:
  - supports `creative_brief` as canonical (legacy `metadata` accepted as alias)
  - supports text/object compatibility handling for `visual_style`
- Rewired episodes to `episodes` table (`order` canonical; `episode_number` alias preserved)
- Rewired episode asset map to `episodes.asset_variant_map` with canonical grouped keys:
  - `characters`, `locations`, `props`
  - validates variant slug ownership/type
  - supports legacy `asset_ids` input by converting to default variant slugs
- Rewired asset/variant CRUD to canonical asset+variant columns (slug-first)
- Replaced deleted `series_asset_variant_images` dependency with compatibility adapter that stores canonical `series_asset_variants.image_url`
- Updated API ops registry entries for series/episode asset-map semantics to reflect `asset_variant_map`

## Phase 2 (this pass — incremental rewiring)

### Goals executed

1. Rewired scene authoring endpoints to canonical episode/scene linkage and variant slug fields.
2. Removed `series_episodes` / `episode_assets` dependencies from key authoring APIs.
3. Migrated `/api/v2/episodes/{episodeId}/assets` to canonical `episodes.asset_variant_map` contract with legacy alias compatibility.
4. Updated API ops registry + this plan doc to reflect current reality.

### Done in Phase 2

- `/api/v2/episodes/{episodeId}/assets`
  - now reads/writes `episodes.asset_variant_map`
  - validates variant slug ownership/type via `series_assets` + `series_asset_variants`
  - keeps legacy `asset_ids` input/output as compatibility adapter
- `/api/v2/storyboard/create`
  - no longer inserts/links `storyboards` / `series_episodes`
  - now creates or updates canonical `episodes` draft rows and updates `series.content_mode` / `series.plan_status`
  - returns `episode_id` and temporary `storyboard_id` alias (same UUID)
- `/api/v2/storyboard/{id}/scenes` (create)
  - path id now treated as canonical `episode.id` (legacy param name retained)
  - writes scene refs only to canonical fields:
    - `location_variant_slug`
    - `character_variant_slugs`
    - `prop_variant_slugs`
  - validates scene refs against both series variants and `episode.asset_variant_map`
  - accepts `background_name` / `object_names` as temporary compatibility aliases
- `/api/v2/storyboard/{id}/scenes/{sceneId}` (update/delete)
  - now resolves by `(episode_id, scene_id)` instead of `(storyboard_id, scene_id)`
  - same canonical variant-field validation path as create
  - enforces edit/delete lock when episode is `in_progress` or `done`

### Remaining blockers after Phase 2

- Generation prep/execution endpoints are still tightly coupled to dropped storyboard-era tables/columns:
  - `/api/v2/storyboard/{id}/approve`
  - `/api/v2/storyboard/{id}/generate-video`
  - `/api/v2/storyboard/{id}/generate-tts`
  - `/api/v2/storyboard/{id}/prompts`
  - `/api/v2/storyboard/{id}/composite`
- Legacy `/api/storyboard/*` routes still assume dropped entities (`storyboards`, `voiceovers`, `objects`, `backgrounds`, etc.).
- Some UI hooks/components still reference `series_episodes` / `episode_assets` and need a dedicated UI migration pass.

## Phase 3 (this pass — generation-path migration on canonical episode/scene)

### Goals executed

1. Rewired generation/approval routes to treat `/api/v2/storyboard/{id}` path id as canonical `episodes.id`.
2. Removed hard dependencies on dropped core tables from the Phase 3 endpoint set:
   - `storyboards`
   - `voiceovers`
   - `objects`
   - `backgrounds`
   - `generation_logs`
3. Added canonical webhook handling for episode-scene generation callbacks:
   - `GenerateSceneTTS` (writes `scenes.audio_url`)
   - `GenerateSceneVideo` (writes `scenes.video_url`)
4. Kept temporary compatibility response aliases where needed (`storyboard_id` == `episode_id`) to avoid full UI breakage in this pass.

### Done in Phase 3

- `/api/v2/storyboard/{id}/approve`
  - now validates + approves canonical `episodes + scenes`
  - scene refs validated against series variant slugs + episode `asset_variant_map`
  - scene statuses normalized to `ready` and episode status set to `ready`
- `/api/v2/storyboard/{id}/prompts`
  - now patches canonical `scenes.prompt` / `scenes.audio_text`
  - keeps prompt-contract compile path for payload validation/response, without writing removed storyboard-era rows
- `/api/v2/storyboard/{id}/generate-tts`
  - now queues per-scene TTS from `scenes.audio_text`
  - webhook callback target moved to `GenerateSceneTTS` with `scene_id`
  - runtime task metadata stored in `episodes.plan_json.generation_runtime`
- `/api/v2/storyboard/{id}/generate-video`
  - now generates from canonical scene refs (`location_variant_slug`, `character_variant_slugs`, `prop_variant_slugs`)
  - source images resolved from `series_asset_variants.image_url`
  - webhook callback target moved to `GenerateSceneVideo` with `scene_id`
  - runtime task metadata stored in `episodes.plan_json.generation_runtime`
- `/api/v2/storyboard/{id}/composite`
  - now composes from canonical scene media (`scenes.video_url`, `scenes.audio_url`, `scenes.duration`)
  - timeline persisted under `episodes.plan_json.composite`
  - episode status moved toward `in_progress`/`done`
- `/api/webhook/kieai`
  - added canonical handlers for `GenerateSceneTTS` and `GenerateSceneVideo`
  - preserves legacy handlers for old steps during migration overlap

### Remaining blockers after Phase 3

1. Legacy storyboard endpoints outside this Phase 3 surface still depend on removed schema entities (notably many `/api/storyboard/*` and workflow routes tied to `storyboards`, `voiceovers`, `objects`, `backgrounds`, `grid_images`).
2. Compatibility aliases are still present and should be removed in a dedicated cleanup pass:
   - `storyboard_id` response alias in canonical episode routes
   - legacy payload adapters (`asset_ids`, `background_name`, `object_names`) where still exposed
3. API docs / route registry still need final canonical-only contract tightening after UI/client migration is complete.

## Guardrails

- Keep each pass reviewable and table-scoped.
- Avoid reintroducing storyboard-era columns/contracts.
- Prefer explicit temporary compatibility shims over hidden legacy coupling.
