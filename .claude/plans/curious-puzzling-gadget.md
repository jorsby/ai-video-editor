# Plan: Per-Asset-Type Image Model Selection (t2i + i2i)

## Context

Currently all image generation uses a single hardcoded model (`flux-2/pro-text-to-image`) for every variant. We're migrating to:

**Text-to-image (main variants — first creation):**
- Characters/Props → `z-image` (cheaper, same quality)
- Locations → `gpt-image/1.5-text-to-image` (better backgrounds, cheaper)

**Image-to-image (non-main variants — uses main variant's image as reference for consistency):**
- Characters/Props → `flux-2/pro-image-to-image` (keeps face/appearance consistent)
- Locations → `gpt-image/1.5-image-to-image` (edits the base location)

All 5 models are on kie.ai, same `createTask` API. Configurable per asset type from Video Settings UI.

## 5 Model Input Specs

| Model | Type | Aspect Ratios | Params |
|-------|------|--------------|--------|
| `z-image` | t2i | 1:1, 4:3, 3:4, 16:9, 9:16 | nsfw_checker |
| `gpt-image/1.5-text-to-image` | t2i | 1:1, 2:3, 3:2 | quality (medium/high) |
| `flux-2/pro-text-to-image` | t2i | all 7 | resolution (1K/2K/4K), nsfw_checker |
| `flux-2/pro-image-to-image` | i2i | all 7 + auto | input_urls (1-8), resolution (1K/2K), nsfw_checker |
| `gpt-image/1.5-image-to-image` | i2i | 1:1, 2:3, 3:2 | input_urls (max 16), quality (medium/high) |

## Files to Modify

### 1. Migration: `supabase/migrations/20260408130000_add_per_asset_image_models.sql`

Add `image_models JSONB` to `studio.videos`. Stores t2i model per asset type.
i2i models are code-level defaults (not in DB — simpler, can add later if needed).

```sql
ALTER TABLE studio.videos
  ADD COLUMN IF NOT EXISTS image_models JSONB;

-- Backfill existing videos: preserve current Flux 2 Pro behavior
UPDATE studio.videos
SET image_models = jsonb_build_object(
  'character', COALESCE(image_model, 'flux-2/pro-text-to-image'),
  'location', COALESCE(image_model, 'flux-2/pro-text-to-image'),
  'prop', COALESCE(image_model, 'flux-2/pro-text-to-image')
)
WHERE image_models IS NULL;
```

Old `image_model` column stays (backward compat, not dropped).

### 2. `editor/src/lib/kie-image.ts` — Model registry (5 models)

Replace hardcoded `KIE_IMAGE_MODEL` with a config registry for all 5 models.

```typescript
export type ImageModelId =
  | 'z-image'
  | 'gpt-image/1.5-text-to-image'
  | 'flux-2/pro-text-to-image'
  | 'flux-2/pro-image-to-image'
  | 'gpt-image/1.5-image-to-image';

interface ImageModelConfig {
  supportedAspectRatios: Set<string>;
  defaultAspectRatio: string;
  buildInput: (p: {
    prompt: string;
    aspectRatio: string;
    resolution?: string;
    inputUrls?: string[];
  }) => Record<string, unknown>;
}
```

Five configs:
- **z-image**: 5 ratios, `{ prompt, aspect_ratio, nsfw_checker: false }`
- **gpt-image/1.5-text-to-image**: 3 ratios, `{ prompt, aspect_ratio, quality: 'high' }`
- **flux-2/pro-text-to-image**: 7 ratios, `{ prompt, aspect_ratio, resolution, nsfw_checker: false }`
- **flux-2/pro-image-to-image**: 7+auto ratios, `{ input_urls, prompt, aspect_ratio, resolution, nsfw_checker: false }`
- **gpt-image/1.5-image-to-image**: 3 ratios, `{ input_urls, prompt, aspect_ratio, quality: 'high' }`

Add `normalizeAspectRatioForModel(modelId, requested)` — maps unsupported ratios:
- GPT Image models: 9:16→2:3, 16:9→3:2, 4:3→3:2, 3:4→2:3
- Z-Image: 3:2→4:3, 2:3→3:4

Refactor `queueKieImageTask` to accept `{ model?, inputUrls? }`, look up config, call `buildInput`.

Keep `KIE_IMAGE_MODEL` export as backward-compat default.

### 3. `editor/src/lib/image-provider.ts` — Facade + resolvers

```typescript
export interface ImageTaskParams {
  prompt: string;
  webhookUrl: string;
  model?: string;         // NEW
  inputUrls?: string[];   // NEW (for i2i)
  aspectRatio?: string;
  resolution?: string;
}
```

Add helpers:

```typescript
// T2I defaults (configurable via DB)
export const DEFAULT_T2I_MODELS: Record<string, ImageModelId> = {
  character: 'z-image',
  location: 'gpt-image/1.5-text-to-image',
  prop: 'z-image',
};

// I2I defaults (code-level, not configurable from UI yet)
export const DEFAULT_I2I_MODELS: Record<string, ImageModelId> = {
  character: 'flux-2/pro-image-to-image',
  location: 'gpt-image/1.5-image-to-image',
  prop: 'flux-2/pro-image-to-image',
};

export function getT2iModel(
  imageModels: Record<string, string> | null | undefined,
  assetType: string,
): ImageModelId { ... }

export function getI2iModel(assetType: string): ImageModelId { ... }
```

### 4. Callers — main vs non-main logic

#### `editor/src/app/api/v2/variants/[id]/generate-image/route.ts`

This is the single-variant regeneration endpoint. Already fetches `variant.is_main`, `asset.type`, `video`.

Changes:
- Add `image_models` to video select
- Add `is_main` to variant select (already has it)
- **If `variant.is_main` → use t2i model** (resolved from `video.image_models` + `asset.type`)
- **If NOT main → find main variant's `image_url`:**
  ```typescript
  const { data: mainVariant } = await supabase
    .from('project_asset_variants')
    .select('image_url')
    .eq('asset_id', variant.asset_id)
    .eq('is_main', true)
    .maybeSingle();
  ```
  - If `mainVariant?.image_url` exists → use i2i model with `inputUrls: [mainVariant.image_url]`
  - If no main image → fall back to t2i (main hasn't been generated yet)
- Pass `model` and optionally `inputUrls` to `queueImageTask`

#### `editor/src/app/api/v2/projects/[id]/generate-images/batch/route.ts`

- Add `image_models` to video select
- Each variant already has `asset.type` and we can check `is_main` (need to add to select)
- Per-variant in loop: resolve model based on is_main → t2i or i2i
- For i2i variants, need to look up main variant's image_url per asset

#### `editor/src/lib/api/v2-asset-helpers.ts`

**`autoGenerateImages`**: Add `model?: string` and `inputUrls?: string[]` params, pass through to `queueImageTask`.

**`postAssetsByType`** (line 235): Creates main variants → always t2i.
- Add `image_models` to video select (line 397)
- Resolve t2i model from `type` param
- Pass to `autoGenerateImages`

**`postVariantsByAsset`** (line 581): Creates non-main variants.
- Add `image_models` to video select (line 675)
- Find main variant's `image_url` for this asset
- If main image exists → i2i model + inputUrls
- If no main image → fall back to t2i
- Pass model + inputUrls to `autoGenerateImages`

### 5. PATCH video route: `editor/src/app/api/v2/videos/[id]/route.ts`

- Add `image_models` to `SERIES_SELECT` (line 13)
- Add JSONB handler (~line 205):
```typescript
if (body?.image_models !== undefined) {
  if (body.image_models !== null && !isRecord(body.image_models)) {
    return NextResponse.json(
      { error: 'image_models must be an object or null' },
      { status: 400 },
    );
  }
  updates.image_models = body.image_models;
}
```

### 6. Create video route: `editor/src/app/api/v2/videos/create/route.ts`

- Accept optional `image_models` in body
- Include in insert: `image_models: imageModels ?? null`
- Remove `image_model` from required fields (line 72) — becomes optional

### 7. Settings UI: `editor/src/components/editor/media-panel/panel/video-settings-panel.tsx`

Update `IMAGE_MODEL_OPTIONS`:
```typescript
const IMAGE_MODEL_OPTIONS = [
  { value: 'z-image', label: 'Z-Image' },
  { value: 'gpt-image/1.5-text-to-image', label: 'GPT Image 1.5' },
  { value: 'flux-2/pro-text-to-image', label: 'Flux 2 Pro (2K)' },
];
```

- Add `image_models` to `VideoSettings` interface and load select
- Replace single "Image Model" dropdown with 3 dropdowns:
  - "Character Model" → `image_models.character`
  - "Location Model" → `image_models.location`
  - "Prop Model" → `image_models.prop`
- Helper for nested updates:
```typescript
const updateImageModel = (assetType: string, value: string) => {
  const current = { ...(merged.image_models ?? DEFAULT_T2I_MODELS) };
  current[assetType] = value;
  updateDraft('image_models', current);
};
```

Note: i2i models are NOT shown in UI — they're code defaults. Can add later if needed.

### 8. Docs: `docs/API-COOKBOOK.md`

Update image generation sections:
- Document `image_models` JSONB field on videos
- Document per-type model selection (t2i defaults + i2i behavior)
- Document that main variants use t2i, non-main use i2i with main's image as reference
- Update variant generation examples
- Note available models: z-image, gpt-image/1.5-text-to-image, flux-2/pro-text-to-image

## Aspect Ratio Mapping

| Requested | Z-Image | GPT Image (both) | Flux (both) |
|-----------|---------|-------------------|-------------|
| 1:1 | 1:1 | 1:1 | 1:1 |
| 4:3 | 4:3 | 3:2 | 4:3 |
| 3:4 | 3:4 | 2:3 | 3:4 |
| 16:9 | 16:9 | 3:2 | 16:9 |
| 9:16 | 9:16 | 2:3 | 9:16 |
| 3:2 | 4:3 | 3:2 | 3:2 |
| 2:3 | 3:4 | 2:3 | 2:3 |

## Data Flow

### Main variant (t2i):
1. Asset created → main variant created → `autoGenerateImages(model=t2i)` fire-and-forget
2. `queueImageTask({ model, prompt })` → `createTask` → kie.ai → webhook → `image_url` saved

### Non-main variant (i2i):
1. Additional variant created → `autoGenerateImages` checks main variant's `image_url`
2. If main has image → `queueImageTask({ model=i2i, inputUrls=[mainImageUrl], prompt })` → kie.ai → webhook
3. If main has NO image yet → falls back to t2i (graceful degradation)

### Explicit regeneration:
1. `POST /api/v2/variants/{id}/generate-image`
2. Check `is_main` → t2i or i2i
3. For i2i: fetch main variant's `image_url`, pass as `inputUrls`

## Migration Safety

- Old `image_model` column kept (not dropped)
- Existing videos backfilled to Flux 2 Pro for all types (preserves behavior)
- New videos get new defaults
- `getT2iModel` falls back to defaults if `image_models` is null
- i2i gracefully degrades to t2i if main image not available
- Webhook `extractImageUrl` already handles all response formats

## Verification

1. `cd editor && pnpm build` — must pass
2. `pnpm biome check .` — must pass
3. Create new video → verify `image_models` defaults
4. Generate main character variant → verify Z-Image model used
5. Generate main location variant → verify GPT Image 1.5 t2i used
6. Generate non-main character variant (main has image) → verify Flux i2i used with main's image
7. Generate non-main location variant → verify GPT Image i2i used
8. Generate non-main variant when main has no image → verify t2i fallback
9. Change models in Video Settings → save → regenerate → verify new model
10. Existing video (backfilled Flux) → generate → still uses Flux
