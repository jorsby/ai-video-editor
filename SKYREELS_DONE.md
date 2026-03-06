# SkyReels Implementation — Summary of Changes

## New Files Created (5)

### 1. `editor/src/lib/schemas/skyreels-plan.ts`
- `skyreelsContentSchema` — LLM output schema (flat voiceover_list, max 3 objects per scene, plain-text prompts)
- `skyreelsPlanSchema` — DB-stored plan schema (language-wrapped voiceover_list)
- `skyreelsReviewerOutputSchema` — reviewer output (scene_prompts, scene_bg_indices, scene_object_indices — no scene_multi_shots)
- `SKYREELS_SYSTEM_PROMPT` — instructs LLM to use character names (no @Element syntax), keep prompts under ~80 words, max 3 objects + 1 bg per scene, target 3-5s segments
- `SKYREELS_REVIEWER_SYSTEM_PROMPT` — verifies character names match assigned objects, enforces max 3 objects, improves prompt quality
- Re-exports `REF_OBJECTS_GRID_PREFIX` and `REF_BACKGROUNDS_GRID_PREFIX` from kling-o3-plan.ts (no duplication)

### 2. `supabase/functions/poll-skyreels/index.ts`
- Queries `scenes` where `video_status='processing' AND video_provider='skyreels'`
- Polls SkyReels API `GET /task/{task_id}` for each pending scene
- Updates scene to `success` (with video_url) or `failed` (with error message)
- Stale task protection: marks scenes stuck >30 minutes as failed
- Uses service role key (cron-compatible)

### 3. `supabase/migrations/20260306000000_add_video_provider.sql`
- Adds `video_provider text DEFAULT NULL` column to `studio.scenes`

### 4. `supabase/migrations/20260306000001_add_poll_skyreels_cron.sql`
- Schedules `poll-skyreels` cron job every 15 seconds via `pg_cron` + `pg_net`

### 5. `supabase/config.toml` (modified)
- Added `[functions.poll-skyreels]` with `verify_jwt = false`

## Modified Files (6)

### 6. `editor/src/app/api/storyboard/route.ts`
- Added `'skyreels'` to `VALID_VIDEO_MODELS`
- Imported SkyReels schemas and prompts
- `generateRefToVideoPlan()`: added SkyReels branch for Call 1 (content) and Call 1.5 (reviewer)
- Skips `scene_multi_shots` merge and validation for SkyReels
- Validates max 3 objects per scene for SkyReels
- Builds SkyReels final plan (same as Kling but without scene_multi_shots)
- PATCH handler: added `skyreelsPlanSchema` to validation dispatch

### 7. `editor/src/app/api/storyboard/approve-ref-grid/route.ts`
- Clamps `scene_object_indices` arrays to max 3 when `model === 'skyreels'`

### 8. `supabase/functions/generate-video/index.ts`
- Added `skyreels` to `MODEL_CONFIG` (endpoint: 'skyreels-direct', buildPayload: null, max 5s duration)
- Made `buildPayload` nullable in `ModelConfig` interface
- Added `sendSkyReelsRequest()` function — submits to SkyReels API with api_key, prompt, ref_images, duration, aspect_ratio
- Main handler loop: SkyReels branch calls `sendSkyReelsRequest` instead of `sendRefVideoRequest`, sets `video_provider='skyreels'`
- `getRefVideoContext()`: added SkyReels validation (max 3 objects), early return for SkyReels (no prompt resolution or multi-prompt)

### 9. `editor/src/lib/supabase/workflow-service.ts`
- Added `'skyreels'` to `VideoModel` union type
- Added `SkyReelsRefPlan` interface and included in `RefPlan` union

### 10. `editor/src/components/editor/media-panel/panel/storyboard.tsx`
- Added `{ value: 'skyreels', label: 'SkyReels' }` to `VIDEO_MODELS` dropdown

### 11. `editor/src/components/editor/media-panel/panel/draft-plan-editor.tsx`
- Updated video model display label to show "SkyReels" for skyreels model
- SkyReels prompt placeholder says "no @Element syntax"
- SkyReels reference chips show character names and "BG:" instead of @Element/@Image labels
- Multi-shot toggle naturally hidden (SkyReels plans don't have scene_multi_shots)

### 12. `editor/src/components/editor/media-panel/panel/storyboard-cards.tsx`
- Added SkyReels display name mapping in the static model label

## TypeScript Compilation
- `pnpm tsc --noEmit` passes with zero new errors (all errors are pre-existing in unrelated files)

## Key Design Decisions
- SkyReels prompts use character names directly — no @Element resolution needed in generate-video
- No webhook support — uses pg_cron polling every 15 seconds
- `video_provider` column distinguishes SkyReels scenes from fal.ai scenes for polling
- SkyReels plans share the same RefPlanBase structure as Kling (with objects array) but without scene_multi_shots
- Grid generation is model-agnostic — no changes needed to start-ref-workflow or approve-ref-split
