# character_variants

> Schema: `studio` · Table: `character_variants`
> Related: [[CHARACTERS]] → [[CHARACTER-VARIANTS]]
> Referenced by: [[SCENES]] (`character_variant_slugs`)

## Contents
- [Table Structure](#table-structure)
- [Variant Slug Convention](#variant-slug-convention)
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
| character_id | uuid | NO | — | FK → characters.id | Parent character this variant belongs to |
| name | text | NO | — | | Display name, e.g. "Anne Bebek Kucakta" |
| slug | text | NO | — | UNIQUE(character_id, slug) | Kebab-case identifier, e.g. "market-anne-bebek-kucakta" |
| reference_slug | text | YES | — | | Slug of sibling variant whose image is used as i2i base. Null = use main variant image. |
| is_main | boolean | NO | false | | true = base identity variant that represents the character's default look |
| structured_prompt | jsonb | NO | — | | Partial overlay — same typed fields as parent `characters.structured_prompt`, all optional. `{}` = use parent verbatim. Composer uses `variant[k] ?? parent[k]` per field. |
| use_case | text | NO | — | | Why this variant exists, e.g. "Tired look after long day at market" |
| image_url | text | YES | — | | Generated image URL; populated after image generation |
| image_task_id | text | YES | — | | Async generation task ID; used to track generation progress |
| image_gen_status | text | NO | 'idle' | | idle · generating · completed · failed |
| generation_metadata | jsonb | YES | — | | Model name, parameters, and settings used for generation |
| created_at | timestamptz | NO | now() | | |
| updated_at | timestamptz | NO | now() | | |

## Variant Slug Convention

```
{asset-slug}-main          ← auto-created main variant
{asset-slug}-{detail}      ← non-main variant
```

Examples:
- Main: `market-anne-main` (is_main=true, auto-created with the asset)
- Variant: `market-anne-bebek-kucakta`
- Chained: `market-anne-bebek-kucakta-islak` (reference_slug → `market-anne-bebek-kucakta`)

Chaining rule: each new variant can reference a previous non-main variant via `reference_slug` as its i2i base, building on the previous state.

---

## API Endpoints

### List Variants

`GET` /api/v2/characters/{characterId}/variants

→ `200` `[{ id, character_id, name, slug, reference_slug, is_main, structured_prompt, use_case, image_url, image_gen_status }]`

---

### Create Variants

`POST` /api/v2/characters/{characterId}/variants — batch

| Field | Type | Req | Default | Notes |
|-------|------|:---:|---------|-------|
| name | string | ✓ | — | Display name for this variant |
| slug | string | | auto | Kebab-case; unique per character |
| reference_slug | string | | null | Slug of sibling variant to use as i2i base. Must exist on the same asset. Cannot self-reference. |
| is_main | boolean | | false | true = base identity variant |
| age / gender / era / appearance / outfit / extras | — | | — | Any subset of `CharacterSP` fields to override on this variant. Omit all for a main variant that inherits the parent. |
| use_case | string | ✓ | — | Why this variant exists |

→ `201` `[{ id, character_id, name, slug, reference_slug, is_main, structured_prompt, use_case }]`

---

### Update Variant

`PATCH` /api/v2/character-variants/{id}

| Field | Type | Notes |
|-------|------|-------|
| name | string | Display name |
| slug | string | Kebab-case; unique per character |
| reference_slug | string \| null | Set or clear the i2i base reference. Must exist on same asset. |
| age / gender / era / appearance / outfit / extras | — | Any subset; `null` removes a key from the overlay. Merged object is validated against the partial typed schema |
| use_case | string | Why this variant exists |
| image_url | string | Generated image URL |

→ `200` — full variant object

---

### Delete Variant

`DELETE` /api/v2/character-variants/{id}

→ `200` `{ id, deleted: true }`

---

### Generate Image

`POST` /api/v2/character-variants/{id}/generate-image — async

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

Invalid overlay fields return the shared 400 envelope:

```json
{
  "error": "structured_prompt is invalid",
  "path": "age",
  "reason": "must be number",
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

For a variant, every field is optional — but whatever you do send must match its type.
