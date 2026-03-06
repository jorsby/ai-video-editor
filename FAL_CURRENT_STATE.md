# fal.ai Current State — Complete Endpoint Map

## Environment Variables

| Variable | Used In | Purpose |
|---|---|---|
| `FAL_KEY` | All supabase edge functions + `editor/src/app/api/fal/*` | fal.ai API key (header: `Authorization: Key <FAL_KEY>`) |
| `SUPABASE_URL` | All edge functions | Used to construct webhook URLs |
| `SUPABASE_SERVICE_ROLE_KEY` | All edge functions | Supabase admin access |
| `SKYREELS_API_KEY` | `generate-video/index.ts` | SkyReels direct API (NOT fal.ai) |

---

## Summary Table

| # | Endpoint | Category | File | Webhook Step | What It Does |
|---|---|---|---|---|---|
| 1 | `workflows/octupost/generategridimage` | WORKFLOW | `start-workflow/index.ts`, `start-ref-workflow/index.ts` | `GenGridImage` | Generate a grid image from prompt (I2V + Ref modes) |
| 2 | `comfy/octupost/splitgridimage` | WORKFLOW | `approve-grid-split/index.ts`, `approve-ref-split/index.ts` | `SplitGridImage` | Split grid into individual scene frames |
| 3 | `workflows/octupost/edit-image-kling` | WORKFLOW | `edit-image/index.ts` | `OutpaintImage` / `EnhanceImage` | Outpaint/enhance/edit images (Kling model) |
| 4 | `workflows/octupost/edit-image-banana` | WORKFLOW | `edit-image/index.ts` | `OutpaintImage` / `EnhanceImage` | Outpaint/enhance/edit images (Banana model) |
| 5 | `workflows/octupost/edit-image-fibo` | WORKFLOW | `edit-image/index.ts` | `OutpaintImage` / `EnhanceImage` | Outpaint/enhance/edit images (Fibo model) |
| 6 | `workflows/octupost/edit-image-grok` | WORKFLOW | `edit-image/index.ts` | `OutpaintImage` / `EnhanceImage` | Outpaint/enhance/edit images (Grok model) |
| 7 | `workflows/octupost/edit-image-flux-pro` | WORKFLOW | `edit-image/index.ts` | `OutpaintImage` / `EnhanceImage` | Outpaint/enhance/edit images (Flux Pro model) |
| 8 | `workflows/octupost/wan26` | WORKFLOW | `generate-video/index.ts` | `GenerateVideo` | I2V video gen (WAN 2.6) |
| 9 | `workflows/octupost/bytedancepro15` | WORKFLOW | `generate-video/index.ts` | `GenerateVideo` | I2V video gen (ByteDance 1.5 Pro) |
| 10 | `workflows/octupost/grok` | WORKFLOW | `generate-video/index.ts` | `GenerateVideo` | I2V video gen (Grok) |
| 11 | `workflows/octupost/wan26flash` | WORKFLOW | `generate-video/index.ts` | `GenerateVideo` | Ref-to-video gen (WAN 2.6 Flash) |
| 12 | `workflows/octupost/klingo3` | WORKFLOW | `generate-video/index.ts` | `GenerateVideo` | Ref-to-video gen (Kling O3) |
| 13 | `workflows/octupost/klingo3pro` | WORKFLOW | `generate-video/index.ts` | `GenerateVideo` | Ref-to-video gen (Kling O3 Pro) |
| 14 | `workflows/octupost/sfx` | WORKFLOW | `generate-sfx/index.ts` | `GenerateSFX` | Add SFX audio to video |
| 15 | `fal-ai/elevenlabs/tts/turbo-v2.5` | DIRECT | `generate-tts/index.ts` | `GenerateTTS` | Text-to-speech (ElevenLabs Turbo v2.5) |
| 16 | `fal-ai/elevenlabs/tts/multilingual-v2` | DIRECT | `generate-tts/index.ts` | `GenerateTTS` | Text-to-speech (ElevenLabs Multilingual v2) |
| 17 | `fal-ai/z-image/turbo` | DIRECT | `editor/src/app/api/fal/image/route.ts` | None (sync) | Quick image generation (editor asset panel) |
| 18 | `fal-ai/longcat-video/distilled/text-to-video/480p` | DIRECT | `editor/src/app/api/fal/video/route.ts` | None (sync) | Quick text-to-video gen (editor asset panel) |

**Non-fal.ai endpoint (for reference):**

| # | Endpoint | Category | File | Polling |
|---|---|---|---|---|
| 19 | `https://apis.skyreels.ai/api/v1/video/multiobject` | EXTERNAL | `generate-video/index.ts`, `poll-skyreels/index.ts` | Cron-based polling |

---

## Detailed Breakdown

---

### 1. Generate Grid Image

**File:** `supabase/functions/start-workflow/index.ts` (I2V mode)
**File:** `supabase/functions/start-ref-workflow/index.ts` (Ref mode — sends 2 requests: objects + backgrounds)

**Endpoint:** `https://queue.fal.run/workflows/octupost/generategridimage`

**Request Pattern:** Queue with webhook
```
URL: https://queue.fal.run/workflows/octupost/generategridimage?fal_webhook=<webhook_url>
Method: POST
Headers:
  Authorization: Key <FAL_KEY>
  Content-Type: application/json

Body: {
  "prompt": "<grid_image_prompt>"
}
```

**Webhook URL params:**
```
step=GenGridImage
grid_image_id=<uuid>
storyboard_id=<uuid>
rows=<int>
cols=<int>
width=<int>
height=<int>
```

**Response (queue acceptance):**
```json
{ "request_id": "<string>" }
```

**Webhook payload (on completion):**
```json
{
  "status": "OK" | "ERROR",
  "request_id": "<string>",
  "images": [{ "url": "<string>" }],
  "payload": {
    "images": [{ "url": "<string>" }],
    "prompt": "<string>",
    "outputs": { "<node_id>": { "images": [{ "url": "<string>" }] } }
  }
}
```

**Webhook handler:** `webhook/index.ts` → `handleGenGridImage`
**Used by:** Both I2V (`start-workflow`) and Ref (`start-ref-workflow`) modes

---

### 2. Split Grid Image

**File:** `supabase/functions/approve-grid-split/index.ts` (I2V mode)
**File:** `supabase/functions/approve-ref-split/index.ts` (Ref mode — sends 2 requests: objects + backgrounds)

**Endpoint:** `https://queue.fal.run/comfy/octupost/splitgridimage`

**Request Pattern:** Queue with webhook
```
URL: https://queue.fal.run/comfy/octupost/splitgridimage?fal_webhook=<webhook_url>
Method: POST
Headers:
  Authorization: Key <FAL_KEY>
  Content-Type: application/json

Body: {
  "loadimage_1": "<grid_image_url>",
  "rows": <int>,
  "cols": <int>,
  "width": <int>,
  "height": <int>
}
```

**Webhook URL params:**
```
step=SplitGridImage
grid_image_id=<uuid>
storyboard_id=<uuid>
```

**Response (queue acceptance):**
```json
{ "request_id": "<string>" }
```

**Webhook payload (on completion):**
```json
{
  "status": "OK" | "ERROR",
  "payload": {
    "outputs": {
      "30": { "images": [{ "url": "<string>" }, ...] },
      "11": { "images": [{ "url": "<string>" }, ...] }
    }
  }
}
```
- **Node 30** = split images (`url` per scene)
- **Node 11** = padded images (`out_padded_url` per scene, I2V only)

**Webhook handler:** `webhook/index.ts` → `handleSplitGridImage` (routes to `handleSceneSplit`, `handleObjectsSplit`, or `handleBackgroundsSplit` based on grid type)

---

### 3–7. Edit Image (Outpaint / Enhance / Custom Edit / Ref-to-Image)

**File:** `supabase/functions/edit-image/index.ts`

**Endpoints (one per model):**
| Model | Endpoint |
|---|---|
| `kling` (default) | `workflows/octupost/edit-image-kling` |
| `banana` | `workflows/octupost/edit-image-banana` |
| `fibo` | `workflows/octupost/edit-image-fibo` |
| `grok` | `workflows/octupost/edit-image-grok` |
| `flux-pro` | `workflows/octupost/edit-image-flux-pro` |

**Request Pattern:** Queue with webhook
```
URL: https://queue.fal.run/workflows/octupost/edit-image-<model>?fal_webhook=<webhook_url>
Method: POST
Headers:
  Authorization: Key <FAL_KEY>
  Content-Type: application/json

Body (outpaint — kling/banana/flux-pro):
{
  "image_urls": ["<image_url>"],
  "prompt": "Seamlessly extend the image into all masked areas..."
}

Body (outpaint — fibo/grok):
{
  "image_url": "<image_url>",
  "prompt": "Seamlessly extend the image into all masked areas..."
}

Body (enhance):
{
  "image_urls": ["<image_url>"],   (or "image_url" for fibo/grok)
  "prompt": "Improve quality to 8k Do not change the image but fix the objects to make it more real"
}

Body (custom_edit):
{
  "image_urls": ["<image_url>"],   (or "image_url" for fibo/grok)
  "prompt": "<user_prompt>"
}

Body (ref_to_image):
{
  "image_urls": ["<ref_url_1>", "<ref_url_2>", ...],
  "prompt": "<user_prompt>"
}
```

**Actions:**
- `outpaint` → webhook step `OutpaintImage`, uses `out_padded_url`
- `enhance` → webhook step `EnhanceImage`, uses `final_url`
- `custom_edit` → webhook step `EnhanceImage`, uses `final_url`
- `ref_to_image` → webhook step `EnhanceImage`, multiple reference images

**Targets:** `first_frames`, `backgrounds`, or `objects` table depending on `source` param

**Webhook URL params:**
```
step=OutpaintImage|EnhanceImage
first_frame_id=<uuid>  OR  background_id=<uuid>  OR  object_id=<uuid>
```

**Webhook handler:** `webhook/index.ts` → `handleOutpaintImage` or `handleEnhanceImage`

---

### 8–10. Image-to-Video Generation (I2V)

**File:** `supabase/functions/generate-video/index.ts`

| Model Key | Endpoint | Resolutions | Duration Range |
|---|---|---|---|
| `wan2.6` | `workflows/octupost/wan26` | 720p, 1080p | Buckets: 5, 10, 15 |
| `bytedance1.5pro` (default) | `workflows/octupost/bytedancepro15` | 480p, 720p, 1080p | 4–12 |
| `grok` | `workflows/octupost/grok` | 480p, 720p | 1–15 |

**Request Pattern:** Queue with webhook
```
URL: https://queue.fal.run/workflows/octupost/<model>?fal_webhook=<webhook_url>
Method: POST
Headers:
  Authorization: Key <FAL_KEY>
  Content-Type: application/json

Body (wan2.6):
{
  "prompt": "<visual_prompt>",
  "image_url": "<first_frame_final_url>",
  "resolution": "720p"|"1080p",
  "duration": "<int_seconds>"
}

Body (bytedance1.5pro):
{
  "prompt": "<visual_prompt>",
  "image_url": "<first_frame_final_url>",
  "aspect_ratio": "16:9",
  "resolution": "480p"|"720p"|"1080p",
  "duration": "<int_seconds>"
}

Body (grok):
{
  "prompt": "<visual_prompt>",
  "image_url": "<first_frame_final_url>",
  "resolution": "480p"|"720p",
  "duration": "<int_seconds>"
}
```

**Webhook URL params:**
```
step=GenerateVideo
scene_id=<uuid>
```

**Webhook handler:** `webhook/index.ts` → `handleGenerateVideo`

---

### 11–13. Ref-to-Video Generation

**File:** `supabase/functions/generate-video/index.ts`

| Model Key | Endpoint | Resolutions | Duration |
|---|---|---|---|
| `wan26flash` | `workflows/octupost/wan26flash` | 720p, 1080p | Buckets: 5, 10 |
| `klingo3` | `workflows/octupost/klingo3` | 720p, 1080p | 3–15 |
| `klingo3pro` | `workflows/octupost/klingo3pro` | 720p, 1080p | 3–15 |

**Request Pattern:** Queue with webhook
```
URL: https://queue.fal.run/workflows/octupost/<model>?fal_webhook=<webhook_url>
Method: POST
Headers:
  Authorization: Key <FAL_KEY>
  Content-Type: application/json

Body (wan26flash):
{
  "prompt": "<resolved_prompt with @Character1 etc>",
  "image_urls": ["<background_url>", "<object_url_1>", ...],
  "resolution": "720p"|"1080p",
  "duration": "<int_seconds>",
  "enable_audio": false,
  "multi_shots": false
}

Body (klingo3 / klingo3pro):
{
  "prompt": "<resolved_prompt>" | "",
  "multi_prompt": [
    { "prompt": "<shot_1>", "duration": "5" },
    { "prompt": "<shot_2>", "duration": "5" }
  ],
  "elements": [
    { "frontal_image_url": "<obj_url>", "reference_image_urls": ["<obj_url>"] },
    ...
  ],
  "image_urls": ["<background_url>"],
  "duration": "<int_seconds>",
  "aspect_ratio": "16:9",
  "multi_shots": false
}
```

**Prompt resolution:**
- WAN Flash: `{bg}` → `@Character1`, `{object_1}` → `@Character2`, etc.
- Kling O3: prompts already use `@ElementN`/`@Image1` natively

**Max images:**
- WAN Flash: 5 total (1 bg + up to 4 objects)
- Kling O3: 4 elements + background separately

**Webhook URL params:**
```
step=GenerateVideo
scene_id=<uuid>
```

**Webhook handler:** `webhook/index.ts` → `handleGenerateVideo`

---

### 14. SFX Generation

**File:** `supabase/functions/generate-sfx/index.ts`

**Endpoint:** `https://queue.fal.run/workflows/octupost/sfx`

**Request Pattern:** Queue with webhook
```
URL: https://queue.fal.run/workflows/octupost/sfx?fal_webhook=<webhook_url>
Method: POST
Headers:
  Authorization: Key <FAL_KEY>
  Content-Type: application/json

Body:
{
  "video_url": "<scene_video_url>",
  "prompt": "<sfx_prompt>"      // optional
}
```

**Webhook URL params:**
```
step=GenerateSFX
scene_id=<uuid>
```

**Webhook handler:** `webhook/index.ts` → `handleGenerateSFX`

---

### 15–16. Text-to-Speech (TTS)

**File:** `supabase/functions/generate-tts/index.ts`

**Endpoints:**
| Model | Endpoint |
|---|---|
| `turbo-v2.5` | `fal-ai/elevenlabs/tts/turbo-v2.5` |
| `multilingual-v2` (default) | `fal-ai/elevenlabs/tts/multilingual-v2` |

**Request Pattern:** Queue with webhook
```
URL: https://queue.fal.run/fal-ai/elevenlabs/tts/<model>?fal_webhook=<webhook_url>
Method: POST
Headers:
  Authorization: Key <FAL_KEY>
  Content-Type: application/json

Body:
{
  "text": "<voiceover_text>",
  "voice": "<voice_id>",          // default: "pNInz6obpgDQGcFmaJgB"
  "stability": 0.5,
  "similarity_boost": 0.75,
  "speed": <float 0.7-1.2>,
  "previous_text": "<prev_scene_text>" | null,
  "next_text": "<next_scene_text>" | null
}
```

**Webhook URL params:**
```
step=GenerateTTS
voiceover_id=<uuid>
```

**Webhook payload (on completion):**
```json
{
  "status": "OK" | "ERROR",
  "audio": { "url": "<string>", "content_type": "<string>", "file_size": <int> }
}
```

**Webhook handler:** `webhook/index.ts` → `handleGenerateTTS`

---

### 17. Quick Image Generation (Editor)

**File:** `editor/src/app/api/fal/image/route.ts`

**Endpoint:** `fal-ai/z-image/turbo` (via `@fal-ai/client` SDK, `fal.subscribe`)

**Request Pattern:** Synchronous (SDK handles polling)
```
fal.subscribe('fal-ai/z-image/turbo', {
  input: {
    prompt: "<user_prompt>",
    image_size: { width: <int>, height: <int> },
    num_inference_steps: 8,
    num_images: 1,
    enable_safety_checker: true,
    output_format: "png",
    acceleration: "none"
  }
})
```

**Aspect ratio dimensions:**
- `1:1` → 1024x1024
- `9:16` → 1024x1920
- `16:9` → 1920x1024

**Response:**
```json
{ "images": [{ "url": "<string>" }] }
```

**No webhook.** Result saved to `assets` table.

---

### 18. Quick Video Generation (Editor)

**File:** `editor/src/app/api/fal/video/route.ts`

**Endpoint:** `fal-ai/longcat-video/distilled/text-to-video/480p` (via `@fal-ai/client` SDK, `fal.subscribe`)

**Request Pattern:** Synchronous (SDK handles polling)
```
fal.subscribe('fal-ai/longcat-video/distilled/text-to-video/480p', {
  input: {
    prompt: "<user_prompt>",
    aspect_ratio: "16:9"|"9:16"|"1:1",
    num_frames: 60,
    num_inference_steps: 12,
    fps: 15,
    enable_safety_checker: true,
    video_output_type: "X264 (.mp4)",
    video_quality: "high",
    video_write_mode: "balanced"
  }
})
```

**Response:**
```json
{ "video": { "url": "<string>" } }
```

**No webhook.** Result saved to `assets` table.

---

### 19. SkyReels (Non-fal.ai, Direct API)

**File:** `supabase/functions/generate-video/index.ts` (submit)
**File:** `supabase/functions/poll-skyreels/index.ts` (poll)

**Submit endpoint:** `https://apis.skyreels.ai/api/v1/video/multiobject/submit`
**Poll endpoint:** `https://apis.skyreels.ai/api/v1/video/multiobject/task/<task_id>`

**Submit payload:**
```json
{
  "api_key": "<SKYREELS_API_KEY>",
  "prompt": "<scene_prompt>",
  "ref_images": ["<background_url>", "<object_url_1>", ...],
  "duration": <int>,
  "aspect_ratio": "16:9"
}
```
Max 4 ref_images (1 bg + max 3 objects).

**Poll response:**
```json
{ "status": "success"|"failed"|"running", "data": { "video_url": "<string>" }, "msg": "<error>" }
```

**No webhook.** Uses cron-based polling via `poll-skyreels` edge function.

---

## Media Proxy

**File:** `editor/src/app/api/proxy/media/route.ts`

Proxies media from fal.ai domains (`fal.media`, `fal.ai`) to avoid CORS. Not a fal.ai API call itself.

---

## Webhook Handler Summary

**File:** `supabase/functions/webhook/index.ts`

All fal.ai webhook callbacks are routed through a single edge function. The `step` query param determines the handler:

| Step | Handler | Updates Table | Key Fields |
|---|---|---|---|
| `GenGridImage` | `handleGenGridImage` | `grid_images`, `storyboards` | `url`, `status` |
| `SplitGridImage` | `handleSplitGridImage` | `first_frames` / `objects` / `backgrounds` | `url`, `out_padded_url`, `final_url` |
| `OutpaintImage` | `handleOutpaintImage` | `first_frames` | `outpainted_url`, `final_url`, `image_edit_status` |
| `EnhanceImage` | `handleEnhanceImage` | `first_frames` / `backgrounds` / `objects` | `final_url`, `image_edit_status` |
| `GenerateTTS` | `handleGenerateTTS` | `voiceovers` | `audio_url`, `duration`, `status` |
| `GenerateVideo` | `handleGenerateVideo` | `scenes` | `video_url`, `video_status` |
| `GenerateSFX` | `handleGenerateSFX` | `scenes` | `video_url` (overwrites), `sfx_status` |

---

## Architecture Pattern

All storyboard fal.ai calls follow the same pattern:

1. **Edge function** builds webhook URL with `step` + entity IDs as query params
2. **POST** to `https://queue.fal.run/<endpoint>?fal_webhook=<webhook_url>` with `Authorization: Key <FAL_KEY>`
3. fal.ai returns `{ request_id }` immediately
4. On completion, fal.ai POSTs result to the webhook URL
5. **Webhook handler** (`supabase/functions/webhook/index.ts`) parses the `step` param and routes to the appropriate handler
6. Handler extracts media URLs from response and updates Supabase tables

**Exceptions:**
- Editor routes (`/api/fal/image`, `/api/fal/video`) use `@fal-ai/client` SDK with `fal.subscribe` (synchronous polling, no webhook)
- SkyReels uses its own direct API with cron-based polling instead of webhooks
