# chapters

> Schema: `studio` · Table: `chapters`
> Related: [[VIDEOS]] → [[CHAPTERS]] → [[SCENES]]

## Contents
- [Table Structure](#table-structure)
- [API Endpoints](#api-endpoints)
  - [List Chapters](#list-chapters)
  - [Create Chapters](#create-chapters)
  - [Get Chapter](#get-chapter)
  - [Update Chapter](#update-chapter)
  - [Delete Chapter](#delete-chapter)
  - [Get Chapter Asset Map](#get-chapter-asset-map)
  - [Auto-Map Assets from Scenes](#auto-map-assets-from-scenes)

---

## Table Structure

| Column | Type | Nullable | Default | Constraint | Notes |
|--------|------|----------|---------|------------|-------|
| id | uuid | NO | gen_random_uuid() | PK | Auto-generated unique identifier |
| video_id | uuid | NO | — | FK → videos.id | Parent video |
| order | integer | NO | — | UNIQUE(video_id, order) | Position in video; 1000-spaced for insertion |
| title | text | NO | — | | Chapter display title |
| synopsis | text | NO | — | | Chapter summary |
| audio_content | text | YES | — | | Full chapter narration text |
| visual_outline | text | NO | — | | Visual beat descriptions |
| asset_variant_map | jsonb | NO | `{"props":[],"locations":[],"characters":[]}` | | Auto-mapped via `POST /map-assets`; not directly editable |
| status | episode_status | NO | 'in_progress' | | in_progress · ready · done |
| generation_runtime | jsonb | NO | `{}` | | Runtime metadata for tracking in-flight TTS/video generation tasks |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

---

## API Endpoints

### List Chapters

`GET` /api/v2/videos/{videoId}/chapters

→ `200` `[{ id, video_id, order, title, synopsis, audio_content, visual_outline, status, asset_variant_map, created_at, updated_at }]`

---

### Create Chapters

`POST` /api/v2/videos/{videoId}/chapters — batch

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| title | string | ✓ | — | Chapter display title |
| synopsis | string | ✓ | — | Chapter summary |
| order | integer | | auto 1000-spaced | Position in video; allows e.g. 1500 for insertion |
| audio_content | string | | — | Full chapter narration text |
| visual_outline | string | ✓ | — | Visual beat descriptions |

→ `201` `[{ id, video_id, order, title, synopsis, audio_content, visual_outline, status: "in_progress" }]`

> Status auto-set to `in_progress`. `asset_variant_map` auto-populated later via `/map-assets`.

---

### Get Chapter

`GET` /api/v2/chapters/{id}

→ `200` `{ id, video_id, order, title, synopsis, audio_content, visual_outline, asset_variant_map, status, created_at, updated_at }`

---

### Update Chapter

`PATCH` /api/v2/chapters/{id}

| Field | Type | Notes |
|-------|------|-------|
| title | string | Chapter display title |
| synopsis | string | Chapter summary |
| order | integer | Position in video |
| audio_content | string | Full chapter narration text |
| visual_outline | string | Visual beat descriptions |
| status | enum | in_progress · ready · done |

→ `200` `{ id, video_id, order, title, synopsis, audio_content, visual_outline, asset_variant_map, status, updated_at }`

> `asset_variant_map` is NOT directly editable — use `/map-assets` instead.

---

### Delete Chapter

`DELETE` /api/v2/chapters/{id}

→ `200` `{ id, deleted: true }`

> Cascades: deletes all scenes in chapter.

---

### Get Chapter Asset Map

`GET` /api/v2/chapters/{id}/asset-map

→ `200` `{ characters: [...], locations: [...], props: [...] }`

---

### Auto-Map Assets from Scenes

`POST` /api/v2/chapters/{id}/map-assets

→ `200` `{ asset_variant_map }`

> Reads all scenes in chapter, collects unique slugs from `location_variant_slug`, `character_variant_slugs`, `prop_variant_slugs`, writes to `asset_variant_map`.
