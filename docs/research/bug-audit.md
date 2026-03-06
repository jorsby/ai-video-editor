# Bug Audit Report — AI Video Editor

**Date:** 2026-03-06
**Scope:** Full codebase (`editor/src/`, `supabase/functions/`)
**Mode:** READ-ONLY analysis

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 7     |
| HIGH     | 14    |
| MEDIUM   | 22    |
| LOW      | 10    |
| **Total** | **53** |

---

## Top 5 Most Urgent Fixes

1. **Webhook endpoint has no caller verification** — anyone can spoof fal.ai webhooks and manipulate storyboard state
2. **Upload endpoints (presign, multipart) have zero authentication** — anyone can upload files to R2
3. **rendered-videos GET by project_id missing user_id filter** — users can view other users' videos
4. **N+1 query loops in webhook handler & approve-grid** — sequential DB calls cause severe performance degradation
5. **Batch-export POST writes to hardcoded `D:\animations`** — will crash in production

---

## CRITICAL Issues (7)

### C1. Webhook has no signature verification
- **File:** `editor/src/app/api/webhook/fal/route.ts:1144`
- **Description:** The fal.ai webhook POST handler accepts any request with a valid `step` query parameter. No HMAC signature, no IP allowlist, no shared secret verification.
- **Impact:** Attacker can craft webhook payloads to: update storyboard states, inject malicious URLs into grid images, mark scenes as complete with arbitrary data.
- **Fix:** Implement HMAC-SHA256 signature verification using fal.ai's webhook signing key, or at minimum validate a shared secret header.

### C2. Upload presign endpoint has no authentication
- **File:** `editor/src/app/api/uploads/presign/route.ts:22`
- **Description:** `const { userId = 'mockuser', fileNames } = body;` — no `supabase.auth.getUser()` call. Anyone can generate presigned R2 upload URLs.
- **Impact:** Unauthenticated file uploads to R2 storage. Storage abuse, cost escalation, potential malicious content hosting.
- **Fix:** Add Supabase auth check; remove `'mockuser'` fallback.

### C3. Upload multipart/initiate has no authentication
- **File:** `editor/src/app/api/uploads/multipart/initiate/route.ts:30`
- **Description:** `userId = 'mockuser'` fallback, no auth check. Same issue as presign.
- **Impact:** Same as C2 — unauthenticated multipart uploads.
- **Fix:** Add auth check, remove mockuser default.

### C4. N+1 query pattern in approve-grid scene creation
- **File:** `editor/src/app/api/storyboard/approve-grid/route.ts:159-189`
- **Description:** Creates scenes, first_frames, and voiceovers in a sequential loop: `for (let i = 0; i < expectedScenes; i++) { await insert scene; await insert first_frame; for (lang) { await insert voiceover; } }`. For 9 scenes x 3 languages = 27+ sequential DB round-trips.
- **Impact:** Severe latency on approval (seconds of unnecessary wait). Timeout risk on larger grids.
- **Fix:** Batch all inserts: `scenes.insert([...all])`, `first_frames.insert([...all])`, `voiceovers.insert([...all])`.

### C5. N+1 query pattern in webhook handleSceneSplit
- **File:** `editor/src/app/api/webhook/fal/route.ts:490-522`
- **Description:** Updates first_frames one-by-one in a loop: `for (scene of scenes) { await update first_frames.eq('id', firstFrame.id) }`. Same pattern repeated in handleObjectsSplit (line 558-574) and handleBackgroundsSplit (line 601-617).
- **Impact:** For 36-cell grids, this is 36+ sequential UPDATE queries. Webhook processing becomes very slow and risks timeouts.
- **Fix:** Use batch update patterns or a single RPC call.

### C6. Batch-export hardcoded Windows path
- **File:** `editor/src/app/api/batch-export/route.ts:50`
- **Description:** `const exportDir = 'D:\\animations';` — hardcoded Windows absolute path.
- **Impact:** Route crashes on any non-Windows server (all production deployments). `fs.mkdirSync('D:\\animations')` will fail.
- **Fix:** Use `os.tmpdir()` or a configurable env var, or upload to R2 instead of local filesystem.

### C7. rendered-videos GET missing user_id filter
- **File:** `editor/src/app/api/rendered-videos/route.ts:107-111`
- **Description:** When fetching by `project_id`, the query is `.eq('project_id', projectId)` without `.eq('user_id', user.id)`. The single-video fetch (by `id`) correctly filters by user_id (line 87), but the project listing does not.
- **Impact:** Any authenticated user can view rendered videos for any project by guessing/enumerating project IDs. Relies entirely on RLS which may not filter this correctly.
- **Fix:** Add `.eq('user_id', user.id)` to the project_id query path.

---

## HIGH Issues (14)

### H1. Webhook CORS allows all origins
- **File:** `editor/src/app/api/webhook/fal/route.ts:7`
- **Description:** `'Access-Control-Allow-Origin': '*'` — combined with no auth (C1), any website can trigger webhook calls via CORS.
- **Impact:** Cross-origin webhook spoofing from malicious websites.
- **Fix:** Remove CORS headers entirely (webhooks don't need browser CORS) or restrict to fal.ai origins.

### H2. Webhook returns 200 on internal errors
- **File:** `editor/src/app/api/webhook/fal/route.ts:1191-1197`
- **Description:** The catch-all error handler returns HTTP 200 with `{ success: false }`. fal.ai sees 200 and won't retry.
- **Impact:** Webhook silently lost on transient errors. Storyboard stuck in 'generating' or 'splitting' state permanently.
- **Fix:** Return 500 on genuine errors so fal.ai retries delivery.

### H3. Race condition: webhook status update without conditional check
- **File:** `editor/src/app/api/webhook/fal/route.ts:333`
- **Description:** `.update({ plan_status: 'grid_ready' }).eq('id', storyboard_id)` lacks `.eq('plan_status', 'generating')` guard. Other status transitions (line 226) correctly include the condition.
- **Impact:** Duplicate webhook can overwrite a non-'generating' status back to 'grid_ready'.
- **Fix:** Add `.eq('plan_status', 'generating')` to make the transition atomic.

### H4. Race condition in poll-skyreels status updates
- **File:** `editor/src/app/api/workflow/poll-skyreels/route.ts:80-100`
- **Description:** Updates scene to 'success' or 'failed' without checking current status. If webhook and poll fire simultaneously, one could overwrite the other's status.
- **Impact:** Video generation status could flip between success/failed unpredictably.
- **Fix:** Add `.eq('video_status', 'processing')` condition to updates.

### H5. Storyboard DELETE missing ownership check
- **File:** `editor/src/app/api/storyboard/route.ts:696`
- **Description:** DELETE uses `.eq('id', storyboardId)` without `.eq('user_id', user.id)` or project ownership verification. Relies solely on RLS.
- **Impact:** If RLS policy has a gap, any user can delete any storyboard.
- **Fix:** Add explicit ownership check in application code as defense-in-depth.

### H6. approve-ref-grid non-atomic status transition
- **File:** `editor/src/app/api/storyboard/approve-ref-grid/route.ts:268-271`
- **Description:** `update({ plan_status: 'splitting' })` without `.eq('plan_status', previous_status)` allows concurrent requests to both proceed.
- **Impact:** Two concurrent approvals could create duplicate scene data.
- **Fix:** Add `.eq('plan_status', 'grid_ready')` guard.

### H7. ref_to_video partial failure leaves inconsistent state
- **File:** `editor/src/app/api/webhook/fal/route.ts:300-322`
- **Description:** If one grid succeeds and one fails in ref_to_video mode: first webhook sets status to 'failed', second tries `.eq('plan_status', 'generating')` which no longer matches. The successful grid's data is saved but the overall status is stuck.
- **Impact:** Storyboard stuck in 'failed' with partial data. User must create a new storyboard.
- **Fix:** Handle partial failures separately — track per-grid status.

### H8. SQL injection vector in v2/posts PUT
- **File:** `editor/src/app/api/v2/posts/[id]/route.ts:113`
- **Description:** `.not('octupost_account_id', 'in', \`(${accountIds.join(',')})\`)` — user-supplied `accountIds` are directly interpolated into the PostgREST filter string without sanitization.
- **Impact:** If accountIds contain values like `1); DROP TABLE posts; --`, the filter string could be manipulated. PostgREST may partially mitigate this, but it's unsafe practice.
- **Fix:** Use `.not('octupost_account_id', 'in', accountIds)` with array parameter instead of string interpolation.

### H9. Missing storyboard ownership check in translate routes
- **File:** `editor/src/app/api/translate-language/route.ts:26-30`, `translate-languages/route.ts:47-52`, `translate-scene-voiceover/route.ts:47-50`
- **Description:** These routes fetch scenes by storyboard_id without verifying the storyboard belongs to the authenticated user.
- **Impact:** Users can translate/view other users' storyboard content.
- **Fix:** Add ownership verification before processing.

### H10. Elevenlabs routes call API before auth check
- **File:** `editor/src/app/api/elevenlabs/voiceover/route.ts:72-77`, `elevenlabs/music/route.ts:66-71`
- **Description:** Auth check happens after the expensive ElevenLabs API call and R2 upload.
- **Impact:** Unauthenticated requests still consume API credits and storage before being rejected.
- **Fix:** Move auth check to the top of the handler.

### H11. approve-grid-split error path continues silently
- **File:** `editor/src/app/api/storyboard/approve-grid/route.ts:166-171`
- **Description:** When scene insert fails, code does `continue` (line 171) — skipping first_frame and voiceover creation for that scene. But no error is returned to the caller; the flow completes with fewer scenes than expected.
- **Impact:** Missing scenes with no error indication. User sees partial storyboard.
- **Fix:** Fail the entire operation if any scene insert fails, or return warning about missing scenes.

### H12. Dead Supabase Edge Functions still deployed
- **Files:** `supabase/functions/approve-grid-split/`, `supabase/functions/approve-ref-split/`, `supabase/functions/webhook/`
- **Description:** These Edge Functions reference old ComfyUI splitgridimage endpoints and duplicate logic now in Next.js API routes. The `webhook/` Edge Function is a separate implementation of the same webhook handler in `editor/src/app/api/webhook/fal/route.ts`.
- **Impact:** Divergent implementations — bugs fixed in one aren't fixed in the other. Risk of routing to wrong handler. Unnecessary Supabase billing.
- **Fix:** Delete or disable unused Edge Functions. Verify which webhook URL is configured in fal.ai.

### H13. Async forEach in use-background-post-check
- **File:** `editor/src/hooks/use-background-post-check.ts:26-49`
- **Description:** Uses `forEach` with async callback — promises are not awaited, causing race conditions between fetch calls and toast notifications.
- **Impact:** Posts may show success toast before verification completes. Concurrent uncontrolled requests.
- **Fix:** Use `for...of` loop or `Promise.all(items.map(...))`.

### H14. Storyboard component fetches without cleanup
- **File:** `editor/src/components/editor/media-panel/panel/storyboard.tsx:154-187`
- **Description:** useEffect fetches storyboards and draft data without abort controller or cleanup. If component unmounts during fetch, state updates fire on unmounted component.
- **Impact:** Memory leak, React warnings, potential crash.
- **Fix:** Add AbortController with cleanup in useEffect return.

---

## MEDIUM Issues (22)

### M1. approve-grid plan_status update not error-checked
- **File:** `editor/src/app/api/storyboard/approve-grid/route.ts:252-255`
- Storyboard update to 'approved' ignores errors. If it fails, scenes exist but storyboard is stuck in 'grid_ready'.

### M2. approve-ref-grid missing error handling on scene fetch
- **File:** `editor/src/app/api/storyboard/approve-ref-grid/route.ts:293-298`
- If scene fetch fails, code continues with undefined `scenes` and crashes in loop.

### M3. Swallowed DB errors in fal/image and fal/video
- **Files:** `editor/src/app/api/fal/image/route.ts:98-101`, `fal/video/route.ts:92-95`
- Asset DB insert error is ignored; caller receives success response but asset record is lost.

### M4. Missing error check on first_frames update in webhook
- **File:** `editor/src/app/api/webhook/fal/route.ts:406-409`
- Update operation executed without checking error result.

### M5. Workflow video missing status guard on update
- **File:** `editor/src/app/api/workflow/video/route.ts:839-842`
- Sets `video_request_id` but doesn't set `video_status: 'processing'` atomically.

### M6. Inconsistent error messages in workflow/sfx
- **File:** `editor/src/app/api/workflow/sfx/route.ts:165-171`
- Some error paths set `error_message`, others don't.

### M7. Inconsistent error messages in workflow/tts
- **File:** `editor/src/app/api/workflow/tts/route.ts:276-277, 302-305`
- Same inconsistency as M6.

### M8. Debug logs store unsanitized payload
- **File:** `editor/src/app/api/webhook/fal/route.ts:1156`
- Raw fal.ai payload stored to `debug_logs` table without sanitization. May contain auth tokens or sensitive data.

### M9. Prompt injection in storyboard generation
- **File:** `editor/src/app/api/storyboard/route.ts:525-543`
- User-provided voiceover text embedded directly into AI prompt without escaping.

### M10. Prompt injection in chat flow
- **File:** `editor/src/genkit/chat-flow.ts:67`
- User message interpolated directly into prompt template.

### M11. Missing tool input validation in genkit
- **File:** `editor/src/genkit/chat-flow.ts:93-99`
- LLM tool requests processed without schema validation of inputs.

### M12. Silent exception in logger
- **File:** `editor/src/lib/logger.ts:223`
- Bare catch in `logWorkflowEvent` silently drops logging errors. Could hide workflow issues.

### M13. Missing env var validation (inconsistent)
- **Files:** `editor/src/app/api/workflow/video/route.ts:6-7`, `webhook/fal/route.ts:1152`
- Some routes use `getRequiredEnv()` (good), others use `process.env.VAR!` non-null assertion (bad). Inconsistent pattern means some routes crash with unhelpful errors when env vars are missing.

### M14. Preview-panel useEffect missing projectId dependency
- **File:** `editor/src/components/editor/preview-panel.tsx:129`
- `useEffect` with `// eslint-disable-next-line` and empty deps, but uses `projectId`. Won't reload timeline if project changes.

### M15. Canvas-panel useEffect missing canvasSize dependency
- **File:** `editor/src/components/editor/canvas-panel.tsx:109`
- Studio created with initial canvasSize; subsequent changes may not propagate.

### M16. Missing studio dependency in editor hotkeys
- **File:** `editor/src/hooks/use-editor-hotkeys.ts:163`
- Hotkey handlers reference `studio` but it's not in the dependency array. After studio changes, hotkeys reference stale instance.

### M17. Dashboard doesn't track error states for all fetches
- **File:** `editor/src/components/dashboard/dashboard-content.tsx:153-178`
- `fetchGroups()`, `fetchTags()`, `fetchProjectTags()` don't have error states tracked. UI may show loading forever on failure.

### M18. storyboard-cards invokeWorkflow error handling
- **File:** `editor/src/components/editor/media-panel/panel/storyboard-cards.tsx:62-82`
- Checks `!res.ok` after calling `res.json()` which could throw on non-JSON error responses.

### M19. project/reset missing ownership verification
- **File:** `editor/src/app/api/project/reset/route.ts:24-26`
- Calls `reset_project` RPC without verifying project belongs to user.

### M20. generate-caption/generate-hook missing ownership check
- **Files:** `editor/src/app/api/generate-caption/route.ts:115-120`, `generate-hook/route.ts:80-85`
- Fetches project by ID without verifying it belongs to authenticated user.

### M21. Cron publish-scheduled race condition
- **File:** `editor/src/app/api/cron/publish-scheduled/route.ts:40-47`
- Multiple concurrent cron invocations could publish the same post twice if post updates lack atomicity guards.

### M22. project-context renameProject dependency loop
- **File:** `editor/src/contexts/project-context.tsx:67`
- `renameProject` useCallback depends on `projectName` which it modifies, causing unnecessary re-renders.

---

## LOW Issues (10)

### L1. Debug console.log statements in production code
- **Files:** `captions.tsx:351-353`, `storyboard.tsx:258,302,371`, `preview-panel.tsx:97,104`
- Debug log statements left in. Console pollution in production.

### L2. Excessive `any` type annotations
- **Files:** `workflow-page.tsx:256,476`, `header.tsx:151`, various hooks
- Multiple `catch (error: any)` and `(g: any)` patterns lose type safety.

### L3. Commented-out code blocks
- **File:** `storyboard-cards.tsx:122-145`
- Large commented-out voice configuration block. Should be removed or documented.

### L4. health endpoint information disclosure
- **File:** `editor/src/app/api/health/route.ts`
- Exposes environment variable names and internal error details.

### L5. proxy/media no retry logic
- **File:** `editor/src/app/api/proxy/media/route.ts:47`
- 60-second timeout but no retry on upstream failure.

### L6. Batch-export uses synchronous fs operations
- **File:** `editor/src/app/api/batch-export/route.ts:50-57`
- `fs.writeFileSync()` blocks the event loop during request handling.

### L7. Missing pagination validation
- **Files:** `assets/route.ts`, `projects/route.ts`
- No validation on limit/offset query parameters — extreme values cause performance issues.

### L8. Auto-save null studio check
- **File:** `editor/src/hooks/use-auto-save.ts:65`
- `performSave` callback could be invoked when studio is null.

### L9. Captions cancellation incomplete
- **File:** `editor/src/components/editor/media-panel/panel/captions.tsx:116-139`
- Has `cancelled` flag pattern but async loop doesn't exit early mid-iteration.

### L10. No timeout on AI generation
- **File:** `editor/src/genkit/chat-flow.ts:59-79`
- `generateStream` called without timeout. Could hang indefinitely if provider unresponsive.

---

## Dead Code Inventory

| Location | Description | Status |
|----------|-------------|--------|
| `supabase/functions/approve-grid-split/` | Old ComfyUI-based grid splitting | Replaced by Sharp in Next.js API |
| `supabase/functions/approve-ref-split/` | Old ComfyUI-based ref splitting | Replaced by Sharp in Next.js API |
| `supabase/functions/webhook/` | Duplicate webhook handler | Active handler is in Next.js API |
| `supabase/functions/generate-video/` | Possibly replaced by workflow/video API | Needs verification |
| `supabase/functions/generate-tts/` | Possibly replaced by workflow/tts API | Needs verification |
| `supabase/functions/generate-sfx/` | Possibly replaced by workflow/sfx API | Needs verification |
| `supabase/functions/edit-image/` | Possibly replaced by workflow/edit-image API | Needs verification |
| `supabase/functions/poll-skyreels/` | Possibly replaced by workflow/poll-skyreels API | Needs verification |
| `supabase/functions/start-workflow/` | Possibly replaced by Next.js workflow | Needs verification |
| `supabase/functions/start-ref-workflow/` | Possibly replaced by Next.js workflow | Needs verification |

**Recommendation:** Audit which Supabase Edge Functions are still called (check fal.ai webhook URLs, frontend invocations) and delete the unused ones.

---

## Webhook Flow Analysis

### Happy Path
```
User approves grid → approve-grid/route.ts
  → Creates scenes + first_frames in DB
  → Runs Sharp grid split locally
  → Updates first_frames with tile URLs
  → Sets plan_status = 'approved'
```

### Risk Points

1. **Webhook loss:** If fal.ai webhook delivery fails AND the handler returns 200 on errors (H2), the webhook is permanently lost. No retry mechanism exists. Storyboard stuck in 'generating'.

2. **Duplicate webhooks:** Partially protected. `tryCompleteSplitting()` uses atomic `.eq('plan_status', 'splitting')` guard (good). But `GenGridImage` handler (line 333) lacks the guard (H3).

3. **Race: webhook before DB row:** If webhook arrives during the scene creation loop in approve-grid (lines 159-189), the webhook handler will find zero or partial scenes. No coordination mechanism exists.

4. **Stuck states:** No timeout monitoring. If a storyboard enters 'generating' or 'splitting' and the webhook never arrives, it stays stuck forever. The only recovery is the "re-approval of failed/stuck storyboards" feature (commit f693f45).

---

## Notes

- Many authorization concerns are partially mitigated by Supabase Row Level Security (RLS). However, application-level checks should exist as defense-in-depth — RLS policies can have gaps, especially across schema boundaries.
- The `.env` file is properly gitignored and NOT committed to the repository.
- The cron endpoint (`publish-scheduled`) correctly validates `CRON_SECRET`.
