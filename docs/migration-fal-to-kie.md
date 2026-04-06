# Migration Plan: fal.ai → k.ai (kie.ai)

## Overview
Replace fal.ai as our AI provider with k.ai (kie.ai). Same models, different routing API. No fallback — direct cutover.

---

## 1. API Architecture Differences

### Authentication
| | fal.ai | k.ai |
|---|---|---|
| Header | `Authorization: Key {FAL_KEY}` | `Authorization: Bearer {KIE_API_KEY}` |
| Env var | `FAL_KEY` | `KIE_API_KEY` |

### Submit Job
| | fal.ai | k.ai |
|---|---|---|
| URL | `POST https://queue.fal.run/{endpoint}` (endpoint-specific) | `POST https://api.kie.ai/api/v1/jobs/createTask` (single URL) |
| Webhook | Query param: `?fal_webhook={url}` | Body field: `callBackUrl: "{url}"` |
| Model | Encoded in URL path | Body field: `model: "nano-banana-2"` |
| Input | Top-level body fields | Nested under `input: { ... }` |

### Poll Job Status
| | fal.ai | k.ai |
|---|---|---|
| URL | `GET https://queue.fal.run/{endpoint}/requests/{id}/status` | `GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId={taskId}` |
| Status values | `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`, `FAILED` | `waiting`, `queuing`, `generating`, `success`, `fail` |
| Result | Separate call: `GET .../requests/{id}` | Same call: `data.resultJson` (JSON string) |

### Webhook Callback Payload
```
// fal.ai webhook POST body:
{
  "status": "OK" | "ERROR",
  "request_id": "abc123",
  "images": [{ "url": "..." }],
  "video": [{ "url": "..." }],
  "audio": { "url": "..." },
  "payload": { ... }       // echo of images/video/audio
}

// k.ai webhook POST body:
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "task_abc123",
    "model": "nano-banana-2",
    "state": "success" | "fail",
    "resultJson": "{\"images\":[{\"url\":\"...\"}]}"   // JSON string — MUST parse
  }
}
```

### Webhook Security
- **fal.ai**: None (no signature verification)
- **k.ai**: HMAC-SHA256 signature via `X-Webhook-Timestamp` + `X-Webhook-Signature` headers
  - `signature = base64(HMAC-SHA256(taskId + "." + timestamp, webhookHmacKey))`
  - Key from: https://kie.ai/settings

---

## 2. Model Mapping (birebir)

| Usage | fal.ai endpoint | k.ai model | Input differences |
|-------|----------------|------------|-------------------|
| **Image Gen** | `fal-ai/nano-banana-2` | `nano-banana-2` | See §3.1 |
| **Image Edit** | `fal-ai/nano-banana-2/edit` | `nano-banana-2` + `image_input` | See §3.2 |
| **Video (Kling O3)** | `fal-ai/kling-video/o3/standard/reference-to-video` | `kling-3.0/video` | See §3.3 |
| **TTS Turbo** | `fal-ai/elevenlabs/tts/turbo-v2` | `elevenlabs/text-to-speech-turbo-2-5` | See §3.4 |
| **TTS Multi** | `fal-ai/elevenlabs/tts/multilingual-v2` | `elevenlabs/text-to-speech-multilingual-v2` | See §3.5 |

---

## 3. Input Payload Differences (birebir)

### 3.1 Nano Banana 2 — Image Generation

```jsonc
// fal.ai
POST https://queue.fal.run/fal-ai/nano-banana-2?fal_webhook={url}
{
  "prompt": "...",
  "image_size": { "width": 1024, "height": 1920 },
  "num_images": 1,
  "safety_tolerance": "6",
  "output_format": "png"
}

// k.ai
POST https://api.kie.ai/api/v1/jobs/createTask
{
  "model": "nano-banana-2",
  "callBackUrl": "{url}",
  "input": {
    "prompt": "...",
    "aspect_ratio": "9:16",        // replaces image_size
    "resolution": "1K",            // "1K" | "2K" | "4K"
    "output_format": "png"         // "png" | "jpg"
  }
}
```

**Key changes:**
- `image_size: {width, height}` → `aspect_ratio` string (e.g. "9:16", "16:9", "1:1")
- New field: `resolution` ("1K" default, "2K", "4K")
- `safety_tolerance` → removed (k.ai doesn't have this)
- `num_images` → removed (k.ai returns 1 image per task)

### 3.2 Nano Banana 2 — Image Edit (ref_to_image)

```jsonc
// fal.ai
POST https://queue.fal.run/fal-ai/nano-banana-2/edit?fal_webhook={url}
{
  "image_urls": ["https://..."],   // reference images
  "prompt": "...",
  "safety_tolerance": "6"
}

// k.ai — SAME model, add image_input
POST https://api.kie.ai/api/v1/jobs/createTask
{
  "model": "nano-banana-2",
  "callBackUrl": "{url}",
  "input": {
    "prompt": "...",
    "image_input": ["https://..."],  // replaces image_urls (up to 14 images)
    "aspect_ratio": "9:16",
    "resolution": "1K"
  }
}
```

**Key changes:**
- `image_urls` → `image_input` (same concept, different field name)
- Same model `nano-banana-2` — NOT a separate `/edit` endpoint
- `safety_tolerance` → removed
- Max 14 images in `image_input`

### 3.3 Kling 3.0 Video (reference-to-video)

```jsonc
// fal.ai
POST https://queue.fal.run/fal-ai/kling-video/o3/standard/reference-to-video?fal_webhook={url}
{
  "prompt": "...",
  "image_url": "https://..."       // first frame
}

// k.ai
POST https://api.kie.ai/api/v1/jobs/createTask
{
  "model": "kling-3.0/video",
  "callBackUrl": "{url}",
  "input": {
    "prompt": "...",
    "image_urls": ["https://..."],  // first frame (index 0)
    "duration": "5",                // 3-15 seconds (string)
    "aspect_ratio": "9:16",
    "mode": "pro",                  // "std" (720p) or "pro" (1080p)
    "sound": false,                 // sound effects
    "multi_shots": false
  }
}
```

**Key changes:**
- `image_url` (singular) → `image_urls` (array, first element = first frame)
- New fields: `duration`, `mode`, `sound`, `multi_shots`
- Supports element references via `kling_elements` + `@element_name` syntax
- Supports last frame: `image_urls[1]`

### 3.4 ElevenLabs TTS Turbo v2.5

```jsonc
// fal.ai
POST https://queue.fal.run/fal-ai/elevenlabs/tts/turbo-v2?fal_webhook={url}
{
  "text": "...",
  "voice_id": "abc123",
  "model_id": "eleven_turbo_v2"
}

// k.ai
POST https://api.kie.ai/api/v1/jobs/createTask
{
  "model": "elevenlabs/text-to-speech-turbo-2-5",
  "callBackUrl": "{url}",
  "input": {
    "text": "...",
    "voice": "abc123"              // voice name or voice_id
  }
}
```

**Key changes:**
- `voice_id` → `voice`
- `model_id` → removed (model is in top-level `model` field)
- Preset voice names: "Rachel", "Aria", "Roger", etc. OR voice IDs

### 3.5 ElevenLabs TTS Multilingual v2

```jsonc
// fal.ai
POST https://queue.fal.run/fal-ai/elevenlabs/tts/multilingual-v2?fal_webhook={url}
{
  "text": "...",
  "voice_id": "abc123",
  "model_id": "eleven_multilingual_v2"
}

// k.ai
POST https://api.kie.ai/api/v1/jobs/createTask
{
  "model": "elevenlabs/text-to-speech-multilingual-v2",
  "callBackUrl": "{url}",
  "input": {
    "text": "...",
    "voice": "abc123"
  }
}
```

Same changes as §3.4.

---

## 4. Result Extraction Differences

### 4.1 Image Result
```jsonc
// fal.ai webhook
{ "images": [{ "url": "https://..." }] }

// k.ai webhook — resultJson is a STRING, must JSON.parse()
{
  "data": {
    "resultJson": "{\"images\":[{\"url\":\"https://...\"}]}"
  }
}
// After parse: { images: [{ url: "..." }] }
```

### 4.2 Video Result
```jsonc
// fal.ai webhook
{ "video": [{ "url": "https://..." }] }
// OR
{ "video": { "url": "https://..." } }

// k.ai webhook
{
  "data": {
    "resultJson": "{\"video\":{\"url\":\"https://...\"}}"
  }
}
```

### 4.3 Audio/TTS Result
```jsonc
// fal.ai webhook
{ "audio": { "url": "https://...", "content_type": "audio/mpeg" } }

// k.ai webhook
{
  "data": {
    "resultJson": "{\"audio\":{\"url\":\"https://...\"}}"
  }
}
```

### 4.4 Download URL Expiry & R2 Persist Strategy
- **fal.ai**: URLs are semi-permanent (CDN) — no action needed
- **k.ai**: URLs expire in ~24 hours — **MUST persist immediately**

#### Solution: Persist ALL Results to R2 in Webhook Handler

Every webhook result (image, video, audio) gets downloaded and re-uploaded to our R2 storage before writing to DB. The DB always stores our R2 URL, never the k.ai temp URL.

**Flow:**
```
k.ai webhook fires
  → Parse resultJson → extract URL
  → Download from k.ai temp URL
  → Upload to R2 (Cloudflare)
  → Write R2 permanent URL to DB
```

**R2 Storage Paths:**
```
kie-results/images/{taskId}.{ext}        ← grid images, first frames, edits
kie-results/videos/{taskId}.mp4          ← scene videos, SFX
kie-results/audio/{taskId}.mp3           ← TTS voiceovers
```

**Implementation — `persistToR2()` helper in webhook:**
```typescript
async function persistToR2(
  sourceUrl: string,
  taskId: string,
  type: 'image' | 'video' | 'audio',
  log: Logger
): Promise<string> {
  const r2 = createR2();
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
  
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  
  const ext = type === 'image' 
    ? (contentType.includes('png') ? 'png' : 'jpg')
    : type === 'video' ? 'mp4' : 'mp3';
  
  const key = `kie-results/${type}s/${taskId}.${ext}`;
  const permanentUrl = await r2.uploadData(key, buffer, contentType);
  
  log.info('Persisted to R2', { source: sourceUrl, r2_url: permanentUrl, size: buffer.length });
  return permanentUrl;
}
```

**Where it's called (in kie webhook adapter):**
```typescript
// After parsing resultJson, before passing to handler:
if (images?.[0]?.url) {
  images[0].url = await persistToR2(images[0].url, taskId, 'image', log);
}
if (video?.url) {
  video.url = await persistToR2(video.url, taskId, 'video', log);
}
if (audio?.url) {
  audio.url = await persistToR2(audio.url, taskId, 'audio', log);
}
// Then pass to existing handlers — they see permanent R2 URLs
```

**Cost:** ~$0.45/month for 1000 assets (~30GB). Egress from R2 is free. Negligible.

**Bonus:** This actually IMPROVES our architecture — we no longer depend on any external CDN. All assets are on our R2.

---

## 5. Files to Change (dosya dosya)

### 5.1 New Files
| File | Purpose |
|------|---------|
| `editor/src/lib/kie.ts` | k.ai client — submit, poll, build payloads |
| `editor/src/app/api/webhook/kie/route.ts` | k.ai webhook handler (adapts k.ai payload → existing handler logic) |

### 5.2 Modified Files

| # | File | What changes |
|---|------|-------------|
| 1 | `editor/.env` + `.env.local` | Add `KIE_API_KEY`, `KIE_WEBHOOK_HMAC_KEY` |
| 2 | `editor/src/lib/config.ts` | Add kie config block |
| 3 | `editor/src/app/api/fal/image/route.ts` | Replace `fal.subscribe('nano-banana-2')` → kie submit |
| 4 | `editor/src/app/api/fal/video/route.ts` | Replace `fal.subscribe('kling-video')` → kie submit |
| 5 | `editor/src/app/api/videos/[id]/generate-grid/route.ts` | Replace fal queue submit → kie createTask |
| 6 | `editor/src/app/api/videos/[id]/generate-images/route.ts` | Replace fal queue submit → kie createTask |
| 7 | `editor/src/app/api/videos/[id]/poll-images/route.ts` | Replace fal status/result polling → kie recordInfo |
| 8 | `editor/src/app/api/videos/[id]/assets/.../regenerate/route.ts` | Replace fal queue submit → kie createTask |
| 9 | `editor/src/app/api/videos/[id]/assets/.../edit-image/route.ts` | Replace fal queue submit → kie createTask |
| 10 | `editor/src/app/api/workflow/poll-fal/route.ts` | Replace ALL fal polling → kie polling (rename to `poll-jobs`) |
| 11 | `editor/src/app/api/workflow/ref-first-frame/route.ts` | Replace fal queue submit → kie createTask |
| 12 | `editor/src/app/api/workflow/edit-image/route.ts` | Replace fal queue submit → kie createTask |
| 13 | `editor/src/app/api/webhook/fal/route.ts` | Keep as-is (legacy), add adapter in kie webhook |
| 14 | `supabase/functions/generate-tts/index.ts` | Replace fal submit → kie createTask |
| 15 | `supabase/functions/generate-video/index.ts` | Replace fal submit → kie createTask |
| 16 | `supabase/functions/edit-image/index.ts` | Replace fal submit → kie createTask |
| 17 | `supabase/functions/start-ref-workflow/index.ts` | Replace fal submit → kie createTask |
| 18 | `supabase/functions/start-workflow/index.ts` | Replace fal submit → kie createTask |

### 5.3 Files NOT Changed (keep for reference)
| File | Why |
|------|-----|
| `editor/src/app/api/webhook/fal/route.ts` | Kept intact — kie webhook adapter calls same handler functions |
| `package.json` | `@fal-ai/client` stays — deprecated but not removed yet |

---

## 6. Implementation Order

### Phase 1: Foundation
1. Create `editor/src/lib/kie.ts` — k.ai client with submit + poll + model mapping
2. Create `editor/src/app/api/webhook/kie/route.ts` — webhook with HMAC verification
3. Add env vars to `.env` / `.env.local`

### Phase 2: Job Submission (change where jobs are SENT)
4. Update `generate-grid/route.ts` — image gen
5. Update `ref-first-frame/route.ts` — image edit  
6. Update `edit-image/route.ts` — image edit/outpaint
7. Update `regenerate/route.ts` — asset regeneration
8. Update `generate-images/route.ts` — video images
9. Update `fal/image/route.ts` + `fal/video/route.ts` — quick gen

### Phase 3: Job Polling (change where jobs are CHECKED)
10. Update `poll-fal/route.ts` → kie polling
11. Update `poll-images/route.ts` → kie polling

### Phase 4: Supabase Edge Functions
12. Update `generate-tts/index.ts`
13. Update `generate-video/index.ts`
14. Update `edit-image/index.ts`
15. Update `start-ref-workflow/index.ts` + `start-workflow/index.ts`

### Phase 5: Cleanup
16. Remove `@fal-ai/client` from dependencies
17. Delete fal-specific code
18. Test full pipeline: image gen → edit → video → TTS → webhook

---

## 7. Webhook Architecture

### Current (fal.ai):
```
fal.ai completes job
  → POST /api/webhook/fal?step=GenGridImage&grid_image_id=xxx
  → Parses fal payload { status, images, video, audio }
  → Updates DB
```

### New (k.ai):
```
k.ai completes job
  → POST /api/webhook/kie?step=GenGridImage&grid_image_id=xxx
  → Verifies HMAC signature
  → Parses k.ai payload { code, data: { taskId, state, resultJson } }
  → Transforms to fal-compatible format { status, images, video, audio }
  → Calls same handler functions (handleGenGridImage, handleGenerateTTS, etc.)
```

**Key insight:** The webhook adapter pattern means we DON'T rewrite 1500+ lines of handler logic. We just translate the incoming payload format.

---

## 8. Environment Variables Needed

```env
# k.ai
KIE_API_KEY=xxx                    # From https://kie.ai/api-key
KIE_WEBHOOK_HMAC_KEY=xxx           # From https://kie.ai/settings

# Deprecated (keep for now)
FAL_KEY=xxx                        # Existing fal.ai key
```

---

## 9. Risk Assessment

| Risk | Mitigation |
|------|-----------|
| k.ai resultJson URLs expire in 24h | `persistToR2()` in webhook — download + upload to R2 before DB write (§4.4) |
| HMAC verification fails | Log raw headers, verify key matches settings page |
| nano-banana-2 edit uses same model (no /edit) | `image_input` field presence triggers edit mode |
| Kling 3.0 different from Kling O3 | Test video quality, verify ref-to-video works with `image_urls` |
| Supabase Edge Functions can't reach k.ai | Verify CORS/firewall, test from edge function |

---

## 10. Testing Checklist

- [ ] Image gen (nano-banana-2) via k.ai → webhook fires → DB updated
- [ ] Image edit (nano-banana-2 + image_input) via k.ai → webhook fires → DB updated  
- [ ] Video gen (kling-3.0) via k.ai → webhook fires → DB updated
- [ ] TTS (elevenlabs turbo) via k.ai → webhook fires → DB updated
- [ ] TTS (elevenlabs multilingual) via k.ai → webhook fires → DB updated
- [ ] Poll-based fallback works when webhook misses
- [ ] HMAC signature verification works
- [ ] Image result persisted to R2 — DB has `r2.cdn` URL, not k.ai temp URL
- [ ] Video result persisted to R2 — DB has `r2.cdn` URL, not k.ai temp URL
- [ ] Audio/TTS result persisted to R2 — DB has `r2.cdn` URL, not k.ai temp URL
- [ ] R2 URLs survive 24h+ (verify k.ai temp URLs would have expired)
- [ ] Full storyboard pipeline: gen grid → split → edit → video → TTS
