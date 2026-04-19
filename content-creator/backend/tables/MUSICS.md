# music

> Schema: `studio` · Table: `musics`
> Related: [[PROJECTS]] → [[MUSICS]] · Optional: [[VIDEOS]]

## Contents
- [Table Structure](#table-structure)
- [API Endpoints](#api-endpoints)
  - [List Music for Project](#list-music-for-project)
  - [List Music for Video](#list-music-for-video)
  - [Add Music (project-wide)](#add-music-project-wide)
  - [Add Music (video-scoped)](#add-music-video-scoped)
  - [Get Music](#get-music)
  - [Update Music](#update-music)
  - [Delete Music](#delete-music)

---

## Table Structure

| Column | Type | Nullable | Default | Constraint | Notes |
|--------|------|----------|---------|------------|-------|
| id | uuid | NO | gen_random_uuid() | PK | Auto-generated unique identifier |
| project_id | uuid | NO | — | FK → projects.id | Parent project |
| video_id | uuid | YES | — | FK → videos.id | null = project-wide music |
| title | text | NO | — | | Track title |
| structured_prompt | jsonb | YES | — | | Typed discriminated union on `is_instrumental` (see below). Validated server-side. |
| audio_url | text | YES | — | | Generated audio URL |
| cover_image_url | text | YES | — | | Album cover image |
| duration | float8 | YES | — | | Duration in seconds |
| status | text | NO | 'idle' | | idle · generating · done · failed |
| task_id | text | YES | — | | Async generation task ID |
| generation_metadata | jsonb | YES | — | | Model, params, etc. |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

### structured_prompt JSONB

Discriminated union on `is_instrumental`.

**Instrumental (`is_instrumental: true`)** — `lyrics` must be absent:

```json
{
  "is_instrumental": true,
  "genre": "orchestral cinematic",
  "mood": "melancholic, hopeful",
  "instrumentation": "strings, piano, soft percussion",
  "tempo_bpm": 72
}
```

**Lyrical (`is_instrumental: false`)** — `lyrics` required:

```json
{
  "is_instrumental": false,
  "genre": "Turkish folk pop",
  "mood": "nostalgic, warm",
  "instrumentation": "saz, darbuka, vocals",
  "tempo_bpm": 96,
  "lyrics": "..."
}
```

| Key              | Type    | Required                               | Description                                           |
| ---------------- | ------- | -------------------------------------- | ----------------------------------------------------- |
| is_instrumental  | boolean | YES                                    | Discriminator                                         |
| genre            | string  | YES                                    | e.g. `"orchestral cinematic"`                         |
| mood             | string  | YES                                    | e.g. `"melancholic, hopeful"`                         |
| instrumentation  | string  | YES                                    | e.g. `"strings, piano, soft percussion"`              |
| tempo_bpm        | integer | NO                                     | Positive integer                                      |
| lyrics           | string  | YES when `is_instrumental=false` only | Forbidden when `is_instrumental=true`                 |

---

## API Endpoints

### List Music for Project

`GET` /api/v2/projects/{projectId}/music

→ `200` `[{ id, project_id, video_id, title, structured_prompt, audio_url, cover_image_url, duration, status, created_at, updated_at }]`

> Returns all music for the project (across all videos + project-wide).

---

### List Music for Video

`GET` /api/v2/videos/{videoId}/music

→ `200` `[{ id, project_id, video_id, title, structured_prompt, audio_url, cover_image_url, duration, status }]`

---

### Add Music (project-wide)

`POST` /api/v2/projects/{projectId}/music — async

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| title | string | ✓ | — | Track title |
| is_instrumental | boolean | ✓ | — | discriminator |
| genre | string | ✓ | — | |
| mood | string | ✓ | — | |
| instrumentation | string | ✓ | — | |
| tempo_bpm | integer | | — | optional; positive |
| lyrics | string | ✓ (if not instrumental) | — | required only when `is_instrumental=false`; must be absent when true |

→ `201` `{ id, video_id: null, status: "generating", ... }`

> Webhook updates `audio_url`, `duration`, `status`.

---

### Add Music (video-scoped)

`POST` /api/v2/videos/{videoId}/music — async

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| title | string | ✓ | — | Track title |
| is_instrumental | boolean | ✓ | — | discriminator |
| genre | string | ✓ | — | |
| mood | string | ✓ | — | |
| instrumentation | string | ✓ | — | |
| tempo_bpm | integer | | — | optional; positive |
| lyrics | string | ✓ (if not instrumental) | — | required only when `is_instrumental=false`; must be absent when true |

→ `201` `{ id, video_id, status: "generating", ... }`

> Webhook updates `audio_url`, `duration`, `status`.

---

### Get Music

`GET` /api/v2/music/{id}

→ `200` — full music object

---

### Update Music

`PATCH` /api/v2/music/{id}

| Field | Type | Notes |
|-------|------|-------|
| title | string | Track title |
| is_instrumental / genre / mood / instrumentation / tempo_bpm / lyrics | — | Any subset; merged into existing `structured_prompt`. Merged object must satisfy the strict typed schema (i.e. still a valid discriminated union). Switching `is_instrumental: true → false` requires sending `lyrics` in the same PATCH. |
| video_id | uuid | UUID = video-scoped, null = project-wide |

→ `200` — full music object

---

### Delete Music

`DELETE` /api/v2/music/{id}

→ `200` `{ id, deleted: true }`

---

## Error envelope on invalid `structured_prompt`

POST / PATCH return `400` with the shared envelope. Reasons include missing required fields, wrong types, or sending `lyrics` while `is_instrumental=true`.

```json
{
  "error": "structured_prompt is invalid",
  "path": "lyrics",
  "reason": "must be absent when is_instrumental=true (unrecognized: lyrics)",
  "expected": {
    "is_instrumental": "boolean",
    "genre": "string",
    "mood": "string",
    "instrumentation": "string",
    "tempo_bpm": "number (optional)",
    "lyrics": "string (required only when is_instrumental=false; must be absent when true)"
  }
}
```

- Missing `genre` when creating → `path: "genre"`, `reason: "required field missing"`.
- Sending `tempo_bpm: "fast"` → `path: "tempo_bpm"`, `reason: "must be number"`.
- Switching `is_instrumental: false → true` in a PATCH but leaving `lyrics` present → `path: "lyrics"`, `reason: "must be absent when is_instrumental=true..."`.
