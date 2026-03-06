# fal.ai Direct API Endpoints — Research Results

> Researched 2026-03-06 from live fal.ai model pages.

## Summary Table

| # | Model Name | Endpoint ID | Category | Key Params | Price |
|---|-----------|-------------|----------|------------|-------|
| 1 | Kling O3 Standard Ref-to-Video | `fal-ai/kling-video/o3/standard/reference-to-video` | Video Gen | prompt, image_urls, duration, aspect_ratio, elements | $0.168/s (no audio), $0.224/s (audio) |
| 2 | Kling O3 Pro Ref-to-Video | `fal-ai/kling-video/o3/pro/reference-to-video` | Video Gen | prompt, image_urls, duration, aspect_ratio, elements | $0.224/s (no audio), $0.28/s (audio) |
| 3 | WAN 2.6 Flash I2V | `wan/v2.6/image-to-video/flash` | Video Gen | prompt, image_url, resolution, duration | $0.05/s (720p), $0.075/s (1080p) |
| 4 | Grok Imagine Video I2V | `xai/grok-imagine-video/image-to-video` | Video Gen | prompt, image_url, duration, aspect_ratio, resolution | $0.05/s (480p), $0.07/s (720p) + $0.002 input |
| 5 | Seedance 1.5 Pro I2V | `fal-ai/bytedance/seedance/v1.5/pro/image-to-video` | Video Gen | prompt, image_url, end_image_url, duration, camera_fixed | ~$0.26/5s video |
| 6 | Nano Banana 2 (T2I) | `fal-ai/nano-banana-2` | Image Gen | prompt, num_images, resolution, aspect_ratio | $0.08/image (1K) |
| 7 | Nano Banana 2 Edit | `fal-ai/nano-banana-2/edit` | Image Edit | prompt, image_urls, resolution | $0.08/image (1K) |
| 8 | FLUX.2 [pro] Edit | `fal-ai/flux-2-pro/edit` | Image Edit | prompt, image_urls, image_size, safety_tolerance | $0.03/MP + $0.015/extra MP |
| 9 | Kling Image O3 I2I | `fal-ai/kling-image/o3/image-to-image` | Image Edit | prompt, image_urls, resolution, num_images | $0.028/image (1K/2K), $0.056 (4K) |
| 10 | Grok Imagine Image Edit | `xai/grok-imagine-image/edit` | Image Edit | prompt, image_urls, num_images | $0.022/image ($0.02 output + $0.002 input) |
| 11 | Bria Fibo Edit | `bria/fibo-edit/edit` | Image Edit | image_url, instruction, mask_url, structured_instruction | $0.04/image |
| 12 | Mirelo SFX v1.5 V2V | `mirelo-ai/sfx-v1.5/video-to-video` | Audio/SFX | video_url, text_prompt, num_samples, duration | $0.01/s |
| 13 | Grid Image Generation | `workflows/octupost/generategridimage` | Grid Ops | **NO DIRECT ENDPOINT** — custom ComfyUI workflow only |
| 14 | Split Grid Image | `comfy/octupost/splitgridimage` | Grid Ops | **NO DIRECT ENDPOINT** — custom ComfyUI workflow only |

---

## Detailed Endpoint Specs

---

### 1. Kling O3 Standard Reference-to-Video

- **Endpoint ID**: `fal-ai/kling-video/o3/standard/reference-to-video`
- **Queue URL**: `https://queue.fal.run/fal-ai/kling-video/o3/standard/reference-to-video`
- **License**: Commercial use permitted

#### Input Schema

| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Supports @Element and @Image references |
| `image_urls` | array[string] | Yes | — | Start frame images; jpg/jpeg/png/webp/gif/avif |
| `start_image_url` | string | No | — | Custom start frame override |
| `end_image_url` | string | No | — | Target end frame for transitions |
| `duration` | integer | No | 8 | 3–15 seconds |
| `aspect_ratio` | string | No | "16:9" | e.g. "16:9", "9:16", "1:1" |
| `generate_audio` | boolean | No | false | Enable native audio synthesis |
| `elements` | array[Element] | No | — | Up to 2 character/object references |

**Element Schema**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `frontal_image_url` | string | Yes | Character/object frontal view |
| `reference_image_urls` | array[string] | No | Additional appearance references |
| `video_url` | string | No | Motion reference video |

#### Output Schema

```json
{
  "video": {
    "url": "string",
    "file_size": "integer",
    "file_name": "string",
    "content_type": "video/mp4"
  }
}
```

#### Pricing
- **Without audio**: $0.168 per second
- **With audio**: $0.224 per second
- Example: 5s video with audio = $1.12

#### Notes
- Maintains stable character identity across scenes via multi-reference element binding
- Accepted video formats for reference: mp4, mov, webm, m4v, gif

---

### 2. Kling O3 Pro Reference-to-Video

- **Endpoint ID**: `fal-ai/kling-video/o3/pro/reference-to-video`
- **Queue URL**: `https://queue.fal.run/fal-ai/kling-video/o3/pro/reference-to-video`
- **License**: Commercial use permitted

#### Input Schema

| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Supports @Element and @Image references |
| `image_urls` | array[string] | No | — | Additional reference images |
| `start_image_url` | string | No | — | Initial frame |
| `end_image_url` | string | No | — | Final frame for transitions |
| `duration` | integer | No | 8 | Video length in seconds |
| `aspect_ratio` | string | No | "16:9" | Output dimensions |
| `generate_audio` | boolean | No | false | Enable audio generation |
| `elements` | array[Element] | No | — | Up to 2 elements (same schema as Standard) |

#### Output Schema

```json
{
  "video": {
    "url": "string",
    "file_size": "integer",
    "file_name": "string",
    "content_type": "video/mp4"
  }
}
```

#### Pricing
- **Without audio**: $0.224 per second
- **With audio**: $0.28 per second
- Example: 5s video with audio = $1.40

#### Notes
- Pro tier = higher quality than Standard, same API shape
- Supports same element/reference system as Standard

---

### 3. WAN 2.6 Flash Image-to-Video

- **Endpoint ID**: `wan/v2.6/image-to-video/flash`
- **Queue URL**: `https://queue.fal.run/wan/v2.6/image-to-video/flash`

#### Input Schema

| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Max 800 chars, min 1 |
| `image_url` | string | Yes | — | Public URL or base64; dimensions 240–7680px |
| `audio_url` | string | No | null | WAV/MP3, 3–30s, max 15MB |
| `resolution` | string | No | "1080p" | "720p" or "1080p" |
| `duration` | string | No | "5" | "5", "10", or "15" |
| `negative_prompt` | string | No | "" | Max 500 chars |
| `enable_prompt_expansion` | boolean | No | true | LLM-based prompt rewriting |
| `multi_shots` | boolean | No | false | Intelligent scene segmentation |
| `seed` | integer | No | random | Reproducibility |
| `enable_safety_checker` | boolean | No | true | Content moderation |

#### Output Schema

```json
{
  "video": {
    "url": "string",
    "content_type": "video/mp4"
  },
  "seed": "integer",
  "actual_prompt": "string"
}
```

#### Pricing
- **720p**: $0.05 per second
- **1080p**: $0.075 per second

#### Notes
- Uses first image as video starting point
- Multi-shot capability with scene segmentation
- Audio integration (external audio_url or silent)
- Duration is a string enum, not integer

---

### 4. Grok Imagine Video — Image-to-Video

- **Endpoint ID**: `xai/grok-imagine-video/image-to-video`
- **Queue URL**: `https://queue.fal.run/xai/grok-imagine-video/image-to-video`
- **Provider**: xAI (Partner API)
- **License**: Commercial

#### Input Schema

| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Max 4096 chars |
| `image_url` | string | Yes | — | Input image URL |
| `duration` | integer | No | 6 | 1–15 seconds |
| `aspect_ratio` | string | No | "auto" | auto, 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16 |
| `resolution` | string | No | "720p" | "480p" or "720p" |

#### Output Schema

```json
{
  "video": {
    "url": "string",
    "height": "integer",
    "width": "integer",
    "duration": "float",
    "fps": "integer",
    "file_name": "string",
    "content_type": "video/mp4",
    "num_frames": "integer"
  }
}
```

#### Pricing
- **480p**: $0.05/s + $0.002 image input
- **720p**: $0.07/s + $0.002 image input

#### Notes
- Max resolution is 720p (no 1080p)
- Charges apply even if request violates xAI terms
- No coldstarts

---

### 5. ByteDance Seedance 1.5 Pro — Image-to-Video

- **Endpoint ID**: `fal-ai/bytedance/seedance/v1.5/pro/image-to-video`
- **Queue URL**: `https://queue.fal.run/fal-ai/bytedance/seedance/v1.5/pro/image-to-video`
- **License**: Commercial

#### Input Schema

| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Action, dialogue, camera, sound descriptions |
| `image_url` | string | Yes | — | Start frame image |
| `end_image_url` | string | No | — | End frame for closing composition |
| `aspect_ratio` | enum | No | "16:9" | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 |
| `resolution` | enum | No | "720p" | "480p" or "720p" |
| `duration` | integer | No | 5 | 4–12 seconds |
| `generate_audio` | boolean | No | true | Enable audio generation |
| `camera_fixed` | boolean | No | false | Lock camera position (tripod) |
| `seed` | integer | No | — | -1 for random |

#### Output Schema

```json
{
  "video": {
    "url": "string"
  },
  "seed": "integer"
}
```

#### Pricing
- ~$0.26 per 5s 720p video with audio
- With audio: $2.4 per 1M video tokens
- Without audio: $1.2 per 1M video tokens
- Token calc: `(height × width × FPS × duration) / 1024`

#### Notes
- Audio codec: 48 kHz AAC, output H.264 MP4
- `camera_fixed` is unique — useful for tripod shots
- Start + end image support for controlled transitions

---

### 6. Nano Banana 2 (Text-to-Image)

- **Endpoint ID**: `fal-ai/nano-banana-2`
- **Queue URL**: `https://queue.fal.run/fal-ai/nano-banana-2`

#### Input Schema

| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | 3–50,000 chars |
| `num_images` | integer | No | 1 | 1–4 |
| `resolution` | enum | No | "1K" | "0.5K", "1K", "2K", "4K" |
| `aspect_ratio` | enum | No | "auto" | auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16 |
| `output_format` | enum | No | "png" | jpeg, png, webp |
| `safety_tolerance` | enum | No | "4" | "1"–"6" |
| `seed` | integer | No | null | Reproducibility |
| `enable_web_search` | boolean | No | false | Real-time web grounding |
| `sync_mode` | boolean | No | false | Return as data URI |
| `limit_generations` | boolean | No | true | Single gen per prompt round |

#### Output Schema

```json
{
  "images": [
    {
      "url": "string",
      "file_name": "string",
      "content_type": "string",
      "file_size": "integer",
      "width": "integer",
      "height": "integer"
    }
  ],
  "description": "string"
}
```

#### Pricing
- **0.5K**: $0.06/image
- **1K**: $0.08/image
- **2K**: $0.12/image
- **4K**: $0.16/image
- **Web search**: +$0.015/request

#### Notes
- Built on Gemini 3.1 Flash, "reasoning-guided" architecture
- Accurate text rendering in multiple languages
- Character consistency for up to 5 people
- SynthID digital watermarking on all outputs

---

### 7. Nano Banana 2 Edit

- **Endpoint ID**: `fal-ai/nano-banana-2/edit`
- **Queue URL**: `https://queue.fal.run/fal-ai/nano-banana-2/edit`

#### Input Schema

| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | 3–50,000 chars |
| `image_urls` | array[string] | Yes | — | Up to 14 reference images |
| `num_images` | integer | No | 1 | 1–4 |
| `resolution` | enum | No | "1K" | "0.5K", "1K", "2K", "4K" |
| `aspect_ratio` | enum | No | "auto" | Same options as T2I |
| `output_format` | enum | No | "png" | jpeg, png, webp |
| `safety_tolerance` | enum | No | "4" | "1"–"6" |
| `seed` | integer | No | null | Reproducibility |
| `enable_web_search` | boolean | No | false | Web grounding |
| `sync_mode` | boolean | No | false | Data URI return |
| `limit_generations` | boolean | No | true | — |

#### Output Schema

```json
{
  "images": [{ "url": "string", "content_type": "string", "file_name": "string", "file_size": "integer", "width": "integer", "height": "integer" }],
  "description": "string"
}
```

#### Pricing
Same as Nano Banana 2 T2I (resolution-based, $0.08/image at 1K).

#### Notes
- Accepts up to 14 reference images for compositing
- No mask required — semantic editing via prompt
- SynthID watermarking on all outputs

---

### 8. FLUX.2 [pro] Edit

- **Endpoint ID**: `fal-ai/flux-2-pro/edit`
- **Queue URL**: `https://queue.fal.run/fal-ai/flux-2-pro/edit`
- **License**: Commercial

#### Input Schema

| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Editing instructions |
| `image_urls` | array[string] | Yes | — | Up to 9 images (9 MP total input) |
| `image_size` | enum/object | No | "auto" | auto, square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9, or custom {width, height} (1–14142px) |
| `seed` | integer | No | null | Reproducibility |
| `safety_tolerance` | string | No | "2" | "1"–"5" (1=strictest) |
| `enable_safety_checker` | boolean | No | true | Toggle safety |
| `output_format` | enum | No | "jpeg" | jpeg, png |
| `sync_mode` | boolean | No | false | Data URI return |

#### Output Schema

```json
{
  "images": [{ "url": "string", "content_type": "string", "file_name": "string", "file_size": "integer", "width": "integer", "height": "integer" }],
  "seed": "integer"
}
```

#### Pricing
- $0.03 per first megapixel of output
- $0.015 per extra megapixel (input + output combined)
- Rounded up to nearest MP
- Example: 1024×1024 = $0.03; 1920×1080 = $0.045

#### Notes
- Multi-reference editing with @image1, @image2 syntax
- JSON structured prompts supported for granular control
- HEX color code specifications
- No masks required

---

### 9. Kling Image O3 — Image-to-Image

- **Endpoint ID**: `fal-ai/kling-image/o3/image-to-image`
- **Queue URL**: `https://queue.fal.run/fal-ai/kling-image/o3/image-to-image`

#### Input Schema

| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Max 2500 chars |
| `image_urls` | array[string] | Yes | — | 1–10 images, max 10MB each |
| `resolution` | enum | No | "1K" | "1K", "2K", "4K" |
| `num_images` | integer | No | 1 | 1–9 |
| `aspect_ratio` | enum | No | "auto" | 16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3, 21:9, auto |
| `result_type` | enum | No | "single" | "single" or "series" |
| `series_amount` | integer | No | — | 2–9 (only for series mode) |
| `output_format` | enum | No | "png" | jpeg, png, webp |
| `sync_mode` | boolean | No | false | — |
| `elements` | array | No | null | Optional character/object control |

#### Output Schema

```json
{
  "images": [{ "url": "string", "file_name": "string", "content_type": "string", "file_size": "integer", "width": "integer", "height": "integer" }]
}
```

#### Pricing
- **1K/2K**: $0.028/image
- **4K**: $0.056/image

#### Notes
- Min 300px width/height; aspect ratio 0.4–2.5
- File size limit 10MB per image
- Series mode generates consistent image sequences
- Element control for character consistency

---

### 10. Grok Imagine Image Edit

- **Endpoint ID**: `xai/grok-imagine-image/edit`
- **Queue URL**: `https://queue.fal.run/xai/grok-imagine-image/edit`
- **Provider**: xAI (Partner)

#### Input Schema

| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Max 8000 chars |
| `image_urls` | array[string] | No | — | Max 3 images |
| `num_images` | integer | No | 1 | 1–4 |
| `output_format` | enum | No | "jpeg" | jpeg, png, webp |
| `sync_mode` | boolean | No | false | — |

#### Output Schema

```json
{
  "images": [{ "url": "string", "content_type": "string", "file_name": "string", "file_size": "integer", "width": "integer", "height": "integer" }],
  "revised_prompt": "string"
}
```

#### Pricing
- $0.022/image ($0.02 output + $0.002 input)

#### Notes
- Also supports `/` (T2I), `/image-to-video`, `/text-to-video`, `/edit-video` on same base
- Charges apply even on TOS violations
- Returns `revised_prompt` showing enhanced prompt

---

### 11. Bria Fibo Edit

- **Endpoint ID**: `bria/fibo-edit/edit`
- **Queue URL**: `https://queue.fal.run/bria/fibo-edit/edit`
- **License**: Commercial

#### Input Schema

| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `image_url` | string | Yes | — | Reference image (jpg/jpeg/png/webp/gif/avif) |
| `instruction` | string | No | — | Natural language edit instruction |
| `mask_url` | string | No | — | Optional mask image |
| `structured_instruction` | object | No | — | JSON-based instruction (alternative to text) |
| `seed` | integer | No | 5555 | Reproducibility |
| `sync_mode` | boolean | No | false | Direct response (higher latency) |
| `steps_num` | integer | No | 30 | 20–50 |
| `guidance_scale` | number | No | 5 | 3–5 |
| `negative_prompt` | string | No | "" | Negative guidance |

#### Output Schema

```json
{
  "image": { "url": "string", "content_type": "string", "file_name": "string", "file_size": "integer", "width": "integer", "height": "integer" },
  "images": "array[ImageFile]",
  "structured_instruction": "object"
}
```

#### Pricing
- $0.04/image

#### Additional Operations (sub-endpoints)
- `/colorize` — Apply color palettes (contemporary, vivid, B&W, sepia)
- `/blend` — Merge elements preserving originals
- `/reseason` — Change seasons (spring, summer, autumn, winter)
- `/restyle` — Apply artistic styles (3D Render, Cubism, Oil Painting, Anime, etc.)
- `/relight` — Adjust lighting direction and type
- `/restore` — Image restoration
- `/erase_by_text` — Remove objects by description
- `/add_object_by_text` — Insert objects by instruction
- `/replace_object_by_text` — Replace objects
- `/rewrite_text` — Modify text in images
- `/sketch_to_colored_image` — Colorize sketches

#### Notes
- Most versatile editing endpoint with 12+ sub-operations
- Supports mask + JSON instruction + image for maximum control
- Structured instructions allow fine-grained photographic/aesthetic/lighting params

---

### 12. Mirelo SFX v1.5 — Video-to-Video

- **Endpoint ID**: `mirelo-ai/sfx-v1.5/video-to-video`
- **Queue URL**: `https://queue.fal.run/mirelo-ai/sfx-v1.5/video-to-video`
- **License**: Commercial

#### Input Schema

| Parameter | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `video_url` | string (URI) | Yes | — | 1–2083 chars; mp4/mov/webm/m4v/gif |
| `text_prompt` | string | No | "" | Guidance for audio generation |
| `num_samples` | integer | No | 2 | 2–8 |
| `seed` | integer | No | 8069 | ≥1 |
| `duration` | float | No | 10 | 1–10 seconds |
| `start_offset` | float | No | 0 | ≥0 seconds |

#### Output Schema (Video-to-Video)

```json
{
  "video": [
    {
      "file_name": "string",
      "content_type": "video/mp4",
      "url": "string"
    }
  ]
}
```

#### Also Available: Video-to-Audio (`/video-to-audio`)

```json
{
  "audio": [
    {
      "file_name": "string",
      "content_type": "audio/wav",
      "url": "string"
    }
  ]
}
```

#### Pricing
- $0.01 per second

#### Notes
- Generates contextually appropriate SFX synchronized to video
- Returns multiple samples (2–8) per request
- Max audio duration: 10 seconds
- Also exposes `/video-to-audio` for audio-only output

---

### 13 & 14. Grid Operations — NO DIRECT ENDPOINT

- **Generate Grid Image**: `workflows/octupost/generategridimage` (custom ComfyUI workflow)
- **Split Grid Image**: `comfy/octupost/splitgridimage` (custom ComfyUI workflow)

**Status**: These are custom ComfyUI workflows with no direct fal.ai model equivalent. No standard fal.ai API endpoint exists for grid image generation or grid splitting. These operations **must remain as workflows** unless replaced with client-side image manipulation logic.

**Potential alternatives**:
- Grid generation could be done client-side by tiling multiple images into a canvas (using Sharp, Canvas API, or similar)
- Grid splitting is a simple image crop operation that can be done client-side
- Neither operation requires GPU — they're purely image manipulation

---

## Workflow Replacement Summary

| Current Workflow | Direct Replacement | Notes |
|-----------------|-------------------|-------|
| Custom Kling ref-to-video workflow | `fal-ai/kling-video/o3/standard/reference-to-video` or `/pro/` | Direct drop-in with element system |
| Custom WAN I2V workflow | `wan/v2.6/image-to-video/flash` | Direct drop-in |
| Custom video generation | `xai/grok-imagine-video/image-to-video` | New option, max 720p |
| Custom video generation | `fal-ai/bytedance/seedance/v1.5/pro/image-to-video` | New option, built-in audio |
| Custom image gen workflow | `fal-ai/nano-banana-2` | Direct T2I replacement |
| Custom image edit workflow | `fal-ai/nano-banana-2/edit`, `fal-ai/flux-2-pro/edit`, `xai/grok-imagine-image/edit`, `bria/fibo-edit/edit` | Multiple options by price/quality |
| Custom I2I workflow | `fal-ai/kling-image/o3/image-to-image` | Direct replacement with series mode |
| Custom SFX workflow | `mirelo-ai/sfx-v1.5/video-to-video` | Direct drop-in |
| `workflows/octupost/generategridimage` | **NONE** — must stay as workflow or move client-side | Simple image tiling |
| `comfy/octupost/splitgridimage` | **NONE** — must stay as workflow or move client-side | Simple image cropping |

## Queue/Webhook Support

All fal.ai direct endpoints support the standard fal queue system:
- **Submit**: `POST https://queue.fal.run/{endpoint-id}`
- **Status**: `GET https://queue.fal.run/{endpoint-id}/requests/{request-id}/status`
- **Result**: `GET https://queue.fal.run/{endpoint-id}/requests/{request-id}`
- **Webhooks**: Supported via `webhook_url` parameter in the queue submission
- **Streaming**: Some endpoints support SSE streaming via `fal.stream()`

All 12 direct endpoints fully support async queuing and webhooks.
