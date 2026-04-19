# characters

> Schema: `studio` · Table: `characters`
> Related: [[PROJECTS]] → [[CHARACTERS]] → [[CHARACTER-VARIANTS]]

## Contents
- [Table Structure](#table-structure)
- [API Endpoints](#api-endpoints)
  - [List Characters](#list-characters)
  - [Create Characters](#create-characters)
  - [Update Character](#update-character)
  - [Delete Character](#delete-character)

---

## Table Structure

| Column | Type | Nullable | Default | Constraint | Notes |
|--------|------|----------|---------|------------|-------|
| id | uuid | NO | gen_random_uuid() | PK | Auto-generated unique identifier |
| project_id | uuid | NO | — | FK → projects.id | Parent project |
| video_id | uuid | YES | — | FK → videos.id | null = project-level character |
| name | text | NO | — | | Display name |
| slug | text | NO | — | UNIQUE(project_id, slug) | kebab-case identifier |
| role | character_role | NO | — | | LEAD · SUPPORTING · GUEST · MINOR · EXTRA |
| structured_prompt | jsonb | NO | — | | Typed shape `{ age, gender, era, appearance, outfit, extras? }` — validated server-side |
| use_case | text | NO | — | | Role in production |
| sort_order | integer | NO | 0 | | Display ordering |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

## API Endpoints

### List Characters

`GET` /api/v2/projects/{projectId}/characters

→ `200` `[{ id, project_id, video_id, name, slug, role, structured_prompt, use_case, sort_order }]`

---

### Create Characters

`POST` /api/v2/projects/{projectId}/characters — batch

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| name | string | ✓ | — | Display name |
| slug | string | | auto | kebab-case; unique per project |
| video_id | uuid | | null | null = project-level character |
| role | enum | ✓ | — | LEAD · SUPPORTING · GUEST · MINOR · EXTRA |
| age | integer | ✓ | — | non-negative |
| gender | string | ✓ | — | non-empty |
| era | string | ✓ | — | free-form (`"1850s Ottoman"` / `"2450 AD, Mars"` / `"contemporary"`) |
| appearance | string | ✓ | — | hair, eyes, build, skin, etc. |
| outfit | string | ✓ | — | clothing description |
| extras | string | | — | optional — distinguishing features, ethnicity, mood |
| use_case | string | ✓ | — | Role in production |

→ `201` `[{ id, name, slug, video_id, role, structured_prompt, use_case }]`

---

### Update Character

`PATCH` /api/v2/characters/{id}

| Field | Type | Notes |
|-------|------|-------|
| name | string | Display name |
| slug | string | kebab-case; unique per project |
| role | enum | LEAD · SUPPORTING · GUEST · MINOR · EXTRA |
| age / gender / era / appearance / outfit / extras | — | Any subset. Merged into existing `structured_prompt`; merged object must still satisfy the strict typed schema (so you can't null out a required field) |
| use_case | string | Role in production |
| sort_order | integer | Display ordering |

→ `200` — full character object

---

### Delete Character

`DELETE` /api/v2/characters/{id}

→ `200` `{ id, deleted: true }`

> Cascades: deletes all character variants.

---

## Error envelope on invalid `structured_prompt`

POST / PATCH return `400` with the shared envelope when any typed-field
value fails validation:

```json
{
  "error": "structured_prompt is invalid",
  "path": "age",
  "reason": "required field missing",
  "expected": {
    "age": "number",
    "gender": "string",
    "era": "string",
    "appearance": "string",
    "outfit": "string",
    "extras": "string (optional)"
  }
}
```

- `path` — dot path to the offending field (e.g. `age`, `structured_prompt.outfit`).
- `reason` — e.g. `required field missing`, `must be non-empty`, `must be number`.
- `expected` — the full field→type hint map for this endpoint so the caller can self-correct.

Batch POST rejects the entire request on any single item's failure; nothing is written.
