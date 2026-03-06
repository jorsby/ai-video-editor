# SkyReels Integration — Plan A (Minimal Integration)

## Your Role
You are Agent A. Your job is to produce a detailed implementation plan for adding SkyReels as a video model to the **I2V pipeline** in this AI video editor. Your bias: **minimal changes to existing code**. Reuse everything possible.

## Context

### Current I2V Pipeline
Read `STORYBOARD_I2V_FINAL.md` for the full I2V pipeline documentation.

Key points:
- User writes voiceover → LLM generates plan → grid image → split into scenes → generate video per scene
- Each scene has a `first_frame` image (split from grid) and a `visual_flow` prompt
- Video models (wan2.6, bytedance1.5pro, grok) take: image URL + prompt + duration
- fal.ai handles video generation with **webhooks** for async completion
- Duration varies by model (3-15s range)

### Current Ref-to-Video Pipeline  
Read `STORYBOARD_REF_FINAL.md` for the full ref-to-video pipeline (Kling O3 + Wan 2.6 Flash).

Key points:
- Uses TWO grids: objects (characters on white bg) + backgrounds (empty environments)
- Scene prompts reference @ElementN (objects) and @Image1/@Element1 (background)
- Each scene has multiple object images + 1 background image
- Video models get: object images + background image + prompt

### SkyReels API
**Endpoint:** POST https://apis.skyreels.ai/api/v1/video/multiobject/submit
**Polling:** GET https://apis.skyreels.ai/api/v1/video/multiobject/task/{task_id}

Parameters:
- api_key (string, required)
- prompt (string, required, max 512 tokens)
- ref_images (list[string], required, 1-4 images) — one should be environment/background
- duration (int, optional, default 5, max 5s, min 1s)
- aspect_ratio (string, optional, default "16:9", options: 16:9, 9:16, 3:4, 4:3, 1:1)

**No webhooks** — must poll for completion.
Task statuses: submitted → pending → running → success/failed

### Serhat's Requirements
1. SkyReels max 5 seconds — plan must respect this
2. 1-4 reference images, one MUST be the environment/background
3. This goes into the I2V pipeline (but it's structurally more like ref-to-video since it needs separate object + background images)
4. Keep the same grid generation, splitting, and review UX

## Your Task

Write a detailed implementation plan covering:

1. **Architecture Decision**: Does SkyReels fit into I2V as-is, or does it need the ref-to-video flow? Justify.
2. **LLM Plan Changes**: What changes to the system prompt, schema, or plan structure?
3. **Grid Generation**: Single grid or dual grids? How do we get the reference images SkyReels needs?
4. **Video Generation**: How do we call SkyReels (no webhooks — polling pattern)?
5. **Duration Handling**: 5s max — how does this affect voiceover splitting?
6. **Edge Function Changes**: What needs to change in generate-video?
7. **DB Changes**: Any new columns, tables, or status values?
8. **UI Changes**: What does the user see differently?
9. **File-by-file change list**: Every file that needs modification

Save your plan to `SKYREELS_PLAN_A.md`.

## Constraints
- Bias toward REUSING existing code. Don't rebuild what works.
- Be specific — file paths, function names, code snippets
- Think about edge cases: what if SkyReels is slow? What if polling times out?
- Consider: the I2V pipeline generates ONE grid. SkyReels needs multiple reference images. How do you bridge this?
