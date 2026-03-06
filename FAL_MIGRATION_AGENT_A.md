# fal.ai Migration — Agent A (Current State Mapper)

## Your Role
You are Agent A. Your job is to **map every fal.ai workflow and endpoint currently used** in this codebase. Find every single call to fal.ai, document what it does, what payload it sends, and what response it expects.

## Task

### 1. Search the entire codebase for fal.ai usage
Look in:
- `supabase/functions/` — all edge functions
- `editor/src/` — API routes and utilities
- Any config files

Search for:
- `queue.fal.run`
- `fal.ai`
- `fal_webhook`
- `workflows/octupost/`
- `fal-ai/`
- Any fal.ai SDK imports

### 2. For EACH fal.ai call found, document:
- **File path** where the call is made
- **Current endpoint** (e.g., `workflows/octupost/generategridimage`)
- **What it does** (generate grid, split grid, generate video, edit image, etc.)
- **Full request payload** (all fields sent)
- **Full response structure** (what fields come back)
- **Webhook step name** (e.g., `GenGridImage`, `SplitGridImage`, `GenerateVideo`)
- **Which models/modes use it** (I2V, Kling, WAN, etc.)

### 3. Categorize each call:
- **WORKFLOW** = custom ComfyUI/workflow endpoint (e.g., `workflows/octupost/...`, `comfy/octupost/...`)
- **DIRECT** = already using a direct fal.ai model endpoint (e.g., `fal-ai/kling-video/...`)

### 4. Save your findings to `FAL_CURRENT_STATE.md`

Structure it as a table + detailed breakdown per endpoint.

## Important
- Be EXHAUSTIVE. Every single fal.ai call in the codebase.
- Include the EXACT payload structure (copy from source code).
- Note which webhook handler processes each callback.
- Note any environment variables used (API keys, webhook URLs).
