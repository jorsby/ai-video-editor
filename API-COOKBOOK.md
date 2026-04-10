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
{ title?, video_resolution?, genre?, tone?, image_models?, ... }
→ { id, ... }
```
`image_models` is a JSONB object mapping asset type to t2i model:
```json
{ "character": "z-image", "location": "gpt-image/1.5-text-to-image", "prop": "z-image" }
```
Available t2i models: `z-image`, `gpt-image/1.5-text-to-image`, `flux-2/pro-text-to-image`.

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
[{ location_variant_slug, title?, prompt?, audio_text?, character_variant_slugs?, prop_variant_slugs?, order? }]
→ { scenes: [{ id, chapter_id, order, title }], warnings: [{ scene_index, field, message }] }
```
`location_variant_slug` is **required** for every scene. `character_variant_slugs` and `prop_variant_slugs` default to `[]` if omitted. The `warnings` array flags scenes with empty optional slug fields.

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
{ duration?: 6–30, resolution?: "480p"|"720p", provider?: "kie"|"fal", prompt_override?: string, image_urls_override?: string[] }
→ { task_id, provider, model, scene_id, duration, aspect_ratio, resolution, image_count }
```
Async: Grok Imagine ref-to-video via kie.ai (or fal.ai) → webhook updates `video_url` + `video_status`.
Duration priority: `body.duration` > audio_duration (narrative scenes) > `scene.video_duration` > 6. Clamped 6–30s.
Resolution priority: `body.resolution` > `video.video_resolution` > `'480p'`.
Narrative scenes (with `audio_text`) require TTS to be generated first.

### Generate TTS for Scene
```
POST /api/v2/scenes/{id}/generate-tts
{ voice_id?: string, speed?: 0.7–1.2, previous_text?: string, next_text?: string, language_code?: string }
→ { task_id, model, scene_id, voice_id, speed }
```
Async: ElevenLabs TTS (turbo-2.5) via kie.ai from `audio_text` → webhook updates `audio_url`.
Voice defaults from `video.voice_id` (required). Speed defaults from `video.tts_speed` or 1.0.

### Transcribe Scene Audio
```
POST /api/v2/scenes/{id}/transcribe
{ source?: "video" | "voiceover" | "both" }
→ { scene_id, video_transcription, voiceover_transcription, has_speech }
```
Transcribes the scene's video and/or voiceover audio using Deepgram nova-3.
Stores word-by-word transcription with timestamps in scene record (`video_transcription` / `voiceover_transcription` JSONB columns).
Results are cached in `transcriptions` table — re-calling won't re-transcribe the same URL.
Sets `has_speech` based on whether video audio contains spoken words.

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

### Update Asset
```
PATCH /api/v2/characters/{id}
PATCH /api/v2/locations/{id}
PATCH /api/v2/props/{id}
{ name?, slug?, description?, sort_order? }
→ { id, name, slug, ... }
```

### Delete Asset
```
DELETE /api/v2/characters/{id}
DELETE /api/v2/locations/{id}
DELETE /api/v2/props/{id}
→ { id, deleted: true }
```

### List / Create for Video
```
GET  /api/v2/videos/{videoId}/characters
GET  /api/v2/videos/{videoId}/locations
GET  /api/v2/videos/{videoId}/props
POST /api/v2/videos/{videoId}/characters   [{ name, slug?, description? }]
POST /api/v2/videos/{videoId}/locations    [{ name, slug?, description? }]
POST /api/v2/videos/{videoId}/props        [{ name, slug?, description? }]
```
Same create behaviour as project-scoped routes (auto-creates default variant).

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
{ prompt_override? }
→ { task_id, model, variant_id, aspect_ratio, prompt }
```
Async: Kie.ai generates image → webhook updates `image_url` + `image_gen_status`.

**Model selection logic:**
- **Main variant** → text-to-image model based on asset type (from `video.image_models`)
- **Non-main variant** → image-to-image model with main variant's image as reference (for visual consistency). Falls back to t2i if main has no image yet.

**Default models per asset type:**

| Asset Type | Text-to-Image (main) | Image-to-Image (non-main) |
|------------|---------------------|--------------------------|
| character  | `z-image`           | `flux-2/pro-image-to-image` |
| location   | `gpt-image/1.5-text-to-image` | `gpt-image/1.5-image-to-image` |
| prop       | `z-image`           | `flux-2/pro-image-to-image` |

T2I models are configurable per asset type via `videos.image_models` JSONB:
```json
{ "character": "z-image", "location": "gpt-image/1.5-text-to-image", "prop": "z-image" }
```

### Batch Generate Images for Project
```
POST /api/v2/projects/{projectId}/generate-images/batch
{ variant_ids: string[], prompt_overrides?: Record<string, string> }
→ { queued, skipped, failed, total, results: [...] }
```
Per-variant model resolution: same main/non-main logic as single generate.

---

## Music

Music tracks belong to a project and can optionally be scoped to a specific video via `video_id`.

### List Music for Project (all videos)
```
GET /api/v2/projects/{projectId}/music
→ [{ id, project_id, video_id, name, music_type, style, title, audio_url, duration, status, ... }]
```

### List Music for Video
```
GET /api/v2/videos/{videoId}/music
→ [{ id, project_id, video_id, name, music_type, style, title, audio_url, duration, status, ... }]
```
Returns only music scoped to that video (where `video_id` matches).

### Add Music (project-wide)
```
POST /api/v2/projects/{projectId}/music
{ name, music_type, style, title, prompt? }
→ { id, video_id: null, status: "generating", ... }
```

### Add Music (video-scoped)
```
POST /api/v2/videos/{videoId}/music
{ name, music_type, style, title, prompt? }
→ { id, video_id, status: "generating", ... }
```
Automatically sets `video_id` to the target video.

### Get / Update / Delete Music
```
GET    /api/v2/music/{id}
PATCH  /api/v2/music/{id}  { name?, style?, title?, prompt?, video_id? }
DELETE /api/v2/music/{id}
```
`video_id` in PATCH can be a UUID (must belong to same project) or `null` to make project-wide.

---

## Accounts (Social Media)

Connected social media accounts. Uses `social_auth` Supabase client.

### List Accounts
```
GET /api/v2/accounts
→ { accounts: [{ platform, account_id, account_name, account_username, language, agent_id, expires_at, profile_image_url }] }
```

### Sync Accounts
```
POST /api/v2/accounts/sync
→ { accounts: [...] }
```
Fetches accounts from Octupost API, upserts into `tokens` table, returns updated list.

---

## Posts (Social Publishing)

Posts publish to multiple social accounts simultaneously. Uses `social_auth` Supabase client.

### List Posts
```
GET /api/v2/posts/list?status={status}&date={YYYY-MM}&limit={50}&offset={0}
→ { posts: [{ id, caption, media_url, media_type, status, scheduled_at, post_accounts: [...] }], total }
```
Supports filtering by status and month (for calendar view). Paginated.

### Create Post
```
POST /api/v2/posts
{ caption, mediaUrl, mediaType: "video"|"image"|"carousel", accountIds: string[],
  scheduleType: "now"|"scheduled", scheduledDate?, scheduledTime?, timezone?,
  platformOptions?, projectId?, tags? }
→ { post: { id, status, post_accounts: [...] } }
```
If `scheduleType: "now"`, publishes immediately to all accounts in parallel.

### Get Post
```
GET /api/v2/posts/{id}
→ { post: { ..., post_accounts: [...] } }
```

### Update Post
```
PUT /api/v2/posts/{id}
{ caption?, accountIds?, scheduledDate?, scheduledTime?, timezone?, platformOptions? }
→ { post: { ..., post_accounts: [...] } }
```
If post is already published, attempts platform-level caption update (Facebook, YouTube).
If `accountIds` changes, reconciles `post_accounts` rows.

### Delete Post
```
DELETE /api/v2/posts/{id}
→ { success: true }
```
Best-effort deletes from platforms (Facebook, YouTube, Twitter/X) for published posts.

### Publish Post
```
POST /api/v2/posts/{id}/publish
→ { post: { status: "published"|"failed"|"partial", post_accounts: [...] } }
```
Only works for posts with status `scheduled` or `draft`. Publishes to all pending/failed accounts in parallel.

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
