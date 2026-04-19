# videos

> Schema: `studio` · Table: `videos`
> Related: [[PROJECTS]] → [[VIDEOS]] → [[CHAPTERS]]

## Contents
- [Table Structure](#table-structure)
- [API Endpoints](#api-endpoints)
  - [Create Video](#create-video)
  - [Get Video](#get-video)
  - [Update Video](#update-video)
  - [Delete Video](#delete-video)

---

## Table Structure

| Column | Type | Nullable | Default | Constraint | Notes |
|--------|------|----------|---------|------------|-------|
| id | uuid | NO | gen_random_uuid() | PK | Auto-generated unique identifier |
| project_id | uuid | NO | — | FK → projects.id | Parent project |
| user_id | uuid | NO | — | FK → auth.users.id | Video owner |
| name | text | NO | — | | Display title |
| synopsis | text | NO | — | | Story synopsis |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

---

## API Endpoints

### Create Video

`POST` /api/v2/videos/create

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| project_id | uuid | ✓ | — | Parent project ID |
| name | string | ✓ | — | Display title |
| synopsis | string | ✓ | — | Story synopsis |

→ `201` `{ id, project_id, name, synopsis }`

---

### Get Video

`GET` /api/v2/videos/{id}

→ `200` `{ id, project_id, name, synopsis, created_at, updated_at }`

---

### Update Video

`PATCH` /api/v2/videos/{id}

| Field | Type | Notes |
|-------|------|-------|
| name | string | Display title |
| synopsis | string | Story synopsis |

→ `200` `{ id, project_id, name, synopsis, updated_at }`

---

### Delete Video

`DELETE` /api/v2/videos/{id}

→ `200` `{ id, deleted: true }`

> Cascades: deletes all chapters, scenes, assets, variants.
