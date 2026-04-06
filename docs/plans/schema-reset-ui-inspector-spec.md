# Schema Reset — Final UI Inspector Spec (Phase 1)

**Date:** 2026-03-30  
**Status:** Final (revised after product-model review feedback)  
**Compatibility:** Intentionally breaking reset (no legacy compatibility)

## 1) Locked hierarchy (single direction)

```txt
Project
└─ Video[]
   ├─ VideoAssets[]
   │  └─ VideoAssetVariants[]
   └─ Chapters[]
      └─ Scenes[]
```

- No storyboard model in final product schema.
- Generation model remains simple: reference-to-video only.
- No `episode_assets`, `voiceovers`, `first_frames`, `series_asset_variant_images` tables.

---

## 2) Enums

```ts
type content_mode = 'narrative' | 'cinematic' | 'hybrid';
type asset_type = 'character' | 'location' | 'prop';
type plan_status = 'draft' | 'finalized';
type episode_status = 'draft' | 'ready' | 'in_progress' | 'done';
type scene_status = 'draft' | 'ready' | 'in_progress' | 'done' | 'failed';
```

---

## 3) Final tables (studio schema)

## `studio.projects` (existing root, normalized)

| column | type | notes |
|---|---|---|
| id | uuid pk | default `gen_random_uuid()` |
| user_id | uuid not null fk -> auth.users(id) | owner |
| name | text not null | |
| description | text null | new explicit project description |
| created_at | timestamptz not null | default `now()` |
| updated_at | timestamptz not null | default `now()` |

> `archived_at` is removed from the product model.

## `studio.video`

| column | type | notes |
|---|---|---|
| id | uuid pk | default `gen_random_uuid()` |
| project_id | uuid not null fk -> studio.projects(id) on delete cascade | |
| user_id | uuid not null fk -> auth.users(id) on delete cascade | owner |
| name | text not null | |
| genre | text null | |
| tone | text null | |
| bible | text null | |
| content_mode | studio.content_mode not null | default `'narrative'` |
| language | text null | |
| aspect_ratio | text null | |
| video_model | text null | |
| image_model | text null | |
| voice_id | text null | |
| tts_speed | numeric null | |
| visual_style | text null | |
| creative_brief | jsonb null | product-facing planning payload (renamed from `plan_draft`) |
| plan_status | studio.plan_status not null | default `'draft'` |
| created_at | timestamptz not null | default `now()` |
| updated_at | timestamptz not null | default `now()` |

> `onboarding_messages` is intentionally removed from core product schema. Keep onboarding/chat transcripts in non-core workflow/session storage.

## `studio.series_assets`

| column | type | notes |
|---|---|---|
| id | uuid pk | default `gen_random_uuid()` |
| video_id | uuid not null fk -> studio.video(id) on delete cascade | |
| type | studio.asset_type not null | character/location/prop |
| name | text not null | |
| slug | text not null | unique within video |
| description | text null | |
| sort_order | integer not null | default `0` |
| created_at | timestamptz not null | default `now()` |
| updated_at | timestamptz not null | default `now()` |

**Constraint:** `unique(video_id, slug)`

## `studio.series_asset_variants`

| column | type | notes |
|---|---|---|
| id | uuid pk | default `gen_random_uuid()` |
| asset_id | uuid not null fk -> studio.series_assets(id) on delete cascade | parent asset relation |
| slug | text not null | canonical LLM-facing variant identifier (example: `ava-kim-studio-intro`) |
| name | text not null | variant label/name |
| prompt | text null | variant-specific reference prompt |
| image_url | text null | canonical variant image |
| is_default | boolean not null | default `false` |
| where_to_use | text null | usage guidance |
| reasoning | text null | why this variant exists |
| created_at | timestamptz not null | default `now()` |
| updated_at | timestamptz not null | default `now()` |

**Constraint:** `unique(asset_id, slug)`  
**Canonical variant token:** `series_asset_variants.slug` (no duplicate key field).

## `studio.chapters` (new canonical chapter table)

| column | type | notes |
|---|---|---|
| id | uuid pk | default `gen_random_uuid()` |
| video_id | uuid not null fk -> studio.video(id) on delete cascade | |
| order | integer not null | `> 0`, unique in video |
| title | text null | |
| synopsis | text null | |
| audio_content | text null | |
| visual_outline | text null | |
| asset_variant_map | jsonb not null | shape: `{ characters: string[], locations: string[], props: string[] }` where values are canonical variant `slug` strings |
| plan_json | jsonb null | |
| status | studio.episode_status not null | default `'draft'` |
| created_at | timestamptz not null | default `now()` |
| updated_at | timestamptz not null | default `now()` |

**Constraint:** `unique(video_id, order)`

## `studio.scenes`

| column | type | notes |
|---|---|---|
| id | uuid pk | default `gen_random_uuid()` |
| chapter_id | uuid not null fk -> studio.chapters(id) on delete cascade | |
| order | integer not null | `> 0`, unique in chapter |
| title | text null | |
| duration | integer null | resolved playback seconds (see duration resolution rule below) |
| content_mode | studio.content_mode null | optional per-scene override |
| visual_direction | text null | |
| prompt | text null | final generation prompt |
| location_variant_slug | text null | selected location variant slug (`series_asset_variants.slug`) |
| character_variant_slugs | text[] not null | selected character variant slugs (`series_asset_variants.slug[]`) |
| prop_variant_slugs | text[] not null | selected prop variant slugs (`series_asset_variants.slug[]`) |
| audio_text | text null | narration/dialogue source text |
| audio_url | text null | rendered narration URL |
| video_url | text null | generated scene video URL |
| status | studio.scene_status not null | default `'draft'` |
| created_at | timestamptz not null | default `now()` |
| updated_at | timestamptz not null | default `now()` |

**Constraint:** `unique(chapter_id, order)`

**Duration resolution rule (explicit):**
1. If `audio_url` exists, `duration` resolves from actual rendered audio length.
2. If `audio_url` is absent, `duration` falls back to estimated TTS/text duration or explicit/manual runtime.

---

## 4) Relations

- `projects 1 -> n video`
- `video 1 -> n series_assets`
- `series_assets 1 -> n series_asset_variants`
- `video 1 -> n chapters`
- `chapters 1 -> n scenes`

Reference usage rules:
- `chapters.asset_variant_map` stores allowed variant slugs by type.
- `scenes.location_variant_slug / character_variant_slugs / prop_variant_slugs` must point to concrete variant slugs from the same parent video.
- Canonical format is the variant slug itself (recommended convention: `<asset_slug>-<variant_slug>`).

---

## 5) Removed tables and fields

## Drop tables

- `studio.storyboards`
- `studio.grid_images`
- `studio.first_frames`
- `studio.voiceovers`
- `studio.objects`
- `studio.backgrounds`
- `studio.episode_assets`
- `studio.episode_asset_variants`
- `studio.series_asset_variant_images`
- `studio.generation_logs`

## Drop fields from surviving tables

- `studio.projects.archived_at`
- `studio.video.metadata`
- `studio.video.onboarding_messages` (moved out of core schema)
- `studio.series_assets.tags`
- `studio.series_assets.character_id`
- `studio.series_episodes.project_id` (table replaced)
- `studio.series_episodes.storyboard_id` (table replaced)
- Storyboard-era scene fields:
  - `storyboard_id`
  - `multi_prompt`
  - `multi_shots`
  - `prompt_json`
  - `validated_runtime`
  - `compiled_prompt`
  - `compile_status`
  - `resolved_asset_refs`
  - `reference_images`
  - `shot_durations`
  - `background_name`
  - `object_names`
  - `language`
  - `video_request_id`
  - `video_error_message`
  - `video_resolution`
  - `video_provider`
  - `sfx_prompt`
  - `sfx_status`
  - `sfx_request_id`
  - `sfx_error_message`
  - `generation_meta`
  - `feedback`

---

## 6) Old -> new mapping (migration intent)

| old | new |
|---|---|
| `series_episodes` | `chapters` |
| `series_episodes.episode_number` | `chapters.order` |
| `episode_assets` rows | `chapters.asset_variant_map` JSON (variant slug arrays) |
| `series_assets` | stays as `series_assets` (simplified root asset record) |
| `series_asset_variants` | stays as `series_asset_variants` (kept, with canonical `slug`) |
| `series_asset_variant_images` | removed; fold canonical image choice into `series_asset_variants.image_url` |
| `storyboards.plan_status` | `video.plan_status` |
| `video.plan_draft` | `video.creative_brief` |
| `storyboards.plan` | `video.creative_brief` / `chapters.plan_json` |
| `scenes.storyboard_id` | `scenes.chapter_id` |
| `scenes.background_name` | `scenes.location_variant_slug` |
| `scenes.object_names` | `scenes.character_variant_slugs` + `scenes.prop_variant_slugs` |
| `voiceovers.text` | `scenes.audio_text` |
| `voiceovers.audio_url` | `scenes.audio_url` |
| `scenes.video_status: pending/processing/success/failed` | `scenes.status: draft/ready/in_progress/done/failed` |

---

## 7) Open questions

None. This spec is fully locked for Phase 2 implementation.

---

## 8) Short migration checklist

1. Create new enums: `content_mode`, `asset_type`, `plan_status`, `episode_status`, `scene_status`.
2. Create `studio.chapters` and replace scene FK to `chapters(id)`.
3. Add/normalize final columns on `projects`, `video`, `series_assets`, `scenes`.
4. Normalize `series_assets`; keep `series_asset_variants.slug` as canonical LLM-facing identity and remove duplicate key field.
5. Build `chapters.asset_variant_map` using variant slugs (not bare asset slugs).
6. Backfill `scenes.audio_text/audio_url`; migrate scene refs to variant slugs (`location_variant_slug`, `character_variant_slugs`, `prop_variant_slugs`); map status values to `in_progress` naming.
7. Remove storyboard-era and multi-shot/sfx/prompt-contract fields from `scenes`.
8. Drop removed tables (storyboard-era + chapter asset link tables + variant image tables).
9. Recreate indexes/RLS/policies strictly for the final 6-table model.
