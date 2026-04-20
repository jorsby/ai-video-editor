# scenes

> Schema: `studio` · Table: `scenes`
> Related: [[CHAPTERS]] → [[SCENES]] · Refs: [[CHARACTER-VARIANTS]] · [[LOCATION-VARIANTS]] · [[PROP-VARIANTS]]

## Contents
- [Table Structure](#table-structure)
- [API Endpoints](#api-endpoints)
  - [List Scenes](#list-scenes)
  - [Create Scenes](#create-scenes)
  - [Get Scene](#get-scene)
  - [Update Scene](#update-scene)
  - [Delete Scene](#delete-scene)
  - [Generate TTS](#generate-tts)
  - [Generate Video](#generate-video)
  - [Transcribe Scene](#transcribe-scene)

---

## Table Structure

| Column | Type | Nullable | Default | Constraint | Notes |
|--------|------|----------|---------|------------|-------|
| id | uuid | NO | gen_random_uuid() | PK | Auto-generated unique identifier |
| chapter_id | uuid | NO | — | FK → chapters.id | Parent chapter |
| order | integer | NO | — | UNIQUE(chapter_id, order) | Position in chapter; 1000-spaced for insertion |
| title | text | NO | — | | Scene display title |
| structured_prompt | jsonb | YES | — | | Typed array of shot objects — each item `{ order, shot_type, camera_movement, action, lighting, mood, setting_notes?, duration_from?, duration_to? }`. Validated server-side. Timing rule: either all shots have `duration_from`/`duration_to` or none do. When timed, they are **absolute seconds from scene start**, must be contiguous (`shots[i].duration_from === shots[i-1].duration_to`), first shot starts at 0, and `duration_to > duration_from` per shot. |
| location_variant_slug | text | YES | — | | @slug of location variant used in scene |
| character_variant_slugs | text[] | NO | '{}' | | Array of character variant slugs |
| prop_variant_slugs | text[] | NO | '{}' | | Array of prop variant slugs |
| audio_text | text | YES | — | | TTS input text |
| audio_url | text | YES | — | | Generated TTS audio URL |
| audio_duration | float8 | YES | — | | TTS duration in seconds |
| video_url | text | YES | — | | Generated video URL |
| video_duration | float8 | YES | — | | Video duration in seconds |
| status | scene_status | NO | 'ready' | | ready · in_progress · done · failed |
| tts_task_id | text | YES | — | | Async TTS task ID |
| tts_status | text | NO | 'idle' | | idle · generating · completed · failed |
| tts_generation_metadata | jsonb | YES | — | | TTS generation params |
| video_task_id | text | YES | — | | Async video task ID |
| video_status | text | NO | 'idle' | | idle · generating · completed · failed |
| video_generation_metadata | jsonb | YES | — | | Includes prompt_contract sub-object |
| has_speech | boolean | YES | — | | Video audio contains speech? |
| video_transcription | jsonb | YES | — | | Deepgram word-level (video audio) |
| voiceover_transcription | jsonb | YES | — | | Deepgram word-level (voiceover) |
| video_transcription_status | text | YES | — | | Transcription processing status |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

## API Endpoints

### List Scenes

`GET` /api/v2/chapters/{chapterId}/scenes

→ `200` `[{ id, chapter_id, order, title, structured_prompt, location_variant_slug, character_variant_slugs, prop_variant_slugs, audio_text, audio_url, audio_duration, video_url, video_duration, status, tts_status, video_status }]`

---

### Create Scenes

`POST` /api/v2/chapters/{chapterId}/scenes — batch

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| title | string | ✓ | — | Scene display title |
| location_variant_slug | string | ✓ | — | @slug of location variant |
| structured_prompt | array | | — | Shot array — each element `{ order, shot_type, camera_movement, action, lighting, mood, setting_notes?, duration_from?, duration_to? }`. `order`, `shot_type`, `camera_movement`, `action`, `lighting`, `mood` are required per shot. Timing is optional but all-or-nothing: either every shot has both `duration_from` and `duration_to` (absolute seconds from scene start, contiguous, first shot starts at 0) or no shot does. When timed, scene video duration = `max(duration_to)` and each shot line is sent to the provider prefixed with `Xs-Ys:`. |
| character_variant_slugs | string[] | | `[]` | Array of character variant slugs |
| prop_variant_slugs | string[] | | `[]` | Array of prop variant slugs |
| audio_text | string | | — | TTS input text |
| order | integer | | auto 1000-spaced | Position in chapter |

→ `201` `{ scenes: [{ id, chapter_id, order, title }], warnings: [{ scene_index, field, message }] }`

> `warnings` flags empty optional slug fields.

---

### Get Scene

`GET` /api/v2/scenes/{id}

→ `200` `{ id, chapter_id, order, title, structured_prompt, location_variant_slug, character_variant_slugs, prop_variant_slugs, audio_text, audio_url, audio_duration, video_url, video_duration, status, tts_status, video_status, has_speech, video_transcription, voiceover_transcription, ... }`

---

### Update Scene

`PATCH` /api/v2/scenes/{id}

| Field | Type | Notes |
|-------|------|-------|
| title | string | Scene display title |
| order | integer | Position in chapter |
| location_variant_slug | string | @slug of location variant |
| character_variant_slugs | string[] | Array of character variant slugs |
| prop_variant_slugs | string[] | Array of prop variant slugs |
| structured_prompt | array | Full replace — send the whole shot array. Each shot validated element-wise against the typed schema |
| audio_text | string | TTS input text |
| status | enum | ready · in_progress · done · failed |

→ `200` — full scene object

---

### Delete Scene

`DELETE` /api/v2/scenes/{id}

→ `200` `{ id, deleted: true }`

---

### Generate TTS

`POST` /api/v2/scenes/{id}/generate-tts — async

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| provider | string | | "kie" | `"kie"` or `"fal"` |
| voice_id | string | | from project settings | ElevenLabs voice ID |
| speed | number | | from project settings or 1.0 | Range: 0.7–1.2 |
| previous_text | string | | — | Context for prosody continuity |
| next_text | string | | — | Context for prosody continuity |
| language_code | string | | — | Language hint for TTS engine |

→ `200` `{ task_id, model, provider, scene_id, voice_id, speed }`

> Requires `audio_text` on scene. Webhook updates `audio_url`, `audio_duration`, `tts_status`, `voiceover_transcription`.

---

### Generate Video

`POST` /api/v2/scenes/{id}/generate-video — async

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| duration | integer | | auto | 6–30s. Priority: **timed shots → body → audio_duration → video_duration → 6**. When the scene's shots all carry `duration_from`/`duration_to`, `max(duration_to)` wins unconditionally (ignores `body.duration`). |
| resolution | string | | from project settings | `"480p"` or `"720p"` |
| provider | string | | "kie" | `"kie"` or `"fal"` |
| image_urls_override | string[] | | — | Bypass variant image lookup |

→ `200` `{ task_id, provider, model, scene_id, duration, duration_source, duration_clamped, aspect_ratio, resolution, image_count }`

- `duration_source`: `"shots" | "body" | "audio" | "video" | "default"` — which rule produced the duration.
- `duration_clamped`: `true` when the requested duration was outside 6–30s and clamped.

> Auto-assembles block text from `structured_prompt`, compiles via `compileForGrok()` (replaces @variant-slugs with @imageN + image_urls[]).
> When all shots have `duration_from`/`duration_to`, each line is prefixed `Xs-Ys:` in the provider prompt; the scene video duration is `max(duration_to)`.
> Scenes with `audio_text` require TTS first. If the voiceover is longer than the timed shots total, the request is rejected with `SHOT_DURATION_TOO_SHORT`.
> Webhook updates `video_url`, `video_duration`, `video_status`.

---

### Transcribe Scene

`POST` /api/v2/scenes/{id}/transcribe — cached

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| source | string | | "video" | `"video"`, `"voiceover"`, or `"both"` |

→ `200` `{ scene_id, video_transcription, voiceover_transcription, has_speech }`

> Checks transcriptions cache first. On miss, calls Deepgram nova-3, caches result, stores summary on scene record.

---

## Error envelope on invalid `structured_prompt`

POST and PATCH return `400` with the shared envelope when any shot in the array fails validation. The whole request is rejected (nothing written):

```json
{
  "error": "structured_prompt is invalid",
  "path": "scenes[0].structured_prompt[1].mood",
  "reason": "required field missing",
  "expected": {
    "shots": "array of scene-shot objects (min 1) — each shot uses the scene-shot schema",
    "shots[].order": "number",
    "shots[].shot_type": "string",
    "shots[].camera_movement": "string",
    "shots[].action": "string",
    "shots[].lighting": "string",
    "shots[].mood": "string",
    "shots[].setting_notes": "string (optional)",
    "shots[].duration_from": "number (optional, seconds from scene start; must equal previous shot duration_to, or 0 for first shot)",
    "shots[].duration_to": "number (optional, seconds from scene start; must be > duration_from)",
    "shots.timing": "all shots must be timed, or none; when timed: contiguous, first starts at 0, duration_to > duration_from"
  }
}
```

- `path` pinpoints the offending shot and field (e.g. `scenes[0].structured_prompt[1].mood`).
- Batch POST is atomic — a single invalid shot rejects the entire request.
- Common `reason` strings for timing violations:
  - `all shots must have duration_from/duration_to, or none` — partial timing.
  - `first shot must start at 0`.
  - `must equal previous shot's duration_to (got X, expected Y)` — gap or overlap.
  - `must be greater than duration_from` — zero-length shot.
