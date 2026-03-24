# Video Generation Workflow

Step-by-step guide for generating videos from storyboards. **Follow this exactly — skipping steps costs real money.**

---

## Prerequisites

Before generating videos, ensure:

| Requirement | How to Check |
|---|---|
| Storyboard has `plan_status = 'approved'` | DB or UI — must be approved first |
| Scenes exist in `scenes` table | `SELECT count(*) FROM studio.scenes WHERE storyboard_id = '<id>'` |
| Each scene has a `backgrounds` record with `status = 'success'` | Background image URL must be set |
| Objects (characters) linked where needed | Optional — scenes without characters are valid |
| `WEBHOOK_BASE_URL` set in `.env` / `.env.local` | Must be a **public URL** (not localhost). Use a tunnel (Cloudflare, ngrok) for local dev |
| `FAL_KEY` set in `.env` | fal.ai API key |
| Dev server running | `pnpm dev` at project root |

---

## The Endpoint

```
POST /api/v2/storyboard/{storyboard_id}/generate-video
```

**Auth:** `Authorization: Bearer <OCTUPOST_API_KEY>` (or Supabase session cookie)

### Request Body

```json
{
  "scene_indices": [0, 1, 2],    // Optional: which scenes (0-indexed). Omit for all.
  "scene_ids": ["uuid", ...],     // Alternative: filter by scene UUID
  "audio": false,                 // Default: true. Set false for silent video.
  "confirm": false,               // Default: false. false = dry run (cost estimate only)
  "aspect_ratio": "9:16",         // Default: storyboard's aspect_ratio or "9:16"
  "model": "klingo3"              // Default: "klingo3". Only option currently.
}
```

### Response

```json
{
  "jobs": [
    {
      "scene_id": "uuid",
      "scene_index": 0,
      "duration_seconds": 9,
      "estimated_cost_usd": 0.151,
      "fal_request_id": "uuid",        // Only when confirm=true
      "status": "queued|estimate|skipped",
      "reason": "no_prompt|already_generated|missing_background"  // Only when skipped
    }
  ],
  "total_estimated_cost_usd": 0.554
}
```

---

## Step-by-Step Workflow

### Step 1: Dry Run (ALWAYS do this first)

```bash
curl -X POST http://localhost:3000/api/v2/storyboard/<STORYBOARD_ID>/generate-video \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"scene_indices": [0, 1, 2], "audio": false, "confirm": false, "aspect_ratio": "9:16"}'
```

**Check the response:**
- ✅ `status: "estimate"` — scene is ready to generate
- ⚠️ `status: "skipped"` + `reason` — something is missing/wrong
  - `no_prompt` → scene has no prompt text
  - `already_generated` → video already exists or is processing
  - `missing_background` → no background image linked to scene
- ✅ `total_estimated_cost_usd` — verify this is reasonable before confirming

### Step 2: Review Cost

Check `total_estimated_cost_usd` before confirming.

**Pricing (fal.ai Kling O3 ref-to-video):**
| Type | Cost per 5s |
|------|-------------|
| Silent | $0.084 |
| With audio | $0.112 |

Example: 3 scenes × 9s average = ~$0.45 silent, ~$0.60 with audio.

### Step 3: Confirm Generation

```bash
curl -X POST http://localhost:3000/api/v2/storyboard/<STORYBOARD_ID>/generate-video \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"scene_indices": [0, 1, 2], "audio": false, "confirm": true, "aspect_ratio": "9:16"}'
```

**What happens:**
1. Endpoint reads scene prompts from DB (`multi_prompt` array)
2. `buildKlingMultiPromptPayload()` calculates per-shot durations
3. Payload sent to fal.ai with webhook URL for callback
4. Scene `video_status` → `processing`, `video_request_id` stored
5. Generation log written to `generation_logs` table

### Step 4: Wait for Webhook

fal.ai processes the request (typically 3–7 minutes) and POSTs the result to:
```
{WEBHOOK_BASE_URL}/api/webhook/fal?step=GenerateVideo&scene_id=<id>
```

**The webhook handler (`handleGenerateVideo`):**
- Validates `video_status = 'processing'` (atomic guard)
- Extracts video URL from fal.ai response
- Updates scene: `video_status → 'success'`, `video_url` set
- If failed: `video_status → 'failed'`, `video_error_message` set

### Step 5: Verify

Check DB or refresh the UI:
```bash
curl "https://<SUPABASE_URL>/rest/v1/scenes?storyboard_id=eq.<ID>&select=order,video_status,video_url&order=order" \
  -H "apikey: <KEY>" -H "Authorization: Bearer <KEY>" -H "Accept-Profile: studio"
```

---

## What the Endpoint Handles (Don't Do These Manually)

| Task | The endpoint does it |
|------|---------------------|
| Build fal.ai payload | ✅ `elements[]`, `image_urls[]`, `multi_prompt[]`, `aspect_ratio`, `generate_audio` |
| Calculate shot durations | ✅ `buildKlingMultiPromptPayload()` — respects 3–15s per shot |
| Set webhook URL | ✅ Uses `WEBHOOK_BASE_URL` or `NEXT_PUBLIC_APP_URL` |
| Update `video_status` | ✅ `pending → processing` on send |
| Store `video_request_id` | ✅ For webhook guard matching |
| Log to `generation_logs` | ✅ Version tracking per scene |
| Handle errors | ✅ Sets `failed` status if fal.ai returns error |

---

## ⛔ DO NOT

| Don't | Why | What to do instead |
|-------|-----|-------------------|
| Send requests directly to fal.ai | Bypasses webhook setup, status tracking, cost logging | Use the endpoint |
| Put `9:16`, `@Element`, `@Image` in prompts | These are API parameters, not prompt text | Use `aspect_ratio` param; reference images are pulled from DB `objects`/`backgrounds` tables |
| Put `cinematic`, `vertical`, `portrait` in prompts | Model handles this via parameters | Clean descriptive prompts only |
| Set `video_status` manually | Endpoint handles this | Let the endpoint manage status |
| Use `image_url` (singular) | That's the old single-image API | Endpoint uses `image_urls[]` (array) and `elements[]` |
| Forget the dry run | You'll waste money on broken requests | Always `confirm: false` first |
| Assume localhost webhooks work | fal.ai can't reach localhost | Set `WEBHOOK_BASE_URL` to a tunnel or production URL |

---

## Prompt Rules

Prompts go in the storyboard `plan.scene_prompts` field, then get copied to `scenes.multi_prompt` on approve.

**Good prompt:**
```
Hz. Bilal kızgın çöl kumuna sırtüstü yatırılmış. Göğsünde devasa bir kaya. Öğle güneşi acımasız. Alnında ter damlaları.
```

**Bad prompt:**
```
@Element1 kızgın çöl kumuna sırtüstü yatırılmış. @Image1 çöl kenarı arka plan. 9:16 dikey. cinematic.
```

**Why:** `@Element1` is resolved by the endpoint into actual image URLs from the `objects` table. `9:16` is the `aspect_ratio` parameter. `cinematic` is meaningless metadata. The prompt should describe **what you see**, nothing else.

---

## Scene Setup (Before Generation)

Each scene needs these DB records:

### `backgrounds` table (required)
```json
{
  "scene_id": "<scene_uuid>",
  "grid_image_id": "<grid_image_uuid>",
  "name": "Mekke Sokakları",
  "url": "<supabase_storage_url>",
  "final_url": "<supabase_storage_url>",
  "status": "success",
  "series_asset_variant_id": "<variant_uuid>"
}
```

### `objects` table (optional — for character reference)
```json
{
  "scene_id": "<scene_uuid>",
  "grid_image_id": "<grid_image_uuid>",
  "scene_order": 0,
  "name": "Hz. Bilal",
  "url": "<supabase_storage_url>",
  "final_url": "<supabase_storage_url>",
  "status": "success",
  "series_asset_variant_id": "<variant_uuid>"
}
```

> ⚠️ `grid_image_id` is currently NOT NULL in both tables. A dummy `grid_images` record is needed if bypassing the grid pipeline. (TODO: make nullable)

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Dry run returns 0 jobs | Scenes missing `backgrounds` records | Create background records for each scene |
| `status: "skipped", reason: "no_prompt"` | `multi_prompt` is null/empty | Write prompts to scene's `multi_prompt` field |
| `status: "skipped", reason: "already_generated"` | `video_status` is `processing` or `success` | Reset to `pending` if you want to regenerate |
| Webhook never arrives | `WEBHOOK_BASE_URL` is localhost | Set to tunnel URL (Cloudflare/ngrok) |
| 401 Unauthorized | API key not matching | Use `Authorization: Bearer <OCTUPOST_API_KEY>`. Check `OCTUPOST_API_KEY` and `OCTUPOST_API_USER_ID` in `.env` |
| 403 Forbidden | API key user doesn't own the project | Verify `OCTUPOST_API_USER_ID` matches project's `user_id` |
| fal.ai returns error in webhook | Prompt too long, invalid image URL, or rate limit | Check `generation_logs` table for details |

---

## fal.ai Payload Reference (What the Endpoint Sends)

For reference only — **you should never build this manually**.

```json
{
  "elements": [
    {
      "frontal_image_url": "https://...character.jpg",
      "reference_image_urls": ["https://...character.jpg"]
    }
  ],
  "image_urls": ["https://...background.jpg"],
  "aspect_ratio": "9:16",
  "generate_audio": false,
  "multi_prompt": [
    { "prompt": "Shot 1 description in Turkish", "duration": "5" },
    { "prompt": "Shot 2 description in Turkish", "duration": "4" }
  ],
  "shot_type": "customize"
}
```

- `elements[]` — from scene's `objects` table records (character reference images)
- `image_urls[]` — from scene's `backgrounds` table records
- `multi_prompt[]` — from scene's `multi_prompt` field, durations calculated by `buildKlingMultiPromptPayload()`
- `shot_type: "customize"` — required when using `multi_prompt`
- `aspect_ratio` — from request body or storyboard default
- `generate_audio` — from request body (`audio` param), default `true`
