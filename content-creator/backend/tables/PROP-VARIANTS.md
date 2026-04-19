# prop_variants

> Schema: `studio` · Table: `prop_variants`
> Related: [[PROPS]] → [[PROP-VARIANTS]]
> Referenced by: [[SCENES]] (`prop_variant_slugs`)

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
| prop_id | uuid | NO | — | FK → props.id | Parent prop this variant belongs to |
| name | text | NO | — | | Display name, e.g. "Cuzdan Acik" |
| slug | text | NO | — | UNIQUE(prop_id, slug) | Kebab-case identifier, e.g. "eski-cuzdan-acik" |
| reference_slug | text | YES | — | | Slug of sibling variant whose image is used as i2i base. Null = use main variant image. |
| is_main | boolean | NO | false | | true = base prop variant that represents the prop's default look |
| structured_prompt | jsonb | NO | — | | Partial overlay — same typed fields as parent `props.structured_prompt`, all optional. `{}` = use parent verbatim. Composer uses `variant[k] ?? parent[k]`. |
| use_case | text | NO | — | | Why this variant exists, e.g. "Open wallet showing empty card slots" |
| image_url | text | YES | — | | Generated image URL; populated after image generation |
| image_task_id | text | YES | — | | Async generation task ID; used to track generation progress |
| image_gen_status | text | NO | 'idle' | | idle · generating · completed · failed |
| generation_metadata | jsonb | YES | — | | Model name, parameters, and settings used for generation |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

## API Endpoints

### List Variants

`GET` /api/v2/props/{propId}/variants

→ `200` `[{ id, prop_id, name, slug, reference_slug, is_main, structured_prompt, use_case, image_url, image_gen_status }]`

---

### Create Variants

`POST` /api/v2/props/{propId}/variants — batch

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| name | string | ✓ | — | Display name for this variant |
| slug | string | | auto | Kebab-case; unique per prop |
| reference_slug | string | | null | Slug of sibling variant to use as i2i base. Must exist on the same asset. Cannot self-reference. |
| is_main | boolean | | false | true = base prop variant |
| prompt / brand | — | | — | Any subset of `PropSP` fields to override on this variant. |
| use_case | string | ✓ | — | Why this variant exists |

→ `201` `[{ id, prop_id, name, slug, reference_slug, is_main, structured_prompt, use_case }]`

---

### Update Variant

`PATCH` /api/v2/prop-variants/{id}

| Field | Type | Notes |
|-------|------|-------|
| name | string | Display name |
| slug | string | Kebab-case; unique per prop |
| reference_slug | string \| null | Set or clear the i2i base reference. Must exist on same asset. |
| is_main | boolean | true = base prop variant |
| prompt / brand | — | Any subset; `null` removes a key from the overlay. Merged object validated against the partial typed schema |
| use_case | string | Why this variant exists |
| image_url | string | Generated image URL |

→ `200` — full variant object

---

### Delete Variant

`DELETE` /api/v2/prop-variants/{id}

→ `200` `{ id, deleted: true }`

---

### Generate Image

`POST` /api/v2/prop-variants/{id}/generate-image — async

_No body fields — the provider prompt is composed server-side from the parent + variant typed fields (`variant[k] ?? parent[k]`). There is no override._

→ `200` `{ task_id, model, variant_id, aspect_ratio }`

> **Main (is_main=true)** → text-to-image
> **Non-main** → image-to-image with fallback chain:
> 1. `reference_slug` variant image (if set and generation completed)
> 2. Main variant image (if available)
> 3. Fall back to text-to-image

---

## Error envelope on invalid `structured_prompt`

Same shape as other tables. Variant fields are all optional, but each present field must type-check:

```json
{
  "error": "structured_prompt is invalid",
  "path": "prompt",
  "reason": "must be non-empty",
  "expected": {
    "prompt": "string",
    "brand": "string (optional)"
  }
}
```
> Webhook updates `image_url`, `image_gen_status`.
