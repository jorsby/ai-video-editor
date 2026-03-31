# Schema Reset + UI Inspector — Project Plan

**Date:** 2026-03-29
**Status:** DRAFT — Pending Serhat review
**Goal:** Reset the current video-editor data model to a simpler, reviewable structure, wire the UI directly to it, and create one fully populated sample dataset so every field can be seen and evaluated visually before API redesign.

---

## Core principle

**First make the data model visible. Then review it. Then redesign APIs around the approved model.**

We are not preserving legacy compatibility in this pass. Old tables/fields can be removed if they make the model harder to reason about.

---

## Final target hierarchy

```txt
Project
└─ Series[]
   ├─ SeriesAssets[]
   │  └─ SeriesAssetVariants[]
   └─ Episodes[]
      └─ Scenes[]
```

---

## Locked product decisions

- `storyboards` will be removed from the product model.
- `episode_assets` table will be removed.
- `voiceovers` table will be removed.
- `first_frames` table will be removed.
- `series_asset_variant_images` will be removed from the core product model.
- Current generation model is kept simple: **reference-to-video only**.
- We are not adding `source_type`, video-to-video, audio-to-video, or avatar-specific modeling in this pass.
- All reusable assets belong to the **series**.
- Episode-level asset selection lives in `episodes.asset_map` JSON.
- Scene-level asset usage references assets by slug.
- The UI must show **all fields**, not a curated subset.
- The sample dataset must have **all fields populated** wherever the schema allows meaningful values.

---

## Final schema

### Enums

```ts
type ContentMode = 'narrative' | 'cinematic' | 'hybrid';
type AssetType = 'character' | 'location' | 'prop';
type PlanStatus = 'draft' | 'finalized';
type EpisodeStatus = 'draft' | 'ready' | 'generating' | 'done';
type SceneStatus = 'draft' | 'ready' | 'generating' | 'done' | 'failed';
```

### Project

```ts
interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}
```

### Series

```ts
interface Series {
  id: string;
  project_id: string;
  user_id: string;

  name: string;
  genre: string | null;
  tone: string | null;
  bible: string | null;

  content_mode: ContentMode;

  language: string | null;
  aspect_ratio: string | null;

  video_model: string | null;
  image_model: string | null;
  voice_id: string | null;
  tts_speed: number | null;

  visual_style: string | null;

  plan_draft: Record<string, unknown> | null;
  onboarding_messages: Record<string, unknown>[] | null;
  plan_status: PlanStatus;

  created_at: string;
  updated_at: string;
}
```

### SeriesAsset

```ts
interface SeriesAsset {
  id: string;
  series_id: string;

  type: AssetType;
  name: string;
  slug: string;
  description: string | null;

  created_at: string;
  updated_at: string;
}
```

### SeriesAssetVariant

```ts
interface SeriesAssetVariant {
  id: string;
  asset_id: string;

  name: string;
  prompt: string | null;
  image_url: string | null;

  is_default: boolean;

  where_to_use: string | null;
  reasoning: string | null;

  created_at: string;
  updated_at: string;
}
```

### EpisodeAssetMap

```ts
interface EpisodeAssetMap {
  characters: string[];
  locations: string[];
  props: string[];
}
```

### Episode

```ts
interface Episode {
  id: string;
  series_id: string;

  order: number;
  title: string | null;
  synopsis: string | null;

  audio_content: string | null;
  visual_outline: string | null;

  asset_map: EpisodeAssetMap;
  plan_json: Record<string, unknown> | null;

  status: EpisodeStatus;

  created_at: string;
  updated_at: string;
}
```

### Scene

```ts
interface Scene {
  id: string;
  episode_id: string;

  order: number;
  title: string | null;

  duration: number | null;
  content_mode: 'narrative' | 'cinematic' | null;

  visual_direction: string | null;
  prompt: string | null;

  location_slug: string | null;
  character_slugs: string[];
  prop_slugs: string[];

  audio_text: string | null;
  audio_url: string | null;

  video_url: string | null;
  status: SceneStatus;

  created_at: string;
  updated_at: string;
}
```

---

## What will be removed

- `studio.storyboards`
- `studio.episode_assets`
- `studio.voiceovers`
- `studio.first_frames`
- `studio.series_asset_variant_images`
- scene fields tied to old generation complexity:
  - `multi_prompt`
  - `multi_shots`
  - `sfx_prompt`
  - old object/background naming patterns that should become slug-based scene references

---

## Implementation phases

### Phase 1 — Final schema + migration plan

Deliverables:
- this plan doc
- SQL migration plan for the new schema
- old → new mapping list
- explicit drop list for removed tables/columns

Success criteria:
- one clear schema only
- no alternate versions
- no legacy fallback design

### Phase 2 — Backend schema reset

Deliverables:
- clean Supabase schema matching the final model
- constraints, FKs, indexes, defaults
- generated TS types updated to match

Success criteria:
- DB reflects only the approved model
- no storyboard-driven paths remain in the core schema

### Phase 3 — UI inspector pass

Goal: **make backend data fully visible in the product UI**.

Deliverables:
- update current editor UI to inspect the new hierarchy
- reuse existing scene cards / assets UI where helpful
- add raw JSON panels where useful
- ensure every important field is visible somewhere

Must be visible in UI:
- project: all fields
- series: all fields
- series assets: all fields
- asset variants: all fields
- episodes: all fields
- scenes: all fields
- raw JSON for nested objects like `asset_map` and `plan_json`

Success criteria:
- Serhat can inspect one sample project visually and review the model without reading SQL
- there is no important backend field that is hidden from the UI

### Phase 4 — Full sample dataset

Deliverables:
- 1 project
- 1 series
- multiple series assets
- multiple asset variants
- 1 episode
- multiple scenes
- every field populated with meaningful sample values where possible

Notes:
- visual media is not required for the review round
- prompts, slugs, descriptions, JSON fields, and statuses must be visible

Success criteria:
- Serhat can open the UI and review the model end-to-end
- feedback can be given field-by-field from the UI

### Phase 5 — Review round

Goal: product review before API redesign.

What happens:
- Serhat inspects the sample project visually
- fields are added/removed/renamed based on review
- UI is adjusted until the model feels right

Success criteria:
- model feels clear in practice, not just in markdown
- final approved shape exists before endpoint redesign starts

### Phase 6 — API redesign

Only after the review round is approved.

Deliverables:
- new endpoint plan matching the final schema
- route-by-route rewrite/update list
- frontend/backend integration pass against the approved model

Success criteria:
- APIs reflect the approved schema instead of legacy storyboard assumptions

---

## Review-ready deliverable definition

A review-ready build means:
- schema has been reset
- one sample project exists
- all important fields are visible in UI
- nested JSON is visible in readable form
- Serhat can say “keep this / remove this / rename this / move this” while looking at the product

---

## Non-goals for this pass

- full generation pipeline restoration
- provider-specific generation abstractions
- backward compatibility for old data
- avatar/video-to-video/audio-to-video modeling
- optimizing for production migrations

---

## Execution model: phase-by-phase with narrow-context subagents

To keep context clean, execution should be **divide-and-conquer**, not one giant full-context implementation pass.

### Orchestration rule

- One main agent owns the plan, sequencing, and final decisions.
- Each phase is handled by a **separate narrow-context subagent**.
- Subagents only get the minimum files and goals needed for that phase.
- Main agent reviews/merges the result, then starts the next phase.
- We should avoid giving one coding agent the whole repo history + full redesign context at once.

### Suggested subagent breakdown

#### Phase 1 — Schema spec agent
Scope:
- finalize table list
- finalize columns, enums, relations
- write old → new mapping notes

Context it needs:
- this plan doc
- relevant current migrations/types/routes only

Output:
- schema spec
- migration checklist

#### Phase 2 — Supabase reset agent
Scope:
- implement clean schema reset
- remove obsolete tables/columns
- create new tables, constraints, indexes

Context it needs:
- approved schema spec
- Supabase migration folder
- DB type generation paths

Output:
- migration files
- updated generated DB types / affected typed access points

#### Phase 3 — UI inspector agent
Scope:
- adapt current UI to the new hierarchy
- show all fields clearly
- add raw JSON views where needed

Context it needs:
- approved schema
- current editor pages/components that render project/series/assets/episodes/scenes

Output:
- reviewable UI wired to the new model

#### Phase 4 — Sample data agent
Scope:
- create one fully populated sample project/series/assets/variants/episode/scenes dataset
- ensure every meaningful field has a value

Context it needs:
- approved schema
- seed/write path
- UI fields that need visibility

Output:
- sample dataset usable for review

#### Phase 5 — Review cleanup agent
Scope:
- apply Serhat's field-level feedback after visual review
- rename/add/remove fields surgically

Context it needs:
- reviewed UI/screenshots/feedback
- current schema + UI implementation

Output:
- approved final schema/UI before API redesign

#### Phase 6 — API redesign agent
Scope:
- rewrite endpoints to match the approved model
- remove storyboard-era assumptions from routes/services

Context it needs:
- final approved schema
- affected API routes/services only

Output:
- new API surface aligned with the final model

### Parallelism rule

Use parallel subagents only when scopes do not conflict.

Safe parallel examples:
- schema audit + UI file inventory
- seed design + inspector UX inventory

Unsafe parallel examples:
- schema migration + UI implementation against an unapproved schema
- multiple agents editing the same route/component family at the same time

### Working style

- Finish one phase to a reviewable checkpoint
- summarize the result briefly
- then hand the next phase to a fresh subagent
- keep each subagent focused on one deliverable

This should keep context small, make failures easier to isolate, and keep the redesign manageable.

---

## Expected execution order

1. Approve this plan
2. Phase 1: schema spec subagent
3. Phase 2: schema reset subagent
4. Phase 3: UI inspector subagent
5. Phase 4: sample data subagent
6. Review in product UI
7. Phase 5: cleanup/refinement subagent
8. Phase 6: API redesign subagent

---

## Guiding rule during execution

**If a field exists in backend, make it visible in UI.**

That visibility is the fastest way to validate the model before deeper API work.
