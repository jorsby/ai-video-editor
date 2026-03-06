# SkyReels Integration — Plan B (Clean Architecture)

## Your Role
You are Agent B. Your job is to produce a detailed implementation plan for adding SkyReels as a video model to this AI video editor. Your bias: **clean architecture**. Design it right, even if it means more changes.

## Context

### Current I2V Pipeline
Read `STORYBOARD_I2V_FINAL.md` for the full I2V pipeline documentation.

Key points:
- User writes voiceover → LLM generates plan → grid image → split into scenes → generate video per scene
- Each scene has a first_frame image (split from grid) and a visual_flow prompt
- Video models (wan2.6, bytedance1.5pro, grok) take: image URL + prompt + duration
- fal.ai handles video generation with webhooks for async completion

### Current Ref-to-Video Pipeline  
Read `STORYBOARD_REF_FINAL.md` for the full ref-to-video pipeline (Kling O3 + Wan 2.6 Flash).

Key points:
- Uses TWO grids: objects (characters on white bg) + backgrounds (empty environments)
- Two-pass LLM (content + reviewer)
- Each scene has multiple object images + 1 background image

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
3. Keep the same grid generation, splitting, and review UX
4. SkyReels is a "reference to video" model — it needs object + background images, not just a single first frame

## Your Task

Write a detailed implementation plan covering:

1. **Architecture Decision**: Which pipeline does SkyReels belong in — I2V, ref-to-video, or a new hybrid? Think about what's CORRECT, not what's easiest.
2. **The Core Problem**: SkyReels needs 1-4 reference images (objects + background). I2V gives one first_frame. Ref-to-video gives objects + backgrounds. What's the right approach?
3. **LLM Plan**: Does SkyReels need its own system prompt? Its own schema? Or can it reuse Kling/Wan?
4. **Polling Architecture**: SkyReels has NO webhooks. Current system is fully webhook-based. Design a clean polling solution that doesn't hack the existing webhook flow.
5. **Duration Strategy**: 5s max means more scenes for the same voiceover. How does this cascade through the LLM plan, grid sizing, and timeline?
6. **Prompt Constraints**: Max 512 tokens. Current scene prompts can be long. How to handle?
7. **Reference Image Strategy**: How do we map objects + background to ref_images array? Order? What goes first?
8. **DB Changes**: Any schema changes needed?
9. **UI Changes**: Model selection, duration display, anything SkyReels-specific?
10. **File-by-file change list**: Every file that needs modification

Save your plan to `SKYREELS_PLAN_B.md`.

## Constraints
- Bias toward CORRECTNESS. If the architecture is wrong, say so and propose the right one.
- Be specific — file paths, function names, code snippets
- Challenge assumptions: just because something is in I2V today doesn't mean SkyReels belongs there
- Think about the FUTURE: what if more ref-to-video models get added? Is your design extensible?
