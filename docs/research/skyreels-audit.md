# SkyReels Integration Audit

**Date:** 2026-03-07
**Scope:** All files in `editor/src/` referencing SkyReels

---

## Files Reviewed

| File | Role |
|------|------|
| `editor/src/app/api/workflow/video/route.ts` | Video generation route (submit to SkyReels) |
| `editor/src/app/api/workflow/poll-skyreels/route.ts` | Polling route for SkyReels task status |
| `editor/src/app/api/storyboard/route.ts` | Storyboard plan generation (SkyReels prompt/schema) |
| `editor/src/app/api/storyboard/approve-ref-grid/route.ts` | Grid approval (clamps objects to 3) |
| `editor/src/lib/schemas/skyreels-plan.ts` | Zod schemas and system prompts |
| `editor/src/lib/supabase/workflow-service.ts` | Type definitions (`VideoModel`, `SkyReelsRefPlan`) |
| `editor/src/components/editor/media-panel/panel/storyboard.tsx` | Frontend model selector |
| `editor/src/components/editor/media-panel/panel/storyboard-cards.tsx` | Scene cards, video generation trigger |
| `editor/src/components/editor/media-panel/panel/draft-plan-editor.tsx` | Draft plan editor (display labels) |
| `editor/src/app/api/health/route.ts` | Health check (env var presence) |
| `editor/vercel.json` | Cron configuration |

---

## Issues Found

### 1. CRITICAL: poll-skyreels cron runs once per day instead of every 15 seconds

- **File:** `editor/vercel.json:8-9`
- **Current:** `"schedule": "0 0 * * *"` (midnight UTC, once per day)
- **Expected:** Polling every 15 seconds (or at minimum every minute, Vercel cron minimum)
- **Impact:** SkyReels video results are only picked up once per day. Users submit a video and wait up to 24 hours for the poll to retrieve the result.
- **Note:** Vercel cron minimum interval is 1 minute (`* * * * *`). The original Supabase pg_cron design targeted 15-second intervals, which is not possible with Vercel cron. Even at 1-minute intervals, this is a massive improvement over daily.
- **Suggested fix:** Change schedule to `"* * * * *"` (every minute). If sub-minute polling is needed, consider an alternative approach (e.g., client-triggered polling, or a long-running process).

### 2. MEDIUM: poll-skyreels has no authentication

- **File:** `editor/src/app/api/workflow/poll-skyreels/route.ts` (entire file)
- **Current:** The POST handler has no auth check. No `CRON_SECRET` validation, no user auth.
- **Comparison:** `editor/src/app/api/cron/publish-scheduled/route.ts:8-9` validates `CRON_SECRET` via `Authorization: Bearer` header.
- **Impact:** Anyone can trigger the poll endpoint externally. While it only reads/writes SkyReels task statuses (not destructive), it could be abused to spam the SkyReels API with poll requests.
- **Suggested fix:** Add `CRON_SECRET` validation matching the pattern in `publish-scheduled/route.ts`.

### 3. LOW: 5-second max duration is enforced server-side but not in the UI

- **File:** `editor/src/app/api/workflow/video/route.ts:166`
- **Server-side enforcement:** `bucketDuration: (raw) => Math.max(1, Math.min(5, raw))` correctly clamps to 1-5 seconds.
- **UI gap:** `editor/src/components/editor/media-panel/panel/storyboard-cards.tsx:1107-1119` — When scenes lack voiceover, the fallback duration defaults to 3 seconds (within limit). When voiceover exists, duration is derived from voiceover length and clamped server-side.
- **Impact:** No actual bug — the server clamps correctly. But if a voiceover is 10 seconds long, the video will be silently clamped to 5 seconds, creating a mismatch between audio and video duration. Users get no warning.
- **Suggested fix:** Show a warning in the UI when SkyReels is selected and any scene's voiceover exceeds 5 seconds, informing users that video duration will be capped.

### 4. LOW: SkyReels API key sent in request body, not as auth header

- **File:** `editor/src/app/api/workflow/video/route.ts:455-461`
- **Current:** `api_key` is included in the JSON payload body.
- **Impact:** This may be intentional per SkyReels API design. However, sending API keys in request bodies is less standard than using Authorization headers. If request bodies are logged anywhere, the key could leak.
- **Suggested fix:** Verify with SkyReels API docs whether an `Authorization` header is supported. If so, prefer that.

### 5. INFO: SkyReels does not get multi_prompt/multi_shots support

- **File:** `editor/src/app/api/workflow/video/route.ts:382-390`
- **Current:** When `model === 'skyreels'`, the function returns early with only `prompt`, `object_urls`, `background_url`, and `duration`. The `multi_prompt` and `multi_shots` fields are never populated for SkyReels.
- **Impact:** This is correct behavior — SkyReels uses a single prompt per scene. But if the storyboard plan contains `multi_prompt` data, it is silently ignored. The `scene.prompt` field is used instead.
- **Suggested fix:** No fix needed if SkyReels API only supports single prompts. Document this limitation.

### 6. INFO: Dual polling infrastructure (Supabase + Vercel)

- **Files:** `supabase/migrations/20260306000001_add_poll_skyreels_cron.sql`, `supabase/functions/poll-skyreels/`, `editor/src/app/api/workflow/poll-skyreels/route.ts`, `editor/vercel.json`
- **Current:** Both a Supabase edge function (`supabase/functions/poll-skyreels/`) with pg_cron and a Next.js API route (`editor/src/app/api/workflow/poll-skyreels/route.ts`) with Vercel cron exist.
- **Impact:** Depending on deployment, both could be active, causing duplicate polling. Or neither could be effective (Vercel cron is daily, pg_cron may not be deployed).
- **Suggested fix:** Pick one polling mechanism and remove the other. If using Vercel, fix the cron schedule (Issue #1). If using Supabase, remove the Vercel cron entry.

### 7. INFO: ref_images limit is 4 but objects limit is 3

- **File:** `editor/src/app/api/workflow/video/route.ts:355-358` (max 3 objects), `route.ts:449-453` (max 4 ref_images)
- **Current:** Objects are capped at 3, and ref_images = 1 background + up to 3 objects = 4 max. Both checks exist and are consistent.
- **Impact:** No issue — the constraints are correctly enforced at multiple levels (schema, storyboard generation, video route).

### 8. INFO: SkyReels valid resolutions listed but not used by SkyReels API

- **File:** `editor/src/app/api/workflow/video/route.ts:165`
- **Current:** `validResolutions: ['720p', '1080p']` is set, and `video_resolution` is saved to the scene record. But `sendSkyReelsRequest` (line 439-501) only sends `duration`, `prompt`, `ref_images`, `aspect_ratio`, and `api_key` — no resolution parameter.
- **Impact:** Resolution validation runs but the value is never sent to SkyReels. The resolution stored in the DB is cosmetic for SkyReels scenes.
- **Suggested fix:** Either send resolution to SkyReels if supported, or document that SkyReels controls its own output resolution.

---

## Summary

| Severity | Count | Issues |
|----------|-------|--------|
| CRITICAL | 1 | #1 (cron schedule) |
| MEDIUM | 1 | #2 (no auth on poll endpoint) |
| LOW | 2 | #3 (no UI warning), #4 (API key in body) |
| INFO | 4 | #5-#8 (design observations) |

The most impactful issue is **#1**: the Vercel cron for `poll-skyreels` runs once daily instead of every minute, meaning SkyReels video results are essentially never picked up in a timely manner. Issue **#2** (missing auth) is a secondary concern that should be addressed alongside the cron fix.
