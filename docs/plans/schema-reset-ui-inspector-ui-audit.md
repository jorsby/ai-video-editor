# Schema Reset UI Inspector — UI Surface Audit (Phase 1)

**Date:** 2026-03-29  
**Scope:** UI-only audit for reuse during schema-reset inspector pass (no implementation)

## TL;DR
Use existing **dashboard project cards**, **series cards/detail shell**, **series assets panel/cards**, and **roadmap episode/scene shells** as the base.  
For review mode, strip mutation actions and wire them to new hierarchy data (`Project -> Series -> SeriesAssets -> Episodes -> Scenes`).  
Extract/reuse existing JSON viewers for `asset_map` + `plan_json` and per-entity raw payloads.

---

## Reuse matrix (by required inspector surface)

| Required surface | Best current reuse | File paths | Reuse recommendation | Replace/remove recommendation |
|---|---|---|---|---|
| **Project card** | Dashboard project card + list container | `editor/src/components/dashboard/project-card.tsx`  
`editor/src/components/dashboard/project-list.tsx` | Reuse card/list layout and interaction shell for project selection | Card currently only surfaces `name`, `created_at`, tags. Add missing project inspector fields (`id`, `user_id`, `description`, `updated_at`) in read-only metadata block. |
| **Series card** | Series list card | `editor/src/components/series/series-content.tsx` (`SeriesCard`) | Reuse card visual hierarchy (name + badges + preview text) | Current route is effectively disabled (`/app/series` notFound). Move/rehost this card into inspector page; include all backend fields (content mode, models, tts, plan status, etc.). |
| **Assets list** | Editor assets panel sections/cards | `editor/src/components/editor/media-panel/panel/series-assets-panel.tsx` | Reuse grouping by type (character/location/prop), collapsible sections, thumbnail-first scanning | Remove generation controls for inspector (`Generate Images`, style prompt editing, status badges tied to jobs) and convert to read-only data visibility blocks. |
| **Asset variants** | Variant card from series detail | `editor/src/components/series/series-detail-page.tsx` (`VariantCard`, `AssetCard`) | Reuse expandable variant card pattern for per-variant details | Current variant UI is action-heavy (upload/edit/regenerate/finalize/delete) and old-model (`series_asset_variant_images`). Replace actions with read-only fields for new schema (`name`, `prompt`, `image_url`, `is_default`, `where_to_use`, `reasoning`, timestamps). |
| **Episodes list** | Roadmap episode card | `editor/src/components/editor/media-panel/panel/series-roadmap-panel.tsx` (`EpisodeCard`) | Reuse expandable episode row + nested sections (audio, visual, assets, scenes) for inspector readability | Replace storyboard-driven status/progress derivation and old joins (`storyboards`, `episode_assets`) with direct `episodes` fields (`order`, `asset_map`, `plan_json`, `status`) and direct scene list. |
| **Scenes list** | (1) Roadmap `SceneRow` for compact list, (2) Scene card for deep details | `editor/src/components/editor/media-panel/panel/series-roadmap-panel.tsx` (`SceneRow`)  
`editor/src/components/editor/media-panel/panel/scene-card.tsx` | Reuse compact row for fast scan + selective reuse of card anatomy for expanded inspector | `scene-card.tsx` is deeply coupled to removed tables/fields (`objects`, `backgrounds`, `voiceovers`, `multi_prompt`, generation controls). Keep layout primitives only; do **not** reuse workflow mutation logic for inspector. |
| **Raw JSON inspectors** | (1) Structured JSON tree + (2) raw preformatted JSON blocks | `editor/src/components/dev/api-ops-dashboard.tsx` (`StructuredBodyPreview`, `StructuredBodyNode`)  
`editor/src/components/editor/media-panel/panel/scene-card.tsx` (`PromptContractDebugPanel` raw JSON section)  
`editor/src/components/editor/media-panel/panel/storyboard.tsx` (collapsed Raw JSON block) | Reuse JSON rendering patterns immediately for `asset_map`, `plan_json`, `plan_draft`, `onboarding_messages` | Extract JSON tree viewer into shared component; remove storyboard/prompt-contract terminology in inspector context. |

---

## Key nearby UI surfaces worth keeping

1. **Media panel tab shell** is already ideal for an inspector-style tool surface:  
   `editor/src/components/editor/media-panel/index.tsx` + `store.ts`
2. Existing tabs already include **assets** and **roadmap**, which map well to new hierarchy exploration.
3. `project-library.tsx` provides a compact, read-only asset+variant browsing pattern useful for low-noise inspector blocks.

---

## Gaps vs target schema visibility (what must be added)

### Project
- Missing display for: `id`, `user_id`, `description`, `updated_at`.

### Series
- Missing display for new fields from plan doc:  
  `content_mode`, `language`, `aspect_ratio`, `video_model`, `image_model`, `voice_id`, `tts_speed`, `visual_style`, `plan_draft`, `onboarding_messages`, `plan_status`, timestamps.

### SeriesAssets / Variants
- Current UI is centered on old image-table workflow.  
- Must explicitly show all variant fields from new schema (`prompt`, `image_url`, `where_to_use`, `reasoning`, timestamps).

### Episodes
- Current UI still references old mapping patterns (`episode_assets`, storyboard-driven status).  
- Must show `asset_map` and `plan_json` both structured and raw.

### Scenes
- Existing scene UI over-emphasizes old generation/runtime controls.  
- Must pivot to pure field visibility of new scene contract (`title`, `duration`, `content_mode`, slug refs, audio/video fields, status, timestamps).

---

## Minimum UI work to reach reviewable inspector state

1. **Create a dedicated inspector entry page** (recommend dev route first):
   - New page/component shell for `Project -> Series -> Assets -> Episodes -> Scenes` traversal.
2. **Reuse existing card containers but convert to read-only inspector mode**:
   - Remove buttons that mutate data (create, delete, regenerate, finalize, upload).
3. **Swap data sources to new schema shape**:
   - Replace storyboard/object/background/voiceover joins in roadmap/scene loaders with direct episode/scene queries.
4. **Add universal JSON panels**:
   - Structured + raw for `asset_map`, `plan_json`, `plan_draft`, `onboarding_messages`.
5. **Add “all fields visible” metadata rows**:
   - Each entity card should include a compact technical block for ids/status/timestamps even if also shown in friendly form.

---

## Recommended remove/deprioritize list for inspector pass

- Storyboard-era status logic in roadmap panel (`storyboards` dependency).
- Scene-card controls tied to removed legacy generation model.
- Series asset generation controls (`series_generation_jobs` indicators) in inspector mode.
- Any route/page assumptions that require `/series` pages currently returning `notFound()`.

---

## Execution recommendation

For fastest reviewable outcome:
- Keep existing **visual shells** (cards, collapsibles, sections).
- Build a **single inspector-mode data adapter** to map new schema rows into those shells.
- Add JSON inspectors early so Serhat can validate nested structures without waiting for polished UI.
