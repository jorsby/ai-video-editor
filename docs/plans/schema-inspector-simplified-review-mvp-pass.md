# Schema Inspector (Simplified Schema) — Review Revision (Post-Feedback)

**Date:** 2026-03-30  
**Route reviewed:** `/dev/schema-inspector?mode=mock`  
**Locked hierarchy:** `Project -> Video -> VideoAssets -> VideoAssetVariants -> Chapters -> Scenes`

---

## Executive summary

This revision applies Serhat’s latest product-model feedback directly to the review docs + inspector surface, while keeping the inspector read-only.

### Core direction now reflected
1. **Core planning model is cleaner:** `plan_draft` renamed to `creative_brief`; `onboarding_messages` removed from core schema direction.
2. **Variant identity is explicit and simplified:** assets keep `slug`; variants keep `slug`; no separate duplicate key field.
3. **Chapter + scene refs are slug-based:** chapter map and scene refs now use canonical `series_asset_variants.slug` values.
4. **Status naming normalized:** `generating` -> `in_progress` (chapter + scene).
5. **Duration semantics clarified:** duration resolves from actual audio length when `audio_url` exists; otherwise fallback is estimated/manual runtime.

### Why canonical variant slug is preferred for LLM matching
- Variant slug already provides a single canonical token (example: `ava-kim-studio-intro`).
- Eliminates duplicate identity fields and drift between canonical slug vs alternate key fields.
- Keeps prompts/plans deterministic while reducing schema surface area.
- Preserves relationship clarity via `series_asset_variants.asset_id -> series_assets.id`.

---

## Keep / Rename / Remove / Move / Missing (updated)

## Video

### Keep
- Story/model fields (`name`, `genre`, `tone`, `bible`, `content_mode`, `visual_style`, etc.)
- `plan_status`

### Rename
- `plan_draft` -> `creative_brief` (product-facing naming)

### Remove
- `onboarding_messages` from core schema model

### Move
- Onboarding/chat transcript concerns out of core product tables (workflow/session layer)

### Missing
- None for this MVP pass

---

## Assets / Variants

### Keep
- Separate `series_assets` and `series_asset_variants`
- Asset `slug`
- Variant `slug`
- Variant `asset_id` relation

### Remove
- duplicate per-variant key field (slug is canonical)

### Inspector UX update
- Explicitly shows asset slug vs variant slug identity split
- Clarifies that variant slug itself is the canonical LLM-facing token

---

## Chapters

### Rename
- `asset_map` -> `asset_variant_map`

### Direction
- `asset_variant_map` stores variant slugs (not asset slugs)
- Shape remains `{ characters, locations, props }` arrays

---

## Scenes

### Rename
- `location_slug` -> `location_variant_slug`
- `character_slugs` -> `character_variant_slugs`
- `prop_slugs` -> `prop_variant_slugs`

### Direction
- Scene refs must be concrete selected variant slug values (default or explicit)

### Status
- `generating` -> `in_progress`

### Duration semantics (explicit)
1. If `audio_url` exists: duration resolves from actual audio duration.
2. Else: duration falls back to estimated TTS/text duration or explicit/manual runtime.

---

## Inspector presentation updates in this revision

- Video JSON section now focuses on `creative_brief` only (no onboarding JSON in core view)
- Assets/variants section now emphasizes identity split:
  - asset content includes `slug`
  - variant content includes `slug` (canonical ref)
- Chapter JSON shape hints now validate canonical variant-slug arrays
- Scene asset refs display renamed variant-slug fields
- Scene content section includes duration resolution wording for review clarity
- Status counters reflect `in_progress`

---

## MVP pass scope guardrails (unchanged)

- Inspector remains **read-only**
- No API redesign initiated in this pass
- Changes are schema-review alignment + review-surface clarity

---

## Files expected to carry this revision

- `docs/plans/schema-reset-ui-inspector-spec.md`
- `docs/plans/schema-inspector-simplified-review-mvp-pass.md`
- `editor/src/app/dev/schema-inspector/page.tsx`
- `editor/src/app/api/dev/schema-inspector/seed/route.ts`
- `supabase/migrations/20260329173100_schema_reset_ui_inspector_phase2.sql`
