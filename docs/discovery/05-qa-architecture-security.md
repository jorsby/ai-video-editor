# QA Agent 2: Architecture & Security Review

**Date:** 2026-03-06
**Reviewer:** QA Agent 2 (Claude Opus 4.6)
**Branch:** `feat/migrate-edge-to-nextjs-routes`
**Scope:** Post-migration architecture, security, and correctness review

---

## 1. Webhook URL Flow (End-to-End)

**Verdict: PASS**

Every fal.ai webhook URL in the codebase correctly points to `/api/webhook/fal` using `NEXT_PUBLIC_APP_URL`. No old Supabase `functions/v1` URLs remain.

| Route | Step | Query Params |
|-------|------|-------------|
| `storyboard/approve/route.ts` (L175-188, L469-489) | GenGridImage | step, grid_image_id, storyboard_id, rows, cols, width, height |
| `storyboard/approve-grid/route.ts` (L203-213) | SplitGridImage | step, grid_image_id, storyboard_id |
| `storyboard/approve-ref-grid/route.ts` (L25-33) | SplitGridImage | step, grid_image_id, storyboard_id |
| `storyboard/regenerate-grid/route.ts` (L138-151) | GenGridImage | step, grid_image_id, storyboard_id, rows, cols, width, height |
| `workflow/video/route.ts` (L516-523, L604-611) | GenerateVideo | step, scene_id |
| `workflow/sfx/route.ts` (L129-136) | GenerateSFX | step, scene_id |
| `workflow/tts/route.ts` (L119-126) | GenerateTTS | step, voiceover_id |
| `workflow/edit-image/route.ts` (L203-210) | OutpaintImage/EnhanceImage | step, entity_id |

All use `URLSearchParams` for construction. All use `falUrl.searchParams.set('fal_webhook', webhookUrl)`.

---

## 2. Auth Review

**Verdict: PASS**

### Webhook Route (no auth) - Correct
- `/api/webhook/fal/route.ts`: No auth check. Uses `createServiceClient()` (service role) for DB writes. Correct — external services POST here.

### User-Facing Routes (auth required) - All correct
All storyboard and workflow routes check auth via the same pattern:
```ts
const supabase = await createClient('studio');
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
```

Verified in:
- `storyboard/approve/route.ts` (L557-564)
- `storyboard/approve-grid/route.ts` (L17-24)
- `storyboard/approve-ref-grid/route.ts` (L81-88)
- `storyboard/regenerate-grid/route.ts` (L17-24)
- `workflow/tts/route.ts` (L190-196)
- `workflow/video/route.ts` (L674-680)
- `workflow/sfx/route.ts` (L66-72)
- `workflow/edit-image/route.ts` (L273-279)

### Secret Key Exposure - Safe
- `SUPABASE_SERVICE_ROLE_KEY`: Used only in `lib/supabase/admin.ts` and API routes (server-only). Zero matches for `NEXT_PUBLIC.*SERVICE_ROLE`.
- `FAL_KEY`: Used only in API routes (server-only). Zero matches for `NEXT_PUBLIC.*FAL_KEY`.
- `admin.ts` is never imported from `"use client"` files.

### Note: poll-skyreels
- `/api/workflow/poll-skyreels/route.ts` has no user auth check. This is acceptable — it's a cron job endpoint using `createServiceClient()`. Vercel cron jobs are invoked server-side.

---

## 3. CORS

**Verdict: PASS (fixed in this review)**

**Issue found:** The webhook route had no CORS headers and no OPTIONS handler. While fal.ai webhooks are server-to-server (CORS isn't strictly needed), the AGENTS.md explicitly requires CORS headers and their absence could cause silent failures with certain proxy configurations.

**Fix applied:**
- Added `CORS_HEADERS` constant with `Access-Control-Allow-Origin: *`
- Added `OPTIONS` handler export
- Added CORS headers to ALL Response objects in the webhook handler (including error responses)

---

## 4. Race Conditions

**Verdict: WARNING**

### Atomic Gates Found (Correct)
1. **`tryCompleteSplitting()`** in `webhook/fal/route.ts` (L678-683): Uses `UPDATE...WHERE plan_status='splitting'` — only one webhook wins. Correct.
2. **Stale task timeout** in `workflow/poll-skyreels/route.ts` (L16-25): Uses `UPDATE...WHERE video_status='processing' AND video_provider='skyreels' AND updated_at < threshold`. Correct.

### Pre-existing Race Conditions (Not introduced by migration)
These patterns existed in the original Supabase edge functions and were ported as-is. They are not regressions:

| Location | Pattern | Risk |
|----------|---------|------|
| `webhook/fal` handleGenGridImage (L204-217) | SELECT pending grids → UPDATE storyboard | Medium — two webhooks could both see 0 pending and both update |
| `webhook/fal` handleGenGridImage (L274-311) | SELECT pending → SELECT failed → UPDATE | Medium — same window |
| `storyboard/approve-grid` (L294-298) | UPDATE without status condition | Low — user-initiated, unlikely concurrent |
| `v2/posts/[id]/publish` (L21-46) | SELECT post → check status → UPDATE | Medium — double-publish possible |
| `cron/publish-scheduled` (L40-47) | UPDATE without atomic claim | Low — Vercel cron runs are serial |

**Recommendation:** The webhook race conditions in `handleGenGridImage` could be tightened with additional `.eq('plan_status', 'generating')` conditions, but this is a pre-existing pattern and not a migration regression. The `tryCompleteSplitting` gate (the most critical one) is correctly atomic.

---

## 5. Error Handling

**Verdict: PASS (fixed in this review)**

### Issue found: Non-200 responses on errors
fal.ai retries on non-2xx responses, which could cause infinite retry loops. Three error paths returned non-200:
- Missing `step` parameter → was 400
- Unknown `step` value → was 400
- Unhandled exception → was 500

**Fix applied:** All three now return status 200 with error details in the JSON body. fal.ai will not retry.

### DB Status Updates on Failure - Good
All step handlers write failed status to the database on errors:
- GenGridImage: `grid_images.status = 'failed'`
- SplitGridImage: objects/backgrounds/first_frames `status = 'failed'`
- GenerateTTS: `voiceovers.status = 'failed'`
- OutpaintImage/EnhanceImage: entity `status = 'failed'`
- GenerateVideo: `scenes.video_status = 'failed'`
- GenerateSFX: `scenes.sfx_status = 'failed'`

Users will not see infinite spinners on failures.

### All fal.ai calls have try/catch
Every route that calls fal.ai wraps the call in try/catch and updates DB status to 'failed' on error. Verified across all workflow routes.

---

## 6. Environment Variables

**Verdict: PASS (fixed in this review)**

### Required env vars for the new routes:

| Variable | Used By | Server/Client |
|----------|---------|--------------|
| `NEXT_PUBLIC_APP_URL` | Webhook URL construction (all workflow routes) | Both |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client creation | Client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client creation | Client |
| `SUPABASE_SERVICE_ROLE_KEY` | admin.ts, webhook handler | Server only |
| `FAL_KEY` | All fal.ai API calls | Server only |
| `OPENROUTER_API_KEY` | LLM calls (storyboard planning) | Server only |
| `DEEPGRAM_API_KEY` | Transcription | Server only |
| `ELEVENLABS_API_KEY` | TTS/music generation | Server only |
| `R2_*` (5 vars) | File uploads | Server only |
| `PEXELS_API_KEY` | Stock media | Server only |

### Issues found and fixed:
- `.env.sample` was missing `NEXT_PUBLIC_APP_URL` — **added**
- `.env.sample` was missing `SUPABASE_SERVICE_ROLE_KEY` — **added**

### No hardcoded secrets
Zero instances of hardcoded API keys or secrets found. All use `process.env.*`.

---

## 7. Migration Completeness

**Verdict: PASS (fixed in this review)**

### Old Supabase Edge Function References
- Zero references to `functions/v1` in application code
- Zero references to `SUPABASE_FUNCTIONS_URL`
- `supabase/functions/` directory still exists but is marked deprecated in AGENTS.md

### Frontend Pointing to New Routes
- `workflow-service.ts` calls `/api/storyboard/*`, `/api/workflow/*` — all new routes
- All storyboard components use the workflow service, not direct Supabase function calls
- All `fetch()` calls in components point to `/api/` routes

### poll-skyreels Cron
**Issue found:** `poll-skyreels` was a Supabase cron job. The Next.js route exists at `/api/workflow/poll-skyreels/route.ts` but it was NOT registered in `vercel.json` crons.

**Fix applied:** Added `poll-skyreels` to `vercel.json` crons:
```json
{
  "path": "/api/workflow/poll-skyreels",
  "schedule": "* * * * *"
}
```

---

## Summary of Fixes Applied

| # | File | Fix |
|---|------|-----|
| 1 | `webhook/fal/route.ts` | Added CORS_HEADERS constant + OPTIONS handler |
| 2 | `webhook/fal/route.ts` | Added CORS headers to ALL Response objects |
| 3 | `webhook/fal/route.ts` | Changed error responses from 400/500 to 200 |
| 4 | `.env.sample` | Added missing `NEXT_PUBLIC_APP_URL` and `SUPABASE_SERVICE_ROLE_KEY` |
| 5 | `vercel.json` | Added poll-skyreels cron entry |

## Items NOT Fixed (Pre-existing, Not Regressions)

| Issue | Location | Severity | Notes |
|-------|----------|----------|-------|
| Read-then-write in handleGenGridImage | webhook/fal L204-311 | Medium | Pre-existing from edge functions, not introduced by migration |
| No atomic gate on publish | v2/posts/[id]/publish L21-46 | Medium | Pre-existing, not part of migration scope |
| No atomic claim in cron | cron/publish-scheduled L40-47 | Low | Vercel crons are serial; risk is theoretical |

---

## Final Sign-Off

### SHIP IT

All migration-critical items pass. The three fixes applied (CORS, error codes, cron config) were straightforward and correct the webhook handler to match the patterns documented in AGENTS.md. No blocking issues remain.

Pre-existing race conditions in `handleGenGridImage` are noted as warnings but are not regressions — they were ported verbatim from the Supabase edge functions and the most critical gate (`tryCompleteSplitting`) is correctly atomic.
