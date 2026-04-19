# locations

> Schema: `studio` · Table: `locations`
> Related: [[PROJECTS]] → [[LOCATIONS]] → [[LOCATION-VARIANTS]]

## Contents
- [Table Structure](#table-structure)
- [API Endpoints](#api-endpoints)
  - [List Locations](#list-locations)
  - [Create Locations](#create-locations)
  - [Update Location](#update-location)
  - [Delete Location](#delete-location)

---

## Table Structure

| Column | Type | Nullable | Default | Constraint | Notes |
|--------|------|----------|---------|------------|-------|
| id | uuid | NO | gen_random_uuid() | PK | Auto-generated unique identifier |
| project_id | uuid | NO | — | FK → projects.id | Parent project |
| video_id | uuid | YES | — | FK → videos.id | null = project-level location |
| name | text | NO | — | | Display name |
| slug | text | NO | — | UNIQUE(project_id, slug) | kebab-case identifier |
| structured_prompt | jsonb | NO | — | | Typed shape `{ setting_type, time_of_day, era, extras? }` — validated server-side |
| use_case | text | NO | — | | Why this location exists in the production |
| sort_order | integer | NO | 0 | | Display ordering |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

## API Endpoints

### List Locations

`GET` /api/v2/projects/{projectId}/locations

→ `200` `[{ id, project_id, video_id, name, slug, structured_prompt, use_case, sort_order }]`

---

### Create Locations

`POST` /api/v2/projects/{projectId}/locations — batch

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| name | string | ✓ | — | Display name |
| slug | string | | auto | kebab-case; unique per project |
| video_id | uuid | | null | null = project-level location |
| setting_type | string | ✓ | — | typically `interior` or `exterior` |
| time_of_day | string | ✓ | — | `dawn` / `morning` / `dusk` / `night` / etc. |
| era | string | ✓ | — | free-form (`"1850s Ottoman"` / `"2450 AD"` / `"contemporary"`) |
| extras | string | | — | optional — architectural style, landmarks, mood, weather |
| use_case | string | ✓ | — | Why this location exists in the production |

→ `201` `[{ id, name, slug, video_id, structured_prompt, use_case }]`

---

### Update Location

`PATCH` /api/v2/locations/{id}

| Field | Type | Notes |
|-------|------|-------|
| name | string | Display name |
| slug | string | kebab-case; unique per project |
| setting_type / time_of_day / era / extras | — | Any subset. Merged into existing `structured_prompt`; merged object must still satisfy the strict typed schema |
| use_case | string | Why this location exists in the production |
| sort_order | integer | Display ordering |

→ `200` — full location object

---

### Delete Location

`DELETE` /api/v2/locations/{id}

→ `200` `{ id, deleted: true }`

> Cascades: deletes all location variants.

---

## Error envelope on invalid `structured_prompt`

Same shape as all other tables:

```json
{
  "error": "structured_prompt is invalid",
  "path": "era",
  "reason": "required field missing",
  "expected": {
    "setting_type": "string",
    "time_of_day": "string",
    "era": "string",
    "extras": "string (optional)"
  }
}
```
