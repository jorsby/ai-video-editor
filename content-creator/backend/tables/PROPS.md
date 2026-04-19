# props

> Schema: `studio` · Table: `props`
> Related: [[PROJECTS]] → [[PROPS]] → [[PROP-VARIANTS]]

## Contents
- [Table Structure](#table-structure)
- [API Endpoints](#api-endpoints)
  - [List Props](#list-props)
  - [Create Props](#create-props)
  - [Update Prop](#update-prop)
  - [Delete Prop](#delete-prop)

---

## Table Structure

| Column | Type | Nullable | Default | Constraint | Notes |
|--------|------|----------|---------|------------|-------|
| id | uuid | NO | gen_random_uuid() | PK | Auto-generated unique identifier |
| project_id | uuid | NO | — | FK → projects.id | Parent project |
| video_id | uuid | YES | — | FK → videos.id | null = project-level prop |
| name | text | NO | — | | Display name |
| slug | text | NO | — | UNIQUE(project_id, slug) | kebab-case identifier |
| structured_prompt | jsonb | NO | — | | Typed shape `{ prompt, brand? }` — validated server-side |
| use_case | text | NO | — | | Why this prop exists in the production |
| sort_order | integer | NO | 0 | | Display ordering |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

## API Endpoints

### List Props

`GET` /api/v2/projects/{projectId}/props

→ `200` `[{ id, project_id, video_id, name, slug, structured_prompt, use_case, sort_order }]`

---

### Create Props

`POST` /api/v2/projects/{projectId}/props — batch

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| name | string | ✓ | — | Display name |
| slug | string | | auto | kebab-case; unique per project |
| video_id | uuid | | null | null = project-level prop |
| prompt | string | ✓ | — | free-form description of the prop |
| brand | string | | — | optional — if the prop has a real-world brand |
| use_case | string | ✓ | — | Why this prop exists in the production |

→ `201` `[{ id, name, slug, video_id, structured_prompt, use_case }]`

---

### Update Prop

`PATCH` /api/v2/props/{id}

| Field | Type | Notes |
|-------|------|-------|
| name | string | Display name |
| slug | string | kebab-case; unique per project |
| prompt / brand | — | Any subset. Merged into existing `structured_prompt`; merged object must still satisfy the strict typed schema (so you cannot null out `prompt`) |
| use_case | string | Why this prop exists in the production |
| sort_order | integer | Display ordering |

→ `200` — full prop object

---

### Delete Prop

`DELETE` /api/v2/props/{id}

→ `200` `{ id, deleted: true }`

> Cascades: deletes all prop variants.

---

## Error envelope on invalid `structured_prompt`

Same shape as other tables:

```json
{
  "error": "structured_prompt is invalid",
  "path": "prompt",
  "reason": "required field missing",
  "expected": {
    "prompt": "string",
    "brand": "string (optional)"
  }
}
```
