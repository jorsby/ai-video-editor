# location_variants

> Schema: `studio` · Table: `location_variants`
> Related: [[LOCATIONS]] → [[LOCATION-VARIANTS]]
> Referenced by: [[SCENES]] (`location_variant_slug`)

## Contents
- [Table Structure](#table-structure)
- [API Endpoints](#api-endpoints)
  - [List Variants](#list-variants)
  - [Create Variants](#create-variants)
  - [Update Variant](#update-variant)
  - [Delete Variant](#delete-variant)
  - [Generate Image](#generate-image)

---

## Table Structure

| Column | Type | Nullable | Default | Constraint | Notes |
|--------|------|----------|---------|------------|-------|
| id | uuid | NO | gen_random_uuid() | PK | Auto-generated unique identifier |
| location_id | uuid | NO | — | FK → locations.id | Parent location this variant belongs to |
| name | text | NO | — | | Display name, e.g. "Market Kasa Bolgesi" |
| slug | text | NO | — | UNIQUE(location_id, slug) | Kebab-case identifier, e.g. "market-ici-kasa-bolgesi" |
| reference_slug | text | YES | — | | Slug of sibling variant whose image is used as i2i base. Null = use main variant image. |
| is_main | boolean | NO | false | | true = base location variant that represents the location's default view |
| structured_prompt | jsonb | NO | — | | Partial overlay — same typed fields as parent `locations.structured_prompt`, all optional. `{}` = use parent verbatim. Composer uses `variant[k] ?? parent[k]` per field. |
| use_case | text | NO | — | | Why this variant exists, e.g. "Close-up of checkout area for payment scene" |
| image_url | text | YES | — | | Generated image URL; populated after image generation |
| image_task_id | text | YES | — | | Async generation task ID; used to track generation progress |
| image_gen_status | text | NO | 'idle' | | idle · generating · completed · failed |
| generation_metadata | jsonb | YES | — | | Model name, parameters, and settings used for generation |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

## API Endpoints

### List Variants

`GET` /api/v2/locations/{locationId}/variants

→ `200` `[{ id, location_id, name, slug, reference_slug, is_main, structured_prompt, use_case, image_url, image_gen_status }]`

---

### Create Variants

`POST` /api/v2/locations/{locationId}/variants — batch

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| name | string | ✓ | — | Display name for this variant |
| slug | string | | auto | Kebab-case; unique per location |
| reference_slug | string | | null | Slug of sibling variant to use as i2i base. Must exist on the same asset. Cannot self-reference. |
| is_main | boolean | | false | true = base location variant |
| setting_type / time_of_day / era / extras | — | | — | Any subset of `LocationSP` fields to override on this variant. |
| use_case | string | ✓ | — | Why this variant exists |

→ `201` `[{ id, location_id, name, slug, reference_slug, is_main, structured_prompt, use_case }]`

---

### Update Variant

`PATCH` /api/v2/location-variants/{id}

| Field | Type | Notes |
|-------|------|-------|
| name | string | Display name |
| slug | string | Kebab-case; unique per location |
| reference_slug | string \| null | Set or clear the i2i base reference. Must exist on same asset. |
| setting_type / time_of_day / era / extras | — | Any subset; `null` removes a key from the overlay. Merged object validated against the partial typed schema |
| use_case | string | Why this variant exists |
| image_url | string | Generated image URL |

→ `200` — full variant object

---

### Delete Variant

`DELETE` /api/v2/location-variants/{id}

→ `200` `{ id, deleted: true }`

---

### Generate Image

`POST` /api/v2/location-variants/{id}/generate-image — async

_No body fields — the provider prompt is composed server-side from the parent + variant typed fields (`variant[k] ?? parent[k]` per field). There is no override._

→ `200` `{ task_id, model, variant_id, aspect_ratio }`

> **Main (is_main=true)** → text-to-image
> **Non-main** → image-to-image with fallback chain:
> 1. `reference_slug` variant image (if set and generation completed)
> 2. Main variant image (if available)
> 3. Fall back to text-to-image
> Webhook updates `image_url`, `image_gen_status`.

---

## Error envelope on invalid `structured_prompt`

Same shape as other tables. Every field optional on a variant, but each present field must type-check:

```json
{
  "error": "structured_prompt is invalid",
  "path": "era",
  "reason": "must be non-empty",
  "expected": {
    "setting_type": "string",
    "time_of_day": "string",
    "era": "string",
    "extras": "string (optional)"
  }
}
```
