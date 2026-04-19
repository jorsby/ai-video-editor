# projects

> Schema: `studio` · Table: `projects`
> Related: [[VIDEOS]] · [[CHARACTERS]] · [[LOCATIONS]] · [[PROPS]] · [[MUSICS]]

## Contents
- [Table Structure](#table-structure)
- [API Endpoints](#api-endpoints)
  - [List Projects](#list-projects)
  - [Create Project](#create-project)
  - [Get Project](#get-project)
  - [Update Project](#update-project)
  - [Delete Project](#delete-project)
  - [Get Project Variants](#get-project-variants)

---

## Table Structure

| Column | Type | Nullable | Default | Constraint | Notes |
|--------|------|----------|---------|------------|-------|
| id | uuid | NO | gen_random_uuid() | PK | Auto-generated unique identifier |
| user_id | uuid | NO | — | FK → auth.users.id | Project owner |
| name | text | NO | — | | Project display name |
| description | text | NO | — | | Project description |
| video_player_settings | jsonb | NO | `{"fps":30,"width":1080,"height":1920,"bgColor":"#18181b"}` | | Canvas / player defaults |
| generation_settings | jsonb | NO | `{}` | | Project-level generation config (see below) |
| archived_at | timestamptz | YES | — | | Soft-delete timestamp; null = active |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

### generation_settings JSONB

```json
{
  "voice_id": "Rachel",
  "video_model": "grok-imagine/image-to-video",
  "aspect_ratio": "9:16",
  "language": "tr",
  "video_resolution": "480p",
  "tts_speed": 1.0,
  "image_models": {
    "character": { "t2i": "z-image", "i2i": "z-image" },
    "location": { "t2i": "gpt-image/1.5-text-to-image", "i2i": "gpt-image/1.5-text-to-image" },
    "prop": { "t2i": "z-image", "i2i": "z-image" }
  }
}
```

**image_models per asset type:**

| Key | Description |
|-----|-------------|
| t2i | Text-to-image model (main variants) |
| i2i | Image-to-image model (non-main variants) |

Available models: `z-image`, `gpt-image/1.5-text-to-image`, `flux-2/pro-text-to-image`

---

## API Endpoints

### List Projects

`GET` /api/v2/projects

→ `200` `[{ id, name, description, created_at, updated_at }]`

---

### Create Project

`POST` /api/v2/projects

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| name | string | ✓ | — | Project display name |
| description | string | ✓ | — | Project description |
| generation_settings | object | | `{}` | See generation_settings JSONB above |

→ `201` `{ id, name, description, generation_settings }`

---

### Get Project

`GET` /api/v2/projects/{id}

→ `200` `{ id, name, description, generation_settings, video_player_settings, created_at, updated_at }`

---

### Update Project

`PATCH` /api/v2/projects/{id}

| Field | Type | Notes |
|-------|------|-------|
| name | string | Project display name |
| description | string | Project description |
| generation_settings | object | Partial merge with existing keys |
| video_player_settings | object | Partial merge with existing keys |

→ `200` `{ id, name, description, generation_settings, video_player_settings }`

---

### Delete Project

`DELETE` /api/v2/projects/{id}

→ `200` `{ id, deleted: true }`

> Cascades: deletes all videos, chapters, scenes, assets, variants.

---

### Get Project Variants

`GET` /api/v2/projects/{id}/variants

→ `200` `[{ id, asset_id, slug, image_url, image_gen_status }]`

> Returns all asset variant images across characters, locations, props.
