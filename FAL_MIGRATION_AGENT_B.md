# fal.ai Migration — Agent B (Direct API Researcher)

## Your Role
You are Agent B. Your job is to **research every fal.ai direct API endpoint** that could replace the current custom workflows. Document the EXACT API spec for each.

## Endpoints to Research

Fetch and document each of these fal.ai model pages. For each, get the EXACT:
- Endpoint URL (the fal.ai model ID used in API calls)
- All input parameters (name, type, required/optional, constraints)
- Output structure (what fields come back)
- Pricing info if visible
- Any special notes (resolution limits, duration limits, etc.)

### Video Generation
1. **Kling O3 Standard Ref-to-Video**: https://fal.ai/models/fal-ai/kling-video/o3/standard/reference-to-video
2. **Kling O3 Pro Ref-to-Video**: https://fal.ai/models/fal-ai/kling-video/o3/pro/reference-to-video
3. **WAN 2.6 Flash I2V**: https://fal.ai/models/wan/v2.6/image-to-video/flash
4. **Grok Imagine Video I2V**: https://fal.ai/models/xai/grok-imagine-video/image-to-video
5. **ByteDance Seedance 1.5 Pro I2V**: https://fal.ai/models/fal-ai/bytedance/seedance/v1.5/pro/image-to-video

### Image Generation/Editing
6. **Nano Banana 2 (image gen)**: https://fal.ai/models/fal-ai/nano-banana-2
7. **Nano Banana 2 Edit**: https://fal.ai/models/fal-ai/nano-banana-2/edit
8. **Flux 2 Pro Edit**: https://fal.ai/models/fal-ai/flux-2-pro/edit
9. **Kling Image O3 I2I**: https://fal.ai/models/fal-ai/kling-image/o3/image-to-image
10. **Grok Imagine Image Edit**: https://fal.ai/models/xai/grok-imagine-image/edit
11. **Bria Fibo Edit**: https://fal.ai/models/bria/fibo-edit/edit

### Audio/SFX
12. **Mirelo SFX v1.5 V2V**: https://fal.ai/models/mirelo-ai/sfx-v1.5/video-to-video

### Grid Operations (check if direct endpoint exists)
13. **Grid Image Generation** — currently `workflows/octupost/generategridimage`
14. **Split Grid Image** — currently `comfy/octupost/splitgridimage`

## How to Research
For each URL:
1. Use web_fetch to get the page content
2. Look for the API endpoint/model ID, input schema, output schema
3. Look for the "API" tab or documentation section on each page
4. Note the fal.ai queue endpoint format: `https://queue.fal.run/{model-id}`

## Output
Save your findings to `FAL_DIRECT_ENDPOINTS.md`

Structure as:
1. Summary table: model name | fal.ai endpoint ID | what it does | key params
2. Detailed section per endpoint with full input/output schemas
3. Section on which current workflows each could replace (your best guess based on functionality)

## Important
- Get ACTUAL API specs, not guesses. Fetch the pages.
- Note any differences between the direct endpoint and what the workflow currently does (e.g., does the direct endpoint support webhooks? queuing?)
- Flag any endpoints that DON'T have a direct equivalent (must stay as workflow)
