# API Cookbook — Octupost Video Editor

> **Keep this file up to date.** When you add, change, or remove an API endpoint, update this cookbook in the same commit.

## Auth

All endpoints (except webhooks) require authentication:

```ts
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
const { userId } = await getUserOrApiKey(request);
```

Webhook routes use HMAC verification instead — no user auth.

---

## Projects

### List Projects
```
GET /api/v2/projects
→ [{ id, name, description, created_at, updated_at }]
```

### Create Project
```
POST /api/v2/projects
{ name, description? }
→ { id, name, description }
```

### Get Project
```
GET /api/v2/projects/{id}
→ { id, name, description, ... }
```

### Update Project
```
PATCH /api/v2/projects/{id}
{ name?, description? }
→ { id, name, description }
```

### Delete Project
```
DELETE /api/v2/projects/{id}
→ 204
```

### Get Project Variants (all asset images)
```
GET /api/v2/projects/{id}/variants
→ [{ id, asset_id, slug, image_url, image_gen_status }]
```

---

## Videos

### Create Video
```
POST /api/v2/videos/create
{ project_id, title, genre?, tone?, content_mode?, language?, video_resolution? }
→ { id, project_id, title, ... }
```

### Get Video
```
GET /api/v2/videos/{id}
→ { id, project_id, title, video_resolution, ... }
```

### Update Video
```
PATCH /api/v2/videos/{id}
{ title?, video_resolution?, genre?, tone?, ... }
→ { id, ... }
```

### Delete Video
```
DELETE /api/v2/videos/{id}
→ 204
```

---

## Chapters

### List Chapters for Video
```
GET /api/v2/videos/{videoId}/chapters
→ [{ id, video_id, order, title, synopsis, status }]
```

### Create Chapters (batch)
```
POST /api/v2/videos/{videoId}/chapters
[{ title, synopsis?, order? }]
→ [{ id, video_id, order, title }]
```

### Get Chapter
```
GET /api/v2/chapters/{id}
→ { id, video_id, order, title, synopsis, asset_variant_map, status }
```

### Update Chapter
```
PATCH /api/v2/chapters/{id}
{ title?, synopsis?, status?, asset_variant_map? }
→ { id, ... }
```

### Delete Chapter
```
DELETE /api/v2/chapters/{id}
→ 204
```

### Get Chapter Asset Map
```
GET /api/v2/chapters/{id}/asset-map
→ { characters: [...], locations: [...], props: [...] }
```

### Auto-Map Assets from Scenes
```
POST /api/v2/chapters/{id}/map-assets
→ { asset_variant_map }
```
Reads all scenes in chapter, collects unique slugs, writes to `asset_variant_map`.

---

## Scenes

### List Scenes for Chapter
```
GET /api/v2/chapters/{chapterId}/scenes
→ [{ id, chapter_id, order, title, prompt, audio_text, audio_url, video_url, video_status }]
```

### Create Scenes (batch)
```
POST /api/v2/chapters/{chapterId}/scenes
[{ title?, prompt?, audio_text?, order? }]
→ [{ id, chapter_id, order, title }]
```

### Get Scene
```
GET /api/v2/scenes/{id}
→ { id, chapter_id, order, title, prompt, audio_text, audio_url, video_url, video_status, ... }
```

### Update Scene
```
PATCH /api/v2/scenes/{id}
{ title?, prompt?, audio_text?, duration? }
→ { id, ... }
```

### Delete Scene
```
DELETE /api/v2/scenes/{id}
→ 204
```

### Generate Video for Scene
```
POST /api/v2/scenes/{id}/generate-video
{ provider?: "kie" | "fal", resolution?: string }
→ { task_id, status: "processing" }
```
Async: Kie.ai generates video → webhook updates `video_url` + `video_status`.
Resolution priority: `body.resolution` > `video.video_resolution` > `'480p'`.
Video duration: 6–15 seconds (Grok Imagine limits: 4–15s).

### Generate TTS for Scene
```
POST /api/v2/scenes/{id}/generate-tts
→ { task_id, status: "processing" }
```
Async: Kie.ai generates TTS from `audio_text` → webhook updates `audio_url`.

---

## Assets (Characters / Locations / Props)

Assets are per-project. Type is determined by the endpoint used.

### List Characters for Project
```
GET /api/v2/projects/{projectId}/characters
→ [{ id, project_id, name, slug, type: "character", sort_order }]
```

### Create Characters (also: locations, props)
```
POST /api/v2/projects/{projectId}/characters
[{ name, slug?, description? }]
→ [{ id, name, slug }]
```
Auto-creates a default variant per asset.

Same pattern for:
- `POST /api/v2/projects/{projectId}/locations`
- `POST /api/v2/projects/{projectId}/props`

### List for Video (read-only, mirrors project assets)
```
GET /api/v2/videos/{videoId}/characters
GET /api/v2/videos/{videoId}/locations
GET /api/v2/videos/{videoId}/props
```

---

## Variants

### List Variants for Asset
```
GET /api/v2/assets/{assetId}/variants
→ [{ id, asset_id, name, slug, image_url, image_gen_status, is_default }]
```

### Create Variant(s)
```
POST /api/v2/assets/{assetId}/variants
[{ name, slug?, prompt?, is_default? }]
→ [{ id, asset_id, name, slug }]
```

### Update Variant
```
PATCH /api/v2/variants/{id}
{ name?, prompt?, image_url? }
→ { id, ... }
```

### Delete Variant
```
DELETE /api/v2/variants/{id}
→ 204
```

### Generate Image for Variant
```
POST /api/v2/variants/{id}/generate-image
→ { task_id, status: "processing" }
```
Async: Kie.ai generates image (Flux 2 Pro) → webhook updates `image_url` + `image_gen_status`.

### Batch Generate Images for Project
```
POST /api/v2/projects/{projectId}/generate-images/batch
→ { queued: number }
```
Generates images for all variants without `image_url`.

---

## Music

### List Music for Project
```
GET /api/v2/projects/{projectId}/music
→ [{ id, name, url, duration }]
```

### Add Music
```
POST /api/v2/projects/{projectId}/music
{ name, url?, prompt? }
→ { id, name }
```

### Get / Update / Delete Music
```
GET    /api/v2/music/{id}
PATCH  /api/v2/music/{id}  { name?, url? }
DELETE /api/v2/music/{id}
```

---

## Posts (Social Publishing)

### List Posts
```
GET /api/v2/posts/list?project_id={id}
→ [{ id, rendered_video_id, platform, status, published_at }]
```

### Create Post
```
POST /api/v2/posts
{ rendered_video_id, platform, caption?, scheduled_at? }
→ { id, status: "draft" }
```

### Get / Update / Delete Post
```
GET    /api/v2/posts/{id}
PUT    /api/v2/posts/{id}   { caption?, scheduled_at? }
DELETE /api/v2/posts/{id}
```

### Publish Post
```
POST /api/v2/posts/{id}/publish
→ { status: "published", published_at }
```

---

## Webhooks

### Kie.ai Webhook
```
POST /api/webhook/kieai?step={Step}&scene_id={id}
```
HMAC-verified via `KIE_WEBHOOK_HMAC_KEY`. No user auth.

**Steps:**
| Step | What it does |
|------|-------------|
| `GenerateSceneVideo` | Updates scene `video_url` + `video_status` |
| `GenerateSceneTTS` | Updates scene `audio_url` |
| `GenerateVideo` / `grok-imagine/image-to-video` | Legacy video generation |
| `GenerateTTS` / `elevenlabs/*` | Legacy TTS generation |
| `GenerateMusic` | Updates music record |
| `VideoAssetImage` | Updates variant `image_url` + `image_gen_status` |
| `GenGridImage` / `nano-banana-2` | Legacy grid image generation |

---

## Other Endpoints

### Transcribe Audio (Deepgram)
```
POST /api/transcribe
{ url: string, model?: string }
→ { transcript, words: [{ word, start, end, confidence }] }
```
Uses Deepgram `nova-3`. URL must be a direct audio/video URL (not a proxy URL).

### Generate Social Media Caption
```
POST /api/generate-caption
{ transcript, platform, tone? }
→ { caption }
```

### Media Proxy
```
GET /api/proxy/media?url={encodedUrl}
→ Proxied media stream
```
Allowed domains only. Requires user auth. Supports Range headers.

### Health Check
```
GET /api/health
→ { status: "ok" }
```

---

## Generation Logs
```
GET /api/v2/generation-logs/{entityType}/{entityId}
→ [{ id, step, task_id, status, created_at, completed_at, error }]
```
Entity types: `scene`, `variant`, `video`, etc.

---

## Feedback
```
POST /api/v2/feedback
{ entity_type, entity_id, feedback, rating? }
→ { id }
```
