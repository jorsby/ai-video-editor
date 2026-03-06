# SkyReels Integration — Plan B (Clean Architecture)

> Agent B's detailed implementation plan. Bias: correctness over convenience.

---

## Table of Contents

1. [Architecture Decision](#1-architecture-decision)
2. [The Core Problem](#2-the-core-problem)
3. [LLM Plan](#3-llm-plan)
4. [Polling Architecture](#4-polling-architecture)
5. [Duration Strategy](#5-duration-strategy)
6. [Prompt Constraints](#6-prompt-constraints)
7. [Reference Image Strategy](#7-reference-image-strategy)
8. [DB Changes](#8-db-changes)
9. [UI Changes](#9-ui-changes)
10. [File-by-File Change List](#10-file-by-file-change-list)

---

## 1. Architecture Decision

**SkyReels belongs in the ref-to-video pipeline.** Not I2V. Not a hybrid.

### First-Principles Analysis

The two existing pipelines have fundamentally different data models:

| Property | I2V | Ref-to-Video |
|----------|-----|-------------|
| Input images | ONE first_frame per scene | Multiple refs: objects + background per scene |
| Image generation | Single grid → split → one image per cell | TWO grids (objects + backgrounds) → split → multiple images per scene |
| Scene data model | `first_frames` table (1:1 with scenes) | `objects` + `backgrounds` tables (N:1 with scenes) |
| Prompt style | `visual_flow` — "animate this frame" | `scene_prompts` — "compose these refs into a scene" |
| LLM output | Grid prompt + visual_flow array | Objects + backgrounds + scene_prompts + index mappings |

SkyReels' API signature is:

```
POST /api/v1/video/multiobject/submit
  ref_images: [string, 1-4]    ← multiple reference images
  prompt: string                ← scene description
  duration: 1-5
  aspect_ratio: 16:9 | 9:16 | etc.
```

The `ref_images` parameter takes 1-4 images where "one should be environment/background." This is **exactly** the ref-to-video pattern: separate objects and backgrounds composed into a scene via prompt.

### Why NOT I2V

If we force SkyReels into I2V:
- I2V gives us ONE `first_frame` per scene. SkyReels needs 1-4 reference images.
- We'd have to hack `first_frames` to somehow store multiple images, breaking the 1:1 relationship.
- The LLM prompt would need to generate both a visual grid AND object/background assignments — but I2V's schema (`i2vContentSchema`) has no concept of objects, backgrounds, or index mappings.
- Every future ref-to-video model would face the same problem, creating parallel workarounds.

**Forcing SkyReels into I2V would be architecturally wrong.** It would mean hacking a fundamentally different data model to fit a pipeline it doesn't match. The correct place is ref-to-video.

### Why Ref-to-Video (and specifically the WAN pattern)

SkyReels maps almost 1:1 to WAN 2.6 Flash:

| Feature | WAN 2.6 Flash | SkyReels |
|---------|--------------|----------|
| Image input | Flat `image_urls[]` array | Flat `ref_images[]` array |
| Background position | First in array (`@Element1`) | "One should be environment/background" |
| Objects | Following positions (`@Element2+`) | Remaining images |
| Max images/scene | 5 (1 bg + 4 objects) | 4 (1 bg + 3 objects) |
| Prompt type | Single string | Single string |
| Multi-shot | `scene_multi_shots: boolean[]` | Not supported |
| Duration | 5 or 10s | 1-5s |

Key differences from WAN:
1. **Max 4 ref_images** (not 5) → max 3 objects per scene instead of 4
2. **Max 5s duration** → more scenes needed
3. **No multi-shot** → simpler prompt structure
4. **No fal.ai** → direct API, polling instead of webhooks
5. **512 token prompt limit** → shorter prompts
6. **No @Element syntax** → plain descriptive prompts

### Future Extensibility

Adding SkyReels as a ref-to-video model follows the existing pattern: Kling, WAN, and now SkyReels each have their own schema, system prompt, and model config. The next ref-to-video model (say, Runway Gen-4 Multi-Reference) would follow the same pattern. The ref-to-video pipeline is already designed for model polymorphism.

---

## 2. The Core Problem

### Image Mapping

SkyReels takes `ref_images: string[]` with 1-4 URLs. The ref-to-video pipeline already provides:
- Per-scene object images (`objects` table, `final_url`)
- Per-scene background image (`backgrounds` table, `final_url`)

The mapping is straightforward:

```typescript
ref_images = [background_url, ...object_urls]  // background first, then objects
```

This mirrors exactly how WAN 2.6 Flash builds its `image_urls` array (line 519 of `generate-video/index.ts`):
```typescript
image_urls: [context.background_url, ...context.object_urls],
```

### Constraint: Max 4 ref_images (3 objects)

SkyReels allows max 4 images total. With 1 background, that leaves max 3 objects per scene. The existing pipeline allows max 4 objects per scene. We need to:

1. Enforce `scene_object_indices[i].max(3)` in the SkyReels schema (not 4)
2. Tell the LLM about this constraint in the system prompt
3. Validate in `getRefVideoContext()` that object_count + 1 <= 4

---

## 3. LLM Plan

### SkyReels Needs Its Own Schema and System Prompt

It cannot reuse Kling or WAN prompts because:

1. **No @Element syntax.** SkyReels has no concept of `@Element1`, `@Element2`, `@Image1`. Its prompt is plain text describing what should happen.
2. **Max 3 objects per scene** (not 4). The schema must enforce `.max(3)` on `scene_object_indices[i]`.
3. **No multi-shot.** No `scene_multi_shots` array, no `multi_prompt` support.
4. **512 token prompt limit.** System prompt must instruct the LLM to write concise scene descriptions.
5. **5s max duration.** LLM must target ~3-5 seconds of voiceover per segment, producing more scenes.

### New Schema File: `editor/src/lib/schemas/skyreels-plan.ts`

```typescript
import { z } from 'zod';

const skyreelsElementSchema = z.object({
  name: z.string(),
  description: z.string(),
});

// Content schema (LLM output — pre-translation)
export const skyreelsContentSchema = z.object({
  objects_rows: z.number().int().min(2).max(6),
  objects_cols: z.number().int().min(2).max(6),
  objects_grid_prompt: z.string(),
  objects: z.array(skyreelsElementSchema).min(1).max(36),

  bg_rows: z.number().int().min(2).max(6),
  bg_cols: z.number().int().min(2).max(6),
  backgrounds_grid_prompt: z.string(),
  background_names: z.array(z.string()).min(1).max(36),

  scene_prompts: z.array(z.string()),          // plain text, no @Element syntax
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(
    z.array(z.number().int().min(0)).max(3)     // MAX 3 objects (not 4)
  ),

  voiceover_list: z.array(z.string()),
});

// Plan schema (stored in DB — post-translation)
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

export type SkyReelsPlan = z.infer<typeof skyreelsPlanSchema>;

// Reviewer output — simpler than WAN (no multi_shots)
export const skyreelsReviewerOutputSchema = z.object({
  scene_prompts: z.array(z.string()),
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(
    z.array(z.number().int().min(0)).max(3)
  ),
});
```

### System Prompt

Key differences from WAN:

1. **No @Element references.** Prompts describe characters by name: "Ahmed walks through the park" not "@Element2 walks through @Element1"
2. **Shorter prompts.** Max ~100 words per scene prompt to stay under 512 tokens after any overhead.
3. **3-5 second voiceover segments.** More scenes, shorter clips.
4. **Max 3 objects per scene.** Explicitly stated.

```typescript
export const SKYREELS_SYSTEM_PROMPT = `You are a storyboard planner for AI video generation using SkyReels (multi-object reference-to-video).

RULES:
1. Voiceover Splitting and Grid Planning
- Target 3-5 seconds of speech per voiceover segment (video max is 5 seconds).
- This means MORE segments than other models. A 60-second voiceover needs ~12-20 segments.
- Adjust your splitting strategy so the total segment count matches one of the valid grid sizes below.

2. Elements (Characters/Objects)
- Each scene can use UP TO 3 tracked elements (characters/objects) + 1 background = 4 max.
- Elements are reusable across scenes. Design distinct, recognizable characters/objects.
- For each element, provide:
  - "name": short label (e.g. "Ahmed", "Cat")
  - "description": detailed visual description for AI tracking
- Descriptions must be specific enough that the AI can consistently track the element across frames.
- All elements must be front-facing. Do NOT use multi-view or turnaround poses.
- Valid grid sizes for objects grid: 2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36).

3. Backgrounds
- Maximize background reuse: prefer fewer unique backgrounds used in many scenes.
- Backgrounds are empty environments with no people — only the setting.
- Valid grid sizes for backgrounds grid: 2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36).

4. Scene Prompts — CRITICAL DIFFERENCES
- SkyReels does NOT use @Element or @Image references.
- Instead, describe each scene using CHARACTER NAMES and LOCATION DESCRIPTIONS directly.
- Reference characters by their name: "Ahmed walks through the park" not "@Element2 walks through @Element1".
- Reference backgrounds by description: "In the dimly lit living room" not "@Element1".
- KEEP PROMPTS CONCISE: max ~80 words per scene prompt. SkyReels has a strict 512-token limit.
- Write vivid but brief cinematic descriptions. Every word counts.

5. Visual & Content Rules
DO:
- The prompts will be English but the texts and style on the image will depend on the language of the voiceover.
- Use modern islamic clothing styles if people are shown. For girls use modest clothing with NO Hijab. Modern muslim fashion styles like Turkey without religious symbols.
- If the voiceover mentions real people, brands, landmarks, or locations, use their actual names and recognizable features.
DO NOT:
- Do not add any extra text like a message or overlay text.
- Do not add any violence.

OUTPUT FORMAT:
Return valid JSON matching this structure:
{
  "objects_rows": 2, "objects_cols": 2,
  "objects_grid_prompt": "With 2 A 2x2 Grids. Grid_1x1: A young boy named Ahmed on neutral white background, front-facing. Grid_1x2: ...",
  "objects": [
    { "name": "Ahmed", "description": "A young boy with brown hair, blue jacket, red backpack, age 10" },
    ...
  ],
  "bg_rows": 2, "bg_cols": 2,
  "backgrounds_grid_prompt": "With 2 A 2x2 Grids. Grid_1x1: City street at dusk with warm streetlights. Grid_1x2: ...",
  "background_names": ["City street at dusk", "School courtyard", ...],
  "scene_prompts": [
    "Ahmed walks down the city street at dusk, warm amber light casting long shadows, Cat trots beside him",
    ...
  ],
  "scene_bg_indices": [0, 1, 2, 0],
  "scene_object_indices": [[0, 1], [0], [1], [0, 1]],
  "voiceover_list": ["segment 1 text", "segment 2 text", ...]
}`;
```

### Reviewer System Prompt

```typescript
export const SKYREELS_REVIEWER_SYSTEM_PROMPT = `You are a storyboard reviewer for SkyReels multi-object reference-to-video generation.

YOUR TASKS:

1. Improve prompt quality
   - Replace generic prompts with vivid, cinematic shot descriptions.
   - Reference characters by NAME, not by index or @Element syntax.
   - Reference backgrounds by description, not by index.
   - Keep each prompt under ~80 words. SkyReels has a 512-token limit.

2. Verify scene assignments
   - Check if object/background assignments make narrative sense.
   - Reassign scene_bg_indices or scene_object_indices if needed.
   - Ensure every scene has at least one object assigned.
   - Max 3 objects per scene (SkyReels limit is 4 ref_images total including background).

3. Check prompt-assignment consistency
   - Characters mentioned in scene_prompts[i] must match the objects in scene_object_indices[i].
   - If a prompt references "Ahmed" but Ahmed's object index isn't in scene_object_indices[i], fix it.

DO NOT CHANGE:
- The number of scenes (array lengths must stay the same)
- Object definitions, background definitions, voiceover_list, grid dimensions

Return ONLY the corrected scene_prompts, scene_bg_indices, and scene_object_indices.`;
```

### Integration into `route.ts`

Add SkyReels as a third branch in `generateRefToVideoPlan()`:

```typescript
// In editor/src/app/api/storyboard/route.ts

const VALID_VIDEO_MODELS = ['klingo3', 'klingo3pro', 'wan26flash', 'skyreels'] as const;

async function generateRefToVideoPlan(...) {
  const isKling = videoModel === 'klingo3' || videoModel === 'klingo3pro';
  const isSkyReels = videoModel === 'skyreels';

  const systemPrompt = isKling
    ? KLING_O3_SYSTEM_PROMPT
    : isSkyReels
      ? SKYREELS_SYSTEM_PROMPT
      : WAN26_FLASH_SYSTEM_PROMPT;

  const contentSchemaForModel = isKling
    ? klingO3ContentSchema
    : isSkyReels
      ? skyreelsContentSchema
      : wan26FlashContentSchema;

  // ... content generation (same flow) ...

  // Reviewer
  const reviewerSystemPrompt = isKling
    ? KLING_O3_REVIEWER_SYSTEM_PROMPT
    : isSkyReels
      ? SKYREELS_REVIEWER_SYSTEM_PROMPT
      : WAN26_FLASH_REVIEWER_SYSTEM_PROMPT;

  const reviewerSchema = isKling
    ? klingO3ReviewerOutputSchema
    : isSkyReels
      ? skyreelsReviewerOutputSchema
      : wan26FlashReviewerOutputSchema;

  // ... validation ...

  // SkyReels-specific validation: max 3 objects per scene
  if (isSkyReels) {
    for (let i = 0; i < sceneCount; i++) {
      if (content.scene_object_indices[i].length > 3) {
        throw new Error(
          `Scene ${i} has ${content.scene_object_indices[i].length} objects but SkyReels max is 3`
        );
      }
    }
  }

  // Final plan assembly for SkyReels
  if (isSkyReels) {
    const srContent = content as z.infer<typeof skyreelsContentSchema>;
    return {
      objects_rows: srContent.objects_rows,
      objects_cols: srContent.objects_cols,
      objects_grid_prompt: `${REF_OBJECTS_GRID_PREFIX} ${srContent.objects_grid_prompt}`,
      objects: srContent.objects,
      bg_rows: srContent.bg_rows,
      bg_cols: srContent.bg_cols,
      backgrounds_grid_prompt: `${REF_BACKGROUNDS_GRID_PREFIX} ${srContent.backgrounds_grid_prompt}`,
      background_names: srContent.background_names,
      scene_prompts: srContent.scene_prompts,
      scene_bg_indices: srContent.scene_bg_indices,
      scene_object_indices: srContent.scene_object_indices,
      voiceover_list,
    };
  }
}
```

### PATCH validation

In the `PATCH` handler, add SkyReels schema validation:

```typescript
const schema =
  storyboard.model === 'klingo3' || storyboard.model === 'klingo3pro'
    ? klingO3PlanSchema
    : storyboard.model === 'skyreels'
      ? skyreelsPlanSchema
      : wan26FlashPlanSchema;
```

---

## 4. Polling Architecture

### The Problem

The entire video generation pipeline is webhook-based:
1. `generate-video` sends a fal.ai request with `fal_webhook` parameter
2. fal.ai calls back to `webhook?step=GenerateVideo` on completion
3. The webhook handler updates the scene's `video_url` and `video_status`

SkyReels has **no webhooks**. We must poll.

### Design: Hybrid Submit + Poll

**Why not just poll inside `generate-video`?**

Supabase edge functions have wall-clock limits (up to 400s on pro). A single SkyReels task could take 60-180s. Processing 16 scenes sequentially with polling would take too long and risk timeout. More importantly, the current `generate-video` function processes scenes in a sequential loop with 1s delays — adding polling within that loop would be architecturally messy.

**The clean approach: separate submission from completion tracking.**

### Step 1: Submit via `generate-video` (modified)

Add SkyReels to `MODEL_CONFIG` in `generate-video/index.ts` as a new model entry. Unlike fal.ai models, SkyReels submission goes to the SkyReels API directly (not fal.ai). The submission returns a `task_id` which we store.

```typescript
// In generate-video/index.ts MODEL_CONFIG:
skyreels: {
  endpoint: 'skyreels-direct',  // marker — not a fal.ai endpoint
  mode: 'ref_to_video',
  validResolutions: ['720p'],   // SkyReels doesn't use resolution, but keep for interface
  bucketDuration: (raw) => Math.max(1, Math.min(5, raw)),  // 1-5s
  buildPayload: ({ prompt, image_urls, duration, aspect_ratio }) => ({
    prompt,
    ref_images: image_urls || [],
    duration: Math.max(1, Math.min(5, duration)),
    aspect_ratio: aspect_ratio ?? '16:9',
  }),
},
```

For SkyReels, replace `sendRefVideoRequest()` with a new `sendSkyReelsRequest()`:

```typescript
const SKYREELS_API_KEY = Deno.env.get('SKYREELS_API_KEY');
const SKYREELS_SUBMIT_URL = 'https://apis.skyreels.ai/api/v1/video/multiobject/submit';

async function sendSkyReelsRequest(
  context: RefVideoContext,
  aspect_ratio: string | undefined,
  log: ReturnType<typeof createLogger>
): Promise<{ taskId: string | null; error: string | null }> {
  const payload = {
    api_key: SKYREELS_API_KEY,
    prompt: context.prompt,
    ref_images: [context.background_url, ...context.object_urls],
    duration: Math.max(1, Math.min(5, context.duration)),
    aspect_ratio: aspect_ratio ?? '16:9',
  };

  // Validate ref_images count
  if (payload.ref_images.length > 4) {
    log.error('SkyReels max 4 ref_images exceeded', {
      count: payload.ref_images.length,
    });
    return { taskId: null, error: 'Max 4 ref_images for SkyReels' };
  }

  // Validate prompt length (rough token estimate: ~4 chars per token)
  if (context.prompt.length > 2048) {
    log.warn('SkyReels prompt may exceed 512 token limit', {
      char_count: context.prompt.length,
    });
  }

  try {
    const response = await fetch(SKYREELS_SUBMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { taskId: null, error: `SkyReels submit failed: ${response.status} ${errorText}` };
    }

    const result = await response.json();
    return { taskId: result.task_id, error: null };
  } catch (err) {
    return { taskId: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
```

After submission, store the task_id:

```typescript
// In the main handler loop, SkyReels branch:
if (model === 'skyreels') {
  const { taskId, error } = await sendSkyReelsRequest(refContext, aspect_ratio, log);
  if (error || !taskId) {
    await supabase.from('scenes').update({
      video_status: 'failed',
      video_error_message: error || 'SkyReels submit failed',
    }).eq('id', refContext.scene_id);
    results.push({ scene_id: sceneId, request_id: null, status: 'failed', error });
    continue;
  }

  // Store task_id for polling
  await supabase.from('scenes').update({
    video_status: 'processing',
    video_request_id: taskId,
    video_provider: 'skyreels',
  }).eq('id', refContext.scene_id);

  results.push({ scene_id: sceneId, request_id: taskId, status: 'queued' });
}
```

### Step 2: Poll via `poll-skyreels` Edge Function

Create a new edge function `supabase/functions/poll-skyreels/index.ts`:

```typescript
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SKYREELS_API_KEY = Deno.env.get('SKYREELS_API_KEY')!;
const SKYREELS_TASK_URL = 'https://apis.skyreels.ai/api/v1/video/multiobject/task';

Deno.serve(async (req: Request) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Find all scenes waiting for SkyReels results
  const { data: pendingScenes, error } = await supabase
    .from('scenes')
    .select('id, video_request_id, storyboard_id')
    .eq('video_status', 'processing')
    .eq('video_provider', 'skyreels')
    .not('video_request_id', 'is', null);

  if (error || !pendingScenes || pendingScenes.length === 0) {
    return new Response(JSON.stringify({
      success: true,
      message: 'No pending SkyReels tasks',
      count: 0,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  const results = [];

  for (const scene of pendingScenes) {
    try {
      const response = await fetch(
        `${SKYREELS_TASK_URL}/${scene.video_request_id}?api_key=${SKYREELS_API_KEY}`
      );

      if (!response.ok) {
        results.push({ scene_id: scene.id, status: 'poll_error' });
        continue;
      }

      const task = await response.json();

      if (task.status === 'success') {
        await supabase.from('scenes').update({
          video_status: 'success',
          video_url: task.video_url,  // adjust based on actual API response shape
        }).eq('id', scene.id);

        results.push({ scene_id: scene.id, status: 'completed' });
      } else if (task.status === 'failed') {
        await supabase.from('scenes').update({
          video_status: 'failed',
          video_error_message: task.error || 'SkyReels task failed',
        }).eq('id', scene.id);

        results.push({ scene_id: scene.id, status: 'failed' });
      } else {
        // still running (submitted/pending/running)
        results.push({ scene_id: scene.id, status: task.status });
      }
    } catch (err) {
      results.push({
        scene_id: scene.id,
        status: 'exception',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Response(JSON.stringify({ success: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

### Step 3: Trigger Polling via pg_cron

Add a cron job in `supabase/config.toml` (or via SQL migration):

```toml
[functions.poll-skyreels]
verify_jwt = false

# In supabase/migrations/ — add a cron job:
# SELECT cron.schedule(
#   'poll-skyreels',
#   '*/15 * * * * *',  -- every 15 seconds
#   $$SELECT net.http_post(
#     url := current_setting('app.supabase_url') || '/functions/v1/poll-skyreels',
#     headers := jsonb_build_object(
#       'Authorization', 'Bearer ' || current_setting('app.service_role_key')
#     )
#   )$$
# );
```

**Why 15 seconds?** SkyReels tasks take 30-180s typically. 15s polling is responsive enough without being wasteful. The poller is idempotent — if there are no pending tasks, it returns immediately.

### Alternative: Client-Triggered Polling

Instead of cron, the client could trigger polling via a Next.js API route:

```
POST /api/storyboard/poll-skyreels
  body: { storyboardId }
```

The client's realtime subscription already watches for `video_status` changes. When it sees a scene stuck in `'processing'` for SkyReels, it could call this endpoint periodically. This avoids needing cron infrastructure but adds client-side polling logic.

**Recommendation: Use cron.** It's cleaner, server-side only, and the client just reacts to DB changes via existing realtime subscriptions — no new client polling code needed.

### Why This Design is Clean

1. **Submission path reuses existing `generate-video`** — same edge function, same input format, just a different internal dispatch.
2. **Polling is fully decoupled** — separate edge function, triggered by cron, updates the same DB columns the webhook handler would.
3. **Client doesn't know about polling** — it subscribes to `scenes` table changes via Supabase Realtime, same as today.
4. **No webhook hacks** — we don't fake webhooks or route SkyReels through the webhook handler.

---

## 5. Duration Strategy

### Problem

SkyReels max is 5 seconds. Current models:
- WAN 2.6 Flash: 5 or 10s
- Kling O3: 3-15s
- I2V models: 5-15s

A 60-second voiceover with 5s clips needs ~12-20 scenes. With 10s Kling clips, you'd need ~6-10 scenes.

### Cascade Effects

**LLM Plan Generation:**
- System prompt tells LLM to target 3-5 seconds of voiceover per segment
- This produces more segments → larger grid sizes
- A 60s voiceover → ~16 segments → 4x4 grid (the current system supports up to 6x6=36)

**Grid Sizing:**
- More scenes = larger grid = more cells
- The grid generation and splitting pipeline handles this already
- No changes needed — valid grid sizes go up to 6x6(36)

**Timeline Assembly:**
- More clips, each shorter
- `addSceneToTimeline()` already handles variable clip lengths
- No changes needed — clips are placed sequentially regardless of duration

**`bucketDuration` function:**
```typescript
bucketDuration: (raw) => Math.max(1, Math.min(5, raw)),
```
This clamps any raw duration to 1-5 seconds. If a voiceover segment is 3.7s, the video will be 4s (ceil then clamp).

### No Special Duration Logic Needed

The existing pipeline handles variable durations well. The only change is the `bucketDuration` function in `MODEL_CONFIG` and the LLM system prompt targeting shorter segments.

---

## 6. Prompt Constraints

### Problem

SkyReels has a 512-token limit on prompts. Current scene prompts can be long — Kling multi-shot prompts can easily exceed 200 words.

### Solution

1. **LLM System Prompt** instructs for ~80 words max per scene prompt.
2. **Reviewer** enforces conciseness.
3. **Runtime truncation** as a safety net in `generate-video`:

```typescript
function truncatePrompt(prompt: string, maxTokens: number = 480): string {
  // Conservative estimate: 1 token ≈ 4 characters
  const maxChars = maxTokens * 4;
  if (prompt.length <= maxChars) return prompt;
  // Truncate at last sentence boundary before limit
  const truncated = prompt.substring(0, maxChars);
  const lastPeriod = truncated.lastIndexOf('.');
  return lastPeriod > maxChars * 0.5
    ? truncated.substring(0, lastPeriod + 1)
    : truncated;
}
```

4. **No @Element resolution needed.** SkyReels prompts use character names directly, so there's no prompt expansion from reference resolution. This helps keep prompts shorter.

---

## 7. Reference Image Strategy

### Mapping: `ref_images` Array Order

SkyReels documentation says "one should be environment/background." Following the WAN pattern, we place background first:

```
ref_images[0] = background image (outpainted to target aspect ratio)
ref_images[1] = first object  (from scene_object_indices[i][0])
ref_images[2] = second object (from scene_object_indices[i][1])
ref_images[3] = third object  (from scene_object_indices[i][2])
```

**Max 4 images total.** 1 background + up to 3 objects.

### Image Source

Images come from the same pipeline as WAN/Kling:
1. Objects grid → split → cropped object images (`objects.final_url`)
2. Backgrounds grid → split → outpainted background images (`backgrounds.final_url`)

No changes to grid generation, splitting, or outpainting.

### `getRefVideoContext()` Changes

The existing `getRefVideoContext()` already fetches object URLs and background URL. For SkyReels, we need:

1. Validate `objectUrls.length + 1 <= 4` (instead of WAN's 5 or Kling's 4+1)
2. No `elements` array needed (that's Kling-specific)
3. No `multi_prompt` or `multi_shots` needed

```typescript
// In getRefVideoContext(), add SkyReels validation:
if (model === 'skyreels' && objectCount + 1 > 4) {
  log.error('SkyReels max 4 ref_images exceeded', {
    scene_id: sceneId,
    object_count: objectCount,
    total: objectCount + 1,
  });
  return null;
}
```

---

## 8. DB Changes

### Required Schema Changes

**`scenes` table — add `video_provider` column:**

```sql
ALTER TABLE studio.scenes
ADD COLUMN video_provider text DEFAULT NULL;

COMMENT ON COLUMN studio.scenes.video_provider IS
  'Video generation provider: null for fal.ai (default), ''skyreels'' for SkyReels API';
```

This column serves two purposes:
1. `poll-skyreels` queries for scenes with `video_provider = 'skyreels'` and `video_status = 'processing'`
2. Future providers (non-fal.ai) can use the same pattern

The existing `video_request_id` column (already on `scenes`) stores the SkyReels `task_id`.

### No Other Schema Changes Needed

- `storyboards.model` already stores the video model identifier — just add `'skyreels'` as a valid value
- `storyboards.plan` already stores JSONB — the SkyReels plan shape fits
- `objects`, `backgrounds`, `grid_images`, `voiceovers` tables are unchanged
- The ref-to-video pipeline tables (`objects`, `backgrounds`) already handle the SkyReels data model

---

## 9. UI Changes

### Model Selection

**File:** `editor/src/components/editor/media-panel/panel/storyboard.tsx`

Add SkyReels to the video model dropdown for ref_to_video mode:

```typescript
const VIDEO_MODELS = [
  { value: 'klingo3', label: 'Kling O3' },
  { value: 'klingo3pro', label: 'Kling O3 Pro' },
  { value: 'wan26flash', label: 'WAN 2.6 Flash' },
  { value: 'skyreels', label: 'SkyReels' },  // NEW
];
```

### Duration Display

When SkyReels is selected, the UI should indicate the 5s max:

```typescript
// In the model info/tooltip area:
{videoModel === 'skyreels' && (
  <span className="text-xs text-muted-foreground">
    Max 5s per clip · Max 3 objects/scene
  </span>
)}
```

### No Other UI Changes Needed

- Grid review UI works the same (objects + backgrounds grids)
- Scene cards work the same (prompt, voiceover, video status)
- Draft plan editor validates against the model-specific schema (already dispatches by `storyboard.model`)
- Timeline assembly is unchanged

---

## 10. File-by-File Change List

### New Files

| File | Description |
|------|-------------|
| `editor/src/lib/schemas/skyreels-plan.ts` | Zod schemas, system prompt, reviewer prompt, grid prefix reuse |
| `supabase/functions/poll-skyreels/index.ts` | Cron-triggered edge function to poll SkyReels task status |
| `supabase/migrations/XXXXXX_add_video_provider.sql` | Add `video_provider` column to `scenes` table |
| `supabase/migrations/XXXXXX_add_poll_skyreels_cron.sql` | pg_cron job for polling |

### Modified Files

| File | Changes |
|------|---------|
| **`editor/src/app/api/storyboard/route.ts`** | Import SkyReels schemas. Add `'skyreels'` to `VALID_VIDEO_MODELS`. Add SkyReels branch in `generateRefToVideoPlan()` (system prompt, content schema, reviewer schema, final plan assembly). Add SkyReels validation (max 3 objects/scene, no @Element validation needed). Add `skyreelsPlanSchema` to PATCH validation. |
| **`editor/src/app/api/storyboard/approve/route.ts`** | No changes — already dispatches ref vs i2v by `storyboard.mode`. SkyReels uses `mode: 'ref_to_video'`, so it goes through `start-ref-workflow` automatically. |
| **`editor/src/app/api/storyboard/approve-ref-grid/route.ts`** | Add max(3) clamping for `scene_object_indices` when model is `'skyreels'` (currently clamps to 4). |
| **`supabase/functions/generate-video/index.ts`** | Add `skyreels` to `MODEL_CONFIG`. Add `SKYREELS_API_KEY` env var. Add `sendSkyReelsRequest()` function. In main handler loop, add SkyReels branch that calls `sendSkyReelsRequest()` and sets `video_provider = 'skyreels'`. No `fal_webhook` for SkyReels — task_id stored for polling. |
| **`supabase/functions/webhook/index.ts`** | No changes. SkyReels results are written directly by `poll-skyreels`, not through the webhook. The webhook only handles fal.ai callbacks. |
| **`editor/src/components/editor/media-panel/panel/storyboard.tsx`** | Add `'skyreels'` to video model dropdown options. Add info text about 5s max / 3 objects max when SkyReels selected. |
| **`editor/src/components/editor/media-panel/panel/draft-plan-editor.tsx`** | Add `skyreelsPlanSchema` to plan validation dispatch (same pattern as Kling/WAN). |
| **`editor/src/components/editor/media-panel/panel/storyboard-cards.tsx`** | Add `'skyreels'` to model display name mapping. No functional changes — video generation dispatch already uses `storyboard.model`. |
| **`editor/src/lib/supabase/workflow-service.ts`** | No changes — realtime subscriptions already watch `scenes.video_status` and `scenes.video_url`. SkyReels updates these columns via `poll-skyreels`, and the client picks them up automatically. |
| **`editor/src/hooks/use-workflow.ts`** | No changes — derived states (`isProcessing`, `isComplete`) are based on `video_status` values, which SkyReels uses the same way. |
| **`supabase/config.toml`** | Add `poll-skyreels` function config. Set `verify_jwt = false` for cron access. |

### Environment Variables

| Variable | Where | Value |
|----------|-------|-------|
| `SKYREELS_API_KEY` | Supabase edge function secrets | SkyReels API key |

Add via: `supabase secrets set SKYREELS_API_KEY=<key>`

---

## Summary of Key Architectural Decisions

1. **SkyReels is a ref-to-video model.** It reuses the ref-to-video pipeline (TWO grids, objects + backgrounds, scene index mappings). It does NOT belong in I2V.

2. **SkyReels follows the WAN pattern**, not the Kling pattern. Flat image array (not `elements` API), simple string prompts (not multi-shot arrays), no @Element syntax.

3. **Polling is decoupled from submission.** `generate-video` submits to SkyReels and stores the task_id. A separate `poll-skyreels` cron function checks for results. The client doesn't know or care about polling — it reacts to DB changes via existing realtime subscriptions.

4. **No webhook hacks.** We don't fake webhooks, route SkyReels through the webhook handler, or pretend SkyReels is a fal.ai model. The polling function writes results directly to the DB.

5. **No new DB tables.** One new column (`video_provider`) on the existing `scenes` table is sufficient. The existing `video_request_id` column stores the SkyReels task_id.

6. **LLM uses plain-text prompts.** No @Element syntax, no @Image references. Character names and location descriptions directly in the prompt. This is both cleaner for SkyReels and avoids the complexity of reference resolution.

7. **512-token prompt limit** is handled at three levels: LLM system prompt (instructs conciseness), reviewer (enforces it), and runtime truncation (safety net).

8. **5s duration limit** cascades naturally: LLM targets 3-5s segments, `bucketDuration` clamps to 1-5s, more scenes are generated. No special handling needed in timeline assembly.
