# V2 API Endpoints Spec — LLM-Driven Funnel

## Overview
Build CRUD endpoints for the production funnel: Project → Video → Chapters → Assets → Variants → Scenes → Asset Map.

All endpoints live in `editor/src/app/api/v2/`.

## Auth Pattern
Every endpoint (except webhooks) uses:
```ts
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
```

## DB Schema (studio schema)
All tables in `studio` schema. Use `createServiceClient('studio')`.

### projects
- id UUID PK
- user_id UUID
- name TEXT NOT NULL
- description TEXT
- created_at, updated_at TIMESTAMPTZ

### video
- id UUID PK
- project_id UUID FK→projects
- user_id UUID
- name TEXT NOT NULL
- genre TEXT, tone TEXT, bible TEXT
- content_mode ENUM ('narrative','cinematic','hybrid') DEFAULT 'narrative'
- language TEXT, aspect_ratio TEXT
- video_model TEXT, image_model TEXT, voice_id TEXT, tts_speed NUMERIC
- visual_style TEXT
- creative_brief JSONB
- plan_status ENUM ('draft','finalized') DEFAULT 'draft'
- created_at, updated_at

### series_assets
- id UUID PK
- video_id UUID FK→video
- type ENUM ('character','location','prop')
- name TEXT NOT NULL
- slug TEXT NOT NULL (UNIQUE with video_id)
- description TEXT
- sort_order INTEGER DEFAULT 0
- created_at, updated_at

### series_asset_variants
- id UUID PK
- asset_id UUID FK→series_assets
- name TEXT NOT NULL
- slug TEXT NOT NULL (UNIQUE with asset_id)
- prompt TEXT
- image_url TEXT
- is_default BOOLEAN DEFAULT false
- where_to_use TEXT, reasoning TEXT
- created_at, updated_at

### chapters
- id UUID PK
- video_id UUID FK→video
- "order" INTEGER NOT NULL (>0, UNIQUE with video_id)
- title TEXT, synopsis TEXT
- audio_content TEXT, visual_outline TEXT
- asset_variant_map JSONB DEFAULT '{"characters":[],"locations":[],"props":[]}'
- plan_json JSONB
- status ENUM ('draft','ready','in_progress','done') DEFAULT 'draft'
- created_at, updated_at

### scenes
- id UUID PK
- chapter_id UUID FK→chapters
- "order" INTEGER NOT NULL (>0, UNIQUE with chapter_id)
- title TEXT
- duration INTEGER (nullable, >0 if set)
- content_mode ENUM same as video
- visual_direction TEXT, prompt TEXT
- location_variant_slug TEXT
- character_variant_slugs TEXT[] DEFAULT '{}'
- prop_variant_slugs TEXT[] DEFAULT '{}'
- audio_text TEXT, audio_url TEXT
- video_url TEXT
- status ENUM ('draft','ready','in_progress','done','failed') DEFAULT 'draft'
- created_at, updated_at

## Order Logic
- Start at 1000, increment by 1000
- Insert-between: (prev + next) / 2
- The API should accept explicit `order` values OR auto-calculate them

## Endpoints to Build

### 1. Projects
File: `api/v2/projects/route.ts`
- POST: Create project {name, description?} → returns {id, name, description}
- GET: List user's projects

File: `api/v2/projects/[id]/route.ts`
- GET: Get project by ID
- PATCH: Update project {name?, description?}

### 2. Video
File: `api/v2/video/[id]/route.ts`
- GET: Get video with all fields
- PATCH: Update video (any field)

(POST create already exists at `api/v2/video/create/route.ts` — skip)

### 3. Chapters
File: `api/v2/video/[videoId]/chapters/route.ts`
- POST: Create chapters (JSON array) — auto-order starting at 1000, increment 1000
- GET: List all chapters for video (ordered)

File: `api/v2/chapters/[id]/route.ts`
- GET: Get single chapter
- PATCH: Update chapter (full JSON replace for provided fields)
- DELETE: Delete chapter

### 4. Characters (type='character')
File: `api/v2/video/[videoId]/characters/route.ts`
- POST: Create characters (JSON array) — auto-creates default variant per character
- GET: List all characters for video

File: `api/v2/characters/[id]/route.ts`
- PATCH: Update character
- DELETE: Delete character (cascades variants)

### 5. Locations (type='location')
File: `api/v2/video/[videoId]/locations/route.ts`
- POST: Create locations (JSON array) — auto-creates default variant
- GET: List all locations for video

File: `api/v2/locations/[id]/route.ts`
- PATCH: Update location
- DELETE: Delete location

### 6. Props (type='prop')
File: `api/v2/video/[videoId]/props/route.ts`
- POST: Create props (JSON array) — auto-creates default variant
- GET: List all props for video

File: `api/v2/props/[id]/route.ts`
- PATCH: Update prop
- DELETE: Delete prop

### 7. Variants (shared)
File: `api/v2/assets/[assetId]/variants/route.ts`
- POST: Create variant(s) for any asset
- GET: List variants for asset

File: `api/v2/variants/[id]/route.ts`
- PATCH: Update variant
- DELETE: Delete variant

### 8. Scenes
File: `api/v2/chapters/[chapterId]/scenes/route.ts`
- POST: Create scenes (JSON array) — auto-order 1000/2000/3000...
- GET: List all scenes for chapter (ordered)

File: `api/v2/scenes/[id]/route.ts`
- GET: Get single scene
- PATCH: Update scene
- DELETE: Delete scene

### 9. Asset Map
File: `api/v2/chapters/[chapterId]/map-assets/route.ts`
- POST: Auto-map assets from scene slugs to chapter.asset_variant_map
  Logic: read all scenes for chapter, collect unique location_variant_slug + character_variant_slugs + prop_variant_slugs, write to chapter.asset_variant_map

File: `api/v2/chapters/[chapterId]/asset-map/route.ts`
- GET: Return current asset_variant_map

## Asset POST Pattern (important)
When creating assets (characters/locations/props), auto-create a default variant:
```ts
// 1. Insert asset
const { data: asset } = await db.from('series_assets').insert({...}).select('id').single();

// 2. Auto-create default variant
await db.from('series_asset_variants').insert({
  asset_id: asset.id,
  name: 'Default',
  slug: `${assetSlug}-default`,
  is_default: true,
});
```

## Response Format
All endpoints return JSON. Lists return arrays. Single items return objects.
Include `id` in all responses. Include `created_at` and `updated_at`.
Errors: `{ error: string }` with appropriate HTTP status.

## Important
- Use `createServiceClient('studio')` for all DB ops
- Auth via `getUserOrApiKey(req)` — supports both session and API key
- Ownership check: verify user_id matches before mutations
- `"order"` column name is quoted in Postgres (reserved word) — Supabase JS handles this fine
- Slugs: kebab-case, auto-generated from name if not provided
- Build must pass: `cd editor && pnpm build`
