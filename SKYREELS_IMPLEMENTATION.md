# SkyReels Implementation Task

## Overview
Add SkyReels as a new video model in the **ref-to-video pipeline**. SkyReels takes 1-4 reference images (background + objects) and a plain-text prompt, generates up to 5s video. Uses REST API with polling (no webhooks).

## API Reference
- **Submit:** `POST https://apis.skyreels.ai/api/v1/video/multiobject/submit`
  - `api_key` (string, required)
  - `prompt` (string, required, max 512 tokens)
  - `ref_images` (string[], required, 1-4 URLs) — first = background, rest = objects
  - `duration` (int, optional, default 5, min 1, max 5)
  - `aspect_ratio` (string, optional, default "16:9", options: 16:9, 9:16, 3:4, 4:3, 1:1)
  - Returns: `{ task_id, msg, code, status, data, trace_id }`

- **Poll:** `GET https://apis.skyreels.ai/api/v1/video/multiobject/task/{task_id}`
  - Returns: `{ task_id, msg, code, status, data: { video_url, duration, resolution, cost_credits } }`
  - Statuses: submitted → pending → running → success/failed

## Environment
- API key is already in `editor/.env.local` as `SKYREELS_API_KEY`
- Also needs to be set as Supabase edge function secret

## Implementation Steps

### Step 1: DB Migration — Add `video_provider` column

Create migration file `supabase/migrations/<timestamp>_add_video_provider.sql`:

```sql
ALTER TABLE studio.scenes
ADD COLUMN IF NOT EXISTS video_provider text DEFAULT NULL;

COMMENT ON COLUMN studio.scenes.video_provider IS
  'Video generation provider: null for fal.ai (default), skyreels for SkyReels API';
```

Run: `cd editor && npx supabase db push` or apply via dashboard.

### Step 2: New Schema — `editor/src/lib/schemas/skyreels-plan.ts`

Create this file with:

1. **`skyreelsElementSchema`** — same as WAN: `{ name: string, description: string }`

2. **`skyreelsContentSchema`** (LLM output):
   - Same structure as WAN but:
   - `scene_prompts: z.array(z.string())` — plain text only (no multi-shot, no @Element)
   - `scene_object_indices: z.array(z.array(z.number().int().min(0)).max(3))` — MAX 3 objects per scene
   - NO `scene_multi_shots` field

3. **`skyreelsPlanSchema`** (stored in DB):
   - Same as content but `voiceover_list: z.record(z.string(), z.array(z.string()))` (language-wrapped)

4. **`skyreelsReviewerOutputSchema`**:
   - `scene_prompts`, `scene_bg_indices`, `scene_object_indices` — no `scene_multi_shots`

5. **`SKYREELS_SYSTEM_PROMPT`** — Key rules:
   - Target 3-5 seconds of voiceover per segment (max 5s video)
   - Max 3 objects + 1 background = 4 ref_images per scene
   - NO @Element or @Image syntax — use character NAMES directly ("Ahmed walks…")
   - Keep prompts under ~80 words (512 token API limit)
   - Same grid sizes as WAN: 2x2 through 6x6
   - Same visual/content rules (modern Islamic clothing, no hijab, no violence, no text overlays)
   - Include the same OUTPUT FORMAT JSON example as WAN but without scene_multi_shots

6. **`SKYREELS_REVIEWER_SYSTEM_PROMPT`** — Key tasks:
   - Improve prompt quality (vivid but concise)
   - Verify character names in prompts match assigned objects
   - Max 3 objects per scene enforcement
   - Keep prompts under ~80 words
   - Returns: scene_prompts, scene_bg_indices, scene_object_indices (no scene_multi_shots)

7. **Grid prefixes**: Import and reuse `REF_OBJECTS_GRID_PREFIX` and `REF_BACKGROUNDS_GRID_PREFIX` from `kling-o3-plan.ts`. Do NOT duplicate them.

### Step 3: Modify `editor/src/app/api/storyboard/route.ts`

**In the POST handler (plan generation):**
1. Add `'skyreels'` to `VALID_VIDEO_MODELS` (or equivalent validation)
2. Import SkyReels schemas and prompts from `skyreels-plan.ts`
3. In `generateRefToVideoPlan()`, add SkyReels branch:
   - Use `skyreelsContentSchema` + `SKYREELS_SYSTEM_PROMPT` for Call 1
   - Use `skyreelsReviewerOutputSchema` + `SKYREELS_REVIEWER_SYSTEM_PROMPT` for Call 1.5
   - NO `scene_multi_shots` merge (reviewer doesn't output it)
   - Post-reviewer validation: max 3 objects per scene, index bounds
   - Final plan construction: same as WAN but without `scene_multi_shots`
   - DB insert: `mode: 'ref_to_video'`, `model: 'skyreels'`

**In the PATCH handler (plan editing):**
4. Add `skyreelsPlanSchema` to the validation dispatch (alongside Kling/WAN schemas)

### Step 4: Modify `editor/src/app/api/storyboard/approve-ref-grid/route.ts`

1. When `storyboard.model === 'skyreels'`, clamp `scene_object_indices` arrays to max length 3 (instead of 4 for other models)
2. Add `skyreelsPlanSchema` to plan schema dispatch

### Step 5: Modify `supabase/functions/generate-video/index.ts`

**Add SkyReels to MODEL_CONFIG:**
```typescript
skyreels: {
  endpoint: 'skyreels-direct',  // marker — not a fal.ai endpoint
  mode: 'ref_to_video',
  validResolutions: ['720p', '1080p'],
  bucketDuration: (raw) => Math.max(1, Math.min(5, raw)),
  buildPayload: null,  // handled by sendSkyReelsRequest
},
```

**Add `sendSkyReelsRequest()` function:**
- Read `SKYREELS_API_KEY` from `Deno.env`
- Build payload: `{ api_key, prompt, ref_images: [bg_url, ...object_urls], duration, aspect_ratio }`
- Validate: `ref_images.length <= 4`, prompt length
- POST to `https://apis.skyreels.ai/api/v1/video/multiobject/submit`
- Return `{ taskId, error }`

**In the main handler loop, add SkyReels branch:**
- After getting `refContext` via `getRefVideoContext()`:
- If `model === 'skyreels'`:
  - Call `sendSkyReelsRequest(refContext, aspect_ratio)`
  - On success: UPDATE scene SET `video_status='processing'`, `video_request_id=taskId`, `video_provider='skyreels'`
  - On failure: UPDATE scene SET `video_status='failed'`, `video_error_message=error`
  - Do NOT build fal.ai webhook URL
  - Do NOT call `sendVideoRequest()` (that's the fal.ai path)

**In `getRefVideoContext()`:**
- Add SkyReels validation: `if (model === 'skyreels' && objectCount > 3) return null` (or log error)
- SkyReels doesn't need `multi_prompt` or `multi_shots` — skip those for skyreels
- SkyReels prompts use character names, not @Element — no `resolvePrompt()` transformation needed

### Step 6: New Edge Function — `supabase/functions/poll-skyreels/index.ts`

Create a new Supabase edge function that:

1. Queries `scenes` table for: `video_status='processing' AND video_provider='skyreels' AND video_request_id IS NOT NULL`
2. For each pending scene:
   - GET `https://apis.skyreels.ai/api/v1/video/multiobject/task/{task_id}`
   - If status `success`: UPDATE scene SET `video_status='success'`, `video_url=data.video_url`
   - If status `failed`: UPDATE scene SET `video_status='failed'`, `video_error_message=msg`
   - If still running: skip (will catch on next poll)
3. Return summary of what was processed

**Important:** The function must use the Supabase service role key (not user JWT) since it's called by cron.

**Timeout protection:** If a scene has been `processing` for >30 minutes, mark it as failed (stale task protection).

```typescript
// Stale task check
const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
// Mark scenes stuck in processing for >30 min as failed
await supabase.from('scenes')
  .update({ video_status: 'failed', video_error_message: 'SkyReels task timed out (30 min)' })
  .eq('video_status', 'processing')
  .eq('video_provider', 'skyreels')
  .lt('updated_at', thirtyMinAgo);
```

### Step 7: pg_cron Job for Polling

Create migration `supabase/migrations/<timestamp>_add_poll_skyreels_cron.sql`:

```sql
-- Poll every 15 seconds for SkyReels task completion
SELECT cron.schedule(
  'poll-skyreels',
  '15 seconds',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/poll-skyreels',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

NOTE: Check how the existing cron jobs are set up in the project (look at existing migrations for `cron.schedule` patterns). Match that pattern for service_role_key access. The `15 seconds` interval syntax may need `*/15 * * * * *` depending on the pg_cron version. Verify.

Also add to `supabase/config.toml`:
```toml
[functions.poll-skyreels]
verify_jwt = false
```

### Step 8: UI Changes

**`editor/src/components/editor/media-panel/panel/storyboard.tsx`:**
- Add `{ value: 'skyreels', label: 'SkyReels' }` to video model dropdown
- When `skyreels` is selected, show info: "Max 5s per clip · Max 3 objects/scene"

**`editor/src/components/editor/media-panel/panel/draft-plan-editor.tsx`:**
- Add `skyreelsPlanSchema` to plan validation dispatch
- SkyReels plans have no `scene_multi_shots` — don't render multi-shot toggle for skyreels

**`editor/src/components/editor/media-panel/panel/storyboard-cards.tsx`:**
- Add `'skyreels'` to model display name mapping (e.g., `skyreels: 'SkyReels'`)

**Type updates (wherever VideoModel type is defined):**
- Add `'skyreels'` to the union type

### Step 9: Verification

After implementing, verify:
1. `pnpm tsc --noEmit` passes (no new type errors)
2. Create a test storyboard with mode=ref_to_video, model=skyreels
3. Verify LLM generates plan with character names (no @Element)
4. Verify max 3 objects per scene in generated plan
5. Verify grid generation works (same as Kling/WAN)
6. Verify submit to SkyReels API returns task_id
7. Verify poll-skyreels picks up the task and updates scene

## Files Summary

### New (3):
- `editor/src/lib/schemas/skyreels-plan.ts`
- `supabase/functions/poll-skyreels/index.ts`
- `supabase/migrations/<timestamp>_add_video_provider.sql` (+ cron migration)

### Modified (6-7):
- `editor/src/app/api/storyboard/route.ts`
- `editor/src/app/api/storyboard/approve-ref-grid/route.ts`
- `supabase/functions/generate-video/index.ts`
- `editor/src/components/editor/media-panel/panel/storyboard.tsx`
- `editor/src/components/editor/media-panel/panel/draft-plan-editor.tsx`
- `editor/src/components/editor/media-panel/panel/storyboard-cards.tsx`
- `supabase/config.toml`

### Unchanged:
- `supabase/functions/start-ref-workflow/index.ts` (grid gen is model-agnostic)
- `supabase/functions/approve-ref-split/index.ts` (scene creation is model-agnostic)
- `supabase/functions/webhook/index.ts` (SkyReels doesn't use webhooks)
- `supabase/functions/generate-tts/index.ts` (TTS is model-agnostic)
- All I2V pipeline files
- Timeline assembly utils
- Realtime subscriptions

## Critical Constraints
- SkyReels API key: `sk-e99f9c4ea4d74b2fbcca53f2c94b5260`
- Max 5 seconds video duration
- Max 4 ref_images (1 bg + 3 objects)
- Max 512 tokens in prompt
- No webhooks — must poll
- No @Element syntax — use character names
- No multi-shot support
- ref_images order: [background, object1, object2, object3]
