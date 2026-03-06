# SkyReels Integration — Plan A (Minimal Integration)

> Agent A's implementation plan. Bias: **reuse everything possible, minimal changes**.

---

## Table of Contents

1. [Architecture Decision](#1-architecture-decision)
2. [LLM Plan Changes](#2-llm-plan-changes)
3. [Grid Generation](#3-grid-generation)
4. [Video Generation — Polling Pattern](#4-video-generation--polling-pattern)
5. [Duration Handling](#5-duration-handling)
6. [Edge Function Changes](#6-edge-function-changes)
7. [DB Changes](#7-db-changes)
8. [UI Changes](#8-ui-changes)
9. [File-by-File Change List](#9-file-by-file-change-list)
10. [Edge Cases & Failure Modes](#10-edge-cases--failure-modes)

---

## 1. Architecture Decision

### SkyReels belongs in the **ref-to-video pipeline**, not I2V.

**Rationale:**

| Requirement | I2V Pipeline | Ref-to-Video Pipeline | SkyReels API |
|---|---|---|---|
| Input images | 1 first_frame per scene (split from grid) | N object images + 1 background per scene | 1-4 ref_images (objects + background) |
| Grid type | Single grid (scenes) | Dual grids (objects + backgrounds) | Needs separate objects + backgrounds |
| Prompt style | `visual_flow` — animate a static frame | `scene_prompts` with `@Element` refs | `prompt` describing scene with characters |
| Image source | Grid cell = the first frame itself | Grid cells = reusable character/bg references | Reference images = reusable characters/bgs |

SkyReels takes **1-4 reference images** (characters + environment) and a **prompt**, which is structurally identical to the ref-to-video pattern. The I2V pipeline generates ONE image per scene (the first frame) and animates it — SkyReels doesn't work that way.

**Decision:** Add `skyreels` as a new `videoModel` option in the existing ref-to-video pipeline, alongside `klingo3`, `klingo3pro`, and `wan26flash`. This reuses:
- The dual-grid generation (objects + backgrounds)
- The `scene_prompts` / `scene_bg_indices` / `scene_object_indices` plan structure
- The `approve-ref-grid` → `approve-ref-split` flow
- The `scene_objects` / `scene_backgrounds` DB tables
- The existing grid review UX

**What's new:** SkyReels has no fal.ai integration and no webhooks — it uses a **direct REST API with polling**. This is the single biggest architectural difference and requires a new edge function.

### @Element Syntax for SkyReels

SkyReels doesn't use `@Element` or `@Image` references in its prompts — it just takes a `prompt` string and `ref_images` array. The prompt should describe the scene in natural language. However, to maintain consistency with the ref-to-video plan structure, we'll use the **WAN-style `@Element` convention** in LLM-generated prompts and strip them before sending to SkyReels:

- `@Element1` = background (from `scene_bg_indices`)
- `@Element2`, `@Element3`, etc. = objects (from `scene_object_indices`)

At video generation time, we strip `@ElementN` references from the prompt since SkyReels uses positional `ref_images` rather than inline references.

---

## 2. LLM Plan Changes

### New Schema File: `editor/src/lib/schemas/skyreels-plan.ts`

SkyReels plan structure is nearly identical to WAN 2.6 Flash, with these differences:
- **No `scene_multi_shots`** — SkyReels doesn't support multi-shot
- **Max 5s per scene** — voiceover splitting targets shorter segments
- **Max 4 ref_images** — 1 background + up to 3 objects per scene (not 4)

```typescript
// editor/src/lib/schemas/skyreels-plan.ts

import { z } from 'zod';

// ---- Element schema (reuse WAN pattern) ----
export const skyreelsElementSchema = z.object({
  name: z.string(),
  description: z.string(),
});

// ---- Content schema (LLM output) ----
export const skyreelsContentSchema = z.object({
  objects_rows: z.number().int().min(2).max(6),
  objects_cols: z.number().int().min(2).max(6),
  objects_grid_prompt: z.string(),
  objects: z.array(skyreelsElementSchema).min(1).max(36),

  bg_rows: z.number().int().min(2).max(6),
  bg_cols: z.number().int().min(2).max(6),
  backgrounds_grid_prompt: z.string(),
  background_names: z.array(z.string()).min(1).max(36),

  scene_prompts: z.array(z.string()),          // string only (no multi-shot)
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(
    z.array(z.number().int().min(0)).max(3)     // max 3 objects (+ 1 bg = 4 ref_images)
  ),

  voiceover_list: z.array(z.string()),
});

// ---- Plan schema (stored in DB) ----
export const skyreelsPlanSchema = z.object({
  objects_rows: z.number().int().min(2).max(6),
  objects_cols: z.number().int().min(2).max(6),
  objects_grid_prompt: z.string(),
  objects: z.array(skyreelsElementSchema).min(1).max(36),

  bg_rows: z.number().int().min(2).max(6),
  bg_cols: z.number().int().min(2).max(6),
  backgrounds_grid_prompt: z.string(),
  background_names: z.array(z.string()).min(1).max(36),

  scene_prompts: z.array(z.string()),
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(
    z.array(z.number().int().min(0)).max(3)
  ),

  voiceover_list: z.record(z.string(), z.array(z.string())),
});

// ---- Reviewer output schema ----
export const skyreelsReviewerOutputSchema = z.object({
  scene_prompts: z.array(z.string()),
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(
    z.array(z.number().int().min(0)).max(3)
  ),
});
```

### System Prompt

```typescript
export const SKYREELS_SYSTEM_PROMPT = `
You are a storyboard planner for AI video generation using SkyReels (reference-to-video).

RULES:
1. Voiceover Splitting and Grid Planning
- Target 3-5 seconds of speech per voiceover segment (video max is 5 seconds).
- Shorter segments are better. Prefer more scenes with shorter voiceovers over fewer scenes with longer voiceovers.
- Adjust your splitting strategy so the total segment count matches one of the valid grid sizes below for scene count.

2. Elements (Characters/Objects)
- Each scene can use UP TO 3 tracked elements (characters/objects) + 1 background = 4 max (SkyReels limit).
- Elements are reusable across scenes. Design distinct, recognizable characters/objects.
- For each element, provide:
  - "name": short label (e.g. "Ahmed", "Cat")
  - "description": detailed visual description for AI tracking
- Descriptions must be specific enough that the AI can consistently track the element across frames.
- All elements must be front-facing with full body visible.
- Valid grid sizes for objects grid: 2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36).

3. Backgrounds
- Maximize background reuse: prefer fewer unique backgrounds used in many scenes.
- Backgrounds are empty environments with NO people or characters.
- Describe with specific atmospheric details: time of day, lighting, weather, key features.
- Valid grid sizes for backgrounds grid: 2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36).

4. Scene Prompts
- Write vivid, cinematic shot descriptions.
- Reference characters by name (e.g. "Ahmed walks through the park") rather than @Element syntax.
- SkyReels uses natural language prompts — describe the action, emotions, camera angles.
- Include lighting details, character emotions, body language, specific actions.
- Max 512 tokens per prompt.
- Each prompt describes a single continuous shot (no multi-shot).

5. Visual & Content Rules
DO:
- Use modern islamic clothing styles if people are shown. For girls use modest clothing with NO Hijab.
- If the voiceover mentions real people, brands, landmarks, or locations, use their actual names.
DO NOT:
- Do not add any extra text or overlay text.
- Do not add any violence.

OUTPUT FORMAT:
Return valid JSON matching this structure:
{
  "objects_rows": 2, "objects_cols": 2,
  "objects_grid_prompt": "A 2x2 Grid. Grid_1x1: ..., Grid_1x2: ..., Grid_2x1: ..., Grid_2x2: ...",
  "objects": [
    { "name": "Ahmed", "description": "A young boy with short brown hair..." },
    ...
  ],
  "bg_rows": 2, "bg_cols": 2,
  "backgrounds_grid_prompt": "A 2x2 Grid. Grid_1x1: ..., Grid_1x2: ..., Grid_2x1: ..., Grid_2x2: ...",
  "background_names": ["City street at dusk", "School courtyard", ...],
  "scene_prompts": [
    "Ahmed walks through the city street at dusk, warm amber light casting long shadows...",
    ...
  ],
  "scene_bg_indices": [0, 1, 2, 0],
  "scene_object_indices": [[0, 1], [0], [1], [0, 1]],
  "voiceover_list": ["segment 1 text", "segment 2 text", ...]
}
`;
```

### Reviewer Prompt

```typescript
export const SKYREELS_REVIEWER_SYSTEM_PROMPT = `
You are a storyboard reviewer for SkyReels reference-to-video generation.

YOUR TASKS:
1. Improve prompt quality
   - Replace generic prompts with vivid, cinematic shot descriptions.
   - Include specific camera techniques, lighting details, character emotions.
   - Prompts must be under 512 tokens.
   - Each prompt describes a single continuous shot.

2. Verify scene assignments
   - Check if object/background assignments make narrative sense.
   - Each scene can have at most 3 objects (SkyReels limit: 4 ref_images total including background).
   - Ensure every scene has at least one object assigned.
   - Reassign scene_bg_indices or scene_object_indices if needed.

3. Verify character references
   - Scene prompts should reference characters by their names from the objects list.
   - Ensure each character mentioned in the prompt is actually assigned to that scene.

DO NOT CHANGE:
- The number of scenes
- Object definitions, background definitions, voiceover_list, grid dimensions

Return ONLY the corrected scene_prompts, scene_bg_indices, and scene_object_indices.
`;
```

### Grid Prefix

Reuse existing `REF_OBJECTS_GRID_PREFIX` and `REF_BACKGROUNDS_GRID_PREFIX` — no changes needed. SkyReels reference images should look the same as Kling/WAN reference images.

---

## 3. Grid Generation

**No changes to grid generation.** SkyReels reuses the ref-to-video dual-grid flow:

1. `start-ref-workflow` creates TWO `grid_images` records (type = `'objects'`, type = `'backgrounds'`)
2. Both grids are generated via fal.ai `workflows/octupost/generategridimage` (same as Kling/WAN)
3. User reviews both grids → approves
4. `approve-ref-split` splits both grids into individual images
5. Split images become `scene_objects.image_url` and `scene_backgrounds.image_url`

These cropped reference images are what SkyReels receives as `ref_images`.

**Image preparation:** SkyReels `ref_images` expects URLs. The split images from the grid are already stored as URLs in `scene_objects.image_url` (via `final_url` after outpainting for backgrounds). These can be passed directly to the SkyReels API.

---

## 4. Video Generation — Polling Pattern

This is the biggest change. All existing video models use fal.ai webhooks. SkyReels uses a **direct REST API with polling**.

### New Edge Function: `generate-video-skyreels`

**File:** `supabase/functions/generate-video-skyreels/index.ts`

This function:
1. Receives scene data (prompt, ref_images, duration, aspect_ratio)
2. Submits a job to SkyReels API
3. Polls for completion
4. Updates the scene record directly (no webhook needed)

```typescript
// supabase/functions/generate-video-skyreels/index.ts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SKYREELS_API_KEY = Deno.env.get('SKYREELS_API_KEY')!;
const SKYREELS_SUBMIT_URL = 'https://apis.skyreels.ai/api/v1/video/multiobject/submit';
const SKYREELS_POLL_URL = 'https://apis.skyreels.ai/api/v1/video/multiobject/task';

const POLL_INTERVAL_MS = 10_000;   // 10 seconds between polls
const MAX_POLL_ATTEMPTS = 120;     // 120 * 10s = 20 minutes max
const INITIAL_DELAY_MS = 30_000;   // Wait 30s before first poll

interface SkyReelsSubmitResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
  };
}

interface SkyReelsPollResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    status: 'submitted' | 'pending' | 'running' | 'success' | 'failed';
    video_url?: string;
    error?: string;
  };
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const {
    scene_id,
    prompt,
    ref_images,      // string[] — 1-4 URLs (background + objects)
    duration,        // number — 1-5
    aspect_ratio,    // string — "16:9", "9:16", etc.
  } = await req.json();

  // 1. Mark scene as generating
  await supabase
    .from('scenes')
    .update({ video_status: 'generating' })
    .eq('id', scene_id);

  try {
    // 2. Submit to SkyReels
    const submitRes = await fetch(SKYREELS_SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: SKYREELS_API_KEY,
        prompt,
        ref_images,
        duration: Math.min(5, Math.max(1, duration)),
        aspect_ratio: aspect_ratio || '16:9',
      }),
    });

    if (!submitRes.ok) {
      throw new Error(`SkyReels submit failed: ${submitRes.status} ${await submitRes.text()}`);
    }

    const submitData: SkyReelsSubmitResponse = await submitRes.json();
    const taskId = submitData.data.task_id;

    // 3. Store task_id for debugging
    await supabase.from('debug_logs').insert({
      step: 'SkyReelsSubmit',
      payload: { scene_id, task_id: taskId, prompt, ref_images_count: ref_images.length },
    });

    // 4. Wait before first poll
    await sleep(INITIAL_DELAY_MS);

    // 5. Poll for completion
    let videoUrl: string | null = null;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const pollRes = await fetch(`${SKYREELS_POLL_URL}/${taskId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!pollRes.ok) {
        console.warn(`SkyReels poll failed (attempt ${attempt}): ${pollRes.status}`);
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const pollData: SkyReelsPollResponse = await pollRes.json();
      const status = pollData.data.status;

      if (status === 'success') {
        videoUrl = pollData.data.video_url!;
        break;
      }

      if (status === 'failed') {
        throw new Error(`SkyReels generation failed: ${pollData.data.error || 'unknown error'}`);
      }

      // submitted, pending, running — keep polling
      await sleep(POLL_INTERVAL_MS);
    }

    if (!videoUrl) {
      throw new Error('SkyReels generation timed out after 20 minutes');
    }

    // 6. Update scene with result
    await supabase
      .from('scenes')
      .update({
        video_status: 'success',
        video_url: videoUrl,
      })
      .eq('id', scene_id);

    // 7. Log success
    await supabase.from('debug_logs').insert({
      step: 'SkyReelsComplete',
      payload: { scene_id, task_id: taskId, video_url: videoUrl },
    });

    return new Response(JSON.stringify({ success: true, video_url: videoUrl }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    await supabase
      .from('scenes')
      .update({
        video_status: 'failed',
        video_error_message: errorMsg,
      })
      .eq('id', scene_id);

    await supabase.from('debug_logs').insert({
      step: 'SkyReelsError',
      payload: { scene_id, error: errorMsg },
    });

    return new Response(JSON.stringify({ success: false, error: errorMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### Why a Separate Edge Function?

The existing `generate-video` function is tightly coupled to fal.ai's webhook pattern:
1. It builds a fal.ai payload via `MODEL_CONFIG[model].buildPayload()`
2. It attaches a `fal_webhook` URL
3. It returns immediately — the webhook handler updates the scene later

SkyReels breaks this pattern because:
- No fal.ai — direct REST API
- No webhooks — must poll
- The function must **stay alive** until completion (long-running)

Supabase Edge Functions have a **~150s timeout** on the default plan, which may not be enough for SkyReels (which could take minutes). Options:
1. **Background function** (Supabase Pro): Up to 400s (6.6 min) timeout
2. **External worker**: Move polling to a separate service
3. **Fire-and-forget + cron**: Submit job, store task_id, use a cron edge function to poll

**Recommended approach for MVP: Use the edge function with a generous timeout.** If SkyReels typically completes within 2-3 minutes, the 150s default may be tight but workable. On Supabase Pro, 400s should be sufficient. If needed, fall back to approach 3 (cron-based polling) as a follow-up.

### Alternative: Cron-Based Polling (if timeout is an issue)

If edge function timeouts are a problem, we can split into two parts:

**Part 1: `generate-video-skyreels` (submit only)**
- Submits job to SkyReels
- Stores `task_id` in a new `skyreels_tasks` table
- Returns immediately

**Part 2: `poll-skyreels` (cron edge function)**
- Runs every 15 seconds via `pg_cron`
- Queries `skyreels_tasks` for pending tasks
- Polls SkyReels API for each
- Updates scene records on completion

This is more complex but eliminates timeout concerns. **Defer to Phase 2 if needed.**

---

## 5. Duration Handling

SkyReels max duration is **5 seconds**. This affects voiceover splitting.

### Voiceover Splitting Strategy

The system prompt already instructs the LLM to target 3-5 seconds per segment. With a 5s max video:
- Short voiceover segments (< 5s speech) → video plays at normal speed
- Medium segments (5-10s speech) → video plays slower via `playbackRate` adjustment (existing `addSceneToTimeline` logic handles this)

The existing timeline assembly in `scene-timeline-utils.ts` already handles voiceover-to-video duration mismatches:
- If voiceover > video duration: video plays slower (playbackRate < 1.0)
- If voiceover < video duration: video speeds up (capped at MAX_SPEED = 2.0)

**No changes needed to timeline assembly.** The 5s video + variable voiceover duration will be handled by the existing playbackRate adjustment.

### MODEL_CONFIG Duration Bucket

```typescript
'skyreels': {
  // ...
  bucketDuration: (raw: number) => Math.max(1, Math.min(5, raw)),
}
```

Always clamps to 1-5 seconds. Since all SkyReels scenes are max 5s, the `bucketDuration` function simply clamps.

---

## 6. Edge Function Changes

### 6.1 `generate-video/index.ts` — Add SkyReels to MODEL_CONFIG

Add SkyReels model config (even though it won't use fal.ai, having it in MODEL_CONFIG lets the mode detection work):

```typescript
// In MODEL_CONFIG:
'skyreels': {
  endpoint: null,  // Not a fal.ai model
  mode: 'ref_to_video',
  validResolutions: ['720p', '1080p'],
  bucketDuration: (raw: number) => Math.max(1, Math.min(5, raw)),
  buildPayload: null,  // Not used — separate edge function handles this
},
```

In the main handler, add an early exit for SkyReels — it shouldn't go through the fal.ai flow:

```typescript
// After getting model config and video context:
if (model === 'skyreels') {
  // SkyReels is handled by generate-video-skyreels edge function
  // This should not be called for skyreels — log warning and return
  console.warn('generate-video called for skyreels model — this should use generate-video-skyreels');
  return new Response(JSON.stringify({ error: 'Wrong endpoint for skyreels' }), { status: 400 });
}
```

### 6.2 `webhook/index.ts` — Modify `tryCompleteSplitting()`

The `tryCompleteSplitting` function triggers `generate-video` for each scene when all splits are ready. For SkyReels, it needs to call `generate-video-skyreels` instead.

```typescript
// In tryCompleteSplitting(), after claiming the atomic gate:

// Fetch storyboard to check model
const { data: storyboard } = await supabase
  .from('storyboards')
  .select('model')
  .eq('id', storyboard_id)
  .single();

const isSkyReels = storyboard?.model === 'skyreels';

// For each scene, trigger the appropriate video generation
for (const scene of scenes) {
  const edgeFn = isSkyReels ? 'generate-video-skyreels' : 'generate-video';

  if (isSkyReels) {
    // Build SkyReels-specific payload
    // Fetch scene objects and background
    const { data: objects } = await supabase
      .from('objects')
      .select('final_url')
      .eq('scene_id', scene.id)
      .order('scene_order');

    const { data: background } = await supabase
      .from('backgrounds')
      .select('final_url')
      .eq('scene_id', scene.id)
      .single();

    // Build ref_images: [background, ...objects]
    const ref_images = [
      background.final_url,
      ...objects.map((o: any) => o.final_url),
    ].filter(Boolean);

    // Strip @Element references from prompt
    let prompt = scene.prompt || '';
    prompt = prompt.replace(/@Element\d+/g, '').replace(/\s+/g, ' ').trim();

    await invokeEdgeFunction(supabase, edgeFn, {
      scene_id: scene.id,
      prompt,
      ref_images,
      duration: 5,  // always 5s for SkyReels
      aspect_ratio: storyboard.aspect_ratio,
    });
  } else {
    // Existing fal.ai flow
    await invokeEdgeFunction(supabase, edgeFn, {
      scene_id: scene.id,
      storyboard_id,
      model: storyboard.model,
    });
  }
}
```

### 6.3 `approve-ref-split/index.ts` — No Changes

SkyReels scenes use the same `scenes`, `objects`, `backgrounds`, and `voiceovers` records as Kling/WAN. The `approve-ref-split` function doesn't care about the video model — it just creates the records and triggers the grid split. No changes needed.

### 6.4 `start-ref-workflow/index.ts` — No Changes

Grid generation is model-agnostic. SkyReels uses the same dual-grid pattern. No changes.

### 6.5 New Edge Function: `generate-video-skyreels/index.ts`

See full implementation in [Section 4](#4-video-generation--polling-pattern).

---

## 7. DB Changes

### No new tables needed.

SkyReels fits entirely within the existing ref-to-video schema:
- `storyboards.model = 'skyreels'`
- `storyboards.mode = 'ref_to_video'`
- `grid_images` (type = 'objects' | 'backgrounds') — same as Kling/WAN
- `scenes` (prompt, video_status, video_url) — same
- `objects` (scene_id, image_url, final_url) — same
- `backgrounds` (scene_id, image_url, final_url) — same
- `voiceovers` — same

### New columns: None.

### New status values: None.

The `video_status` values (`pending`, `generating`, `success`, `failed`) already cover SkyReels needs.

### Optional: `skyreels_tasks` table (only if cron polling is needed)

If we need the cron-based approach (see Section 4 alternative):

```sql
CREATE TABLE skyreels_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid REFERENCES scenes(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**Defer this unless edge function timeouts prove problematic.**

---

## 8. UI Changes

### 8.1 Model Selector

**File:** The UI component that renders the video model dropdown (likely in the storyboard creation form).

Add `skyreels` to the list of available video models:

```typescript
// In the video model selector:
const VIDEO_MODELS = [
  { value: 'klingo3', label: 'Kling O3' },
  { value: 'klingo3pro', label: 'Kling O3 Pro' },
  { value: 'wan26flash', label: 'WAN 2.6 Flash' },
  { value: 'skyreels', label: 'SkyReels' },
];
```

### 8.2 Type Updates

**File:** `editor/src/lib/supabase/workflow-service.ts`

```typescript
export type VideoModel = 'klingo3' | 'klingo3pro' | 'wan26flash' | 'skyreels';
```

### 8.3 Workflow Hook — No Changes

The `useWorkflow` hook is model-agnostic. It tracks `plan_status` transitions and subscribes to `scenes`, `objects`, `backgrounds`, and `voiceovers` updates. SkyReels scenes update `video_status` and `video_url` in the same `scenes` table — the existing realtime subscription handles it automatically.

### 8.4 Grid Review — No Changes

SkyReels uses the same dual-grid review UX as Kling/WAN. The user sees objects grid + backgrounds grid, can approve or regenerate. No UI changes needed.

### 8.5 Timeline Assembly — No Changes

`addSceneToTimeline()` is model-agnostic. It reads `video_url` and `audio_url` from scenes/voiceovers. Works as-is.

---

## 9. File-by-File Change List

### New Files

| File | Description |
|------|-------------|
| `editor/src/lib/schemas/skyreels-plan.ts` | Schema, system prompt, reviewer prompt, grid prefix reuse |
| `supabase/functions/generate-video-skyreels/index.ts` | SkyReels API submission + polling edge function |

### Modified Files

| File | Changes |
|------|---------|
| `editor/src/app/api/storyboard/route.ts` | Add `skyreels` to valid video models; add SkyReels branch in `generateRefToVideoPlan()` using `skyreelsContentSchema`, `SKYREELS_SYSTEM_PROMPT`, `skyreelsReviewerOutputSchema`, `SKYREELS_REVIEWER_SYSTEM_PROMPT` |
| `editor/src/app/api/storyboard/approve/route.ts` | No changes — already routes ref_to_video to `start-ref-workflow` |
| `editor/src/app/api/storyboard/approve-ref-grid/route.ts` | Add `skyreelsPlanSchema` to validation branch (alongside `klingO3PlanSchema` and `wan26FlashPlanSchema`) |
| `supabase/functions/generate-video/index.ts` | Add `skyreels` to `MODEL_CONFIG` (with null endpoint/buildPayload); add early-exit guard |
| `supabase/functions/webhook/index.ts` | Modify `tryCompleteSplitting()` to dispatch to `generate-video-skyreels` for SkyReels model |
| `editor/src/lib/supabase/workflow-service.ts` | Add `'skyreels'` to `VideoModel` type |
| UI model selector component | Add `skyreels` option to video model dropdown |

### Unchanged Files

| File | Reason |
|------|--------|
| `supabase/functions/start-ref-workflow/index.ts` | Grid generation is model-agnostic |
| `supabase/functions/approve-ref-split/index.ts` | Scene/object/background creation is model-agnostic |
| `supabase/functions/start-workflow/index.ts` | I2V only — SkyReels doesn't use this |
| `supabase/functions/approve-grid-split/index.ts` | I2V only |
| `supabase/functions/generate-tts/index.ts` | TTS is model-agnostic |
| `editor/src/hooks/use-workflow.ts` | Model-agnostic state machine |
| `editor/src/lib/scene-timeline-utils.ts` | Model-agnostic timeline assembly |
| `editor/src/lib/schemas/i2v-plan.ts` | I2V only |
| `editor/src/lib/schemas/kling-o3-plan.ts` | Kling only |
| `editor/src/lib/schemas/wan26-flash-plan.ts` | WAN only |

---

## 10. Edge Cases & Failure Modes

### 10.1 SkyReels API Timeout

**Scenario:** SkyReels takes longer than the edge function timeout (150s default, 400s Pro).

**Mitigation:**
- Set `INITIAL_DELAY_MS = 30_000` to avoid wasting polls
- If timeout occurs, scene is marked `video_status: 'failed'` with error message
- User can retry via existing UI retry mechanism
- **Phase 2 fallback:** Implement cron-based polling (see Section 4 alternative)

### 10.2 SkyReels API Down

**Scenario:** Submit request fails (HTTP 5xx).

**Mitigation:**
- Catch error, mark scene as `failed`, log to `debug_logs`
- User can retry

### 10.3 SkyReels Rate Limiting

**Scenario:** Too many concurrent submissions.

**Mitigation:**
- Scenes are submitted in parallel by `tryCompleteSplitting` — could hit rate limits for large storyboards (20+ scenes)
- Consider adding a small delay between scene submissions for SkyReels (e.g., stagger by 500ms)
- Log rate limit errors for monitoring

### 10.4 Prompt Too Long (>512 tokens)

**Scenario:** LLM generates a scene prompt exceeding SkyReels' 512-token limit.

**Mitigation:**
- System prompt instructs LLM to keep prompts under 512 tokens
- In `generate-video-skyreels`, truncate prompt to ~500 tokens as a safety net
- Reviewer pass can also catch and shorten overly long prompts

### 10.5 Too Many Reference Images

**Scenario:** `scene_object_indices[i]` has 4 objects (+ 1 background = 5 images), exceeding SkyReels' 4-image limit.

**Mitigation:**
- Schema enforces `.max(3)` on `scene_object_indices` arrays (3 objects + 1 background = 4 max)
- System prompt instructs "UP TO 3 tracked elements + 1 background = 4 max"
- Validation in `generateRefToVideoPlan()` checks bounds
- Safety net in `generate-video-skyreels`: if `ref_images.length > 4`, take first 4

### 10.6 Invalid Image URLs

**Scenario:** Object/background split images haven't finished processing when SkyReels is triggered.

**Mitigation:**
- `tryCompleteSplitting()` only fires after ALL objects and backgrounds are `status: 'success'`
- `generate-video-skyreels` filters out null/undefined URLs from `ref_images`
- If `ref_images` is empty after filtering, mark scene as `failed`

### 10.7 SkyReels Generates 1s Video for 5s Voiceover

**Scenario:** SkyReels generates a very short video relative to voiceover.

**Mitigation:**
- Existing `addSceneToTimeline()` handles this — video plays slower (playbackRate < 1.0)
- At extreme ratios (e.g., 1s video for 10s voiceover), playbackRate = 0.1 which looks like a slideshow
- Consider a minimum playbackRate threshold (e.g., 0.25) with video looping as a Phase 2 improvement

### 10.8 Aspect Ratio Mismatch

**Scenario:** User selects 9:16 but SkyReels only supports 16:9, 9:16, 3:4, 4:3, 1:1.

**Mitigation:**
- Existing aspect ratios (16:9, 9:16, 1:1) are all supported by SkyReels
- The `ASPECT_RATIOS` map in the API routes already constrains to these three
- No additional validation needed

---

## Summary

**Total new files: 2** (schema + edge function)
**Total modified files: ~5** (route, approve-ref-grid, generate-video, webhook, workflow-service + UI selector)
**Total unchanged files: 10+** (everything else in the pipeline)

The key insight is that SkyReels is structurally a ref-to-video model (multiple reference images + prompt), so it fits naturally into the existing ref-to-video pipeline. The only significant new code is the polling-based edge function (`generate-video-skyreels`), since SkyReels doesn't support fal.ai webhooks.
