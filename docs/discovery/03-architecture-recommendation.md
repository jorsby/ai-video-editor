# Architecture Recommendation: Simplest Webhook Stack

**Date:** 2026-03-06
**Status:** Discovery Complete
**Author:** Architecture Evaluator (subagent)

---

## 1. Current Architecture Map

### Text-Based Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CURRENT ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────┘

  ┌──────────┐     ┌─────────────────────┐     ┌──────────────────────┐
  │ Frontend │────▶│  Next.js API Routes  │────▶│ Supabase Edge Fns    │
  │ (React)  │     │  (Vercel Serverless) │     │ (Deno Runtime)       │
  └──────────┘     └─────────────────────┘     └──────────┬───────────┘
       │                                                   │
       │ polls/subscribes                                  │ sends requests
       ▼                                                   ▼
  ┌──────────┐                                    ┌──────────────────┐
  │ Supabase │◀───────────────────────────────────│    fal.ai        │
  │ Database │         webhook callback           │  (AI generation) │
  └──────────┘    (POST to edge fn webhook)       └──────────────────┘

  Legend:
  ──────▶  HTTP request
  ◀──────  Webhook callback (fal.ai → Supabase edge function → DB update)
```

### Detailed Data Flow

```
USER ACTION                  NEXT.JS API ROUTE              SUPABASE EDGE FN            FAL.AI
───────────                  ─────────────────              ────────────────            ──────

1. Generate plan ─────────▶ POST /api/storyboard
                            (LLM call via OpenRouter)
                            (writes storyboard to DB)

2. Approve plan ──────────▶ POST /api/storyboard/approve
                            (validates, updates status) ──▶ start-workflow
                                                           start-ref-workflow
                                                           (writes grid_images) ──────▶ queue.fal.run
                                                                                       (fal_webhook URL
                                                                                        points to webhook fn)

3. [ASYNC] fal.ai completes ◀─────────────────────────────── webhook fn ◀──────────── POST from fal.ai
                                                           (parses payload,            (sends result)
                                                            updates DB)

4. Approve grid ──────────▶ POST /api/storyboard/approve-grid
                            POST /api/storyboard/approve-ref-grid
                            (validates) ──────────────────▶ approve-grid-split
                                                           approve-ref-split
                                                           (creates scenes,
                                                            sends split req) ─────────▶ queue.fal.run

5. Generate TTS ──────────▶ [direct to edge fn] ─────────▶ generate-tts
                                                           (sends TTS reqs) ──────────▶ queue.fal.run

6. Generate video ─────────▶ [direct to edge fn] ─────────▶ generate-video
                                                           (sends video reqs) ────────▶ queue.fal.run

7. Edit image ─────────────▶ [direct to edge fn] ─────────▶ edit-image
                                                           (sends edit reqs) ─────────▶ queue.fal.run

8. Generate SFX ───────────▶ [direct to edge fn] ─────────▶ generate-sfx
                                                           (sends SFX reqs) ──────────▶ queue.fal.run

9. Poll SkyReels ──────────▶ [cron/manual] ───────────────▶ poll-skyreels
                                                           (polls SkyReels API,
                                                            updates DB)
```

---

## 2. Edge Function Classification

| Edge Function | Called By | What It Does | Auth Needed | Execution Time |
|---|---|---|---|---|
| **`webhook`** | **fal.ai** (external callback) | Parses AI result, updates DB | No (service role key internally) | <2s |
| `start-workflow` | Next.js API route (approve) | Writes to DB, submits fal.ai job | No (JWT disabled) | <3s |
| `start-ref-workflow` | Next.js API route (approve) | Writes to DB, submits 2 fal.ai jobs | No (JWT disabled) | <5s |
| `approve-grid-split` | Next.js API route (approve-grid) | Creates scenes/frames, submits split | No (JWT disabled) | <5s |
| `approve-ref-split` | Next.js API route (approve-ref-grid) | Creates scenes/objects/bgs, submits 2 splits | No (JWT disabled) | <5s |
| `generate-tts` | Frontend (direct) | Loops scenes, submits TTS jobs | No (JWT disabled) | <10s |
| `generate-video` | Frontend (direct) | Loops scenes, submits video jobs | No (JWT disabled) | <10s |
| `generate-sfx` | Frontend (direct) | Loops scenes, submits SFX jobs | No (JWT disabled) | <10s |
| `edit-image` | Frontend (direct) | Loops scenes, submits edit jobs | No (JWT disabled) | <10s |
| `poll-skyreels` | Cron/manual | Polls SkyReels API, updates DB | No (JWT disabled) | <5s |

**Critical finding:** ALL functions have `verify_jwt = false` in config.toml. The JWT issue is already "solved" by disabling verification entirely. The ES256 vs HS256 incompatibility comment in the code confirms this was a deliberate workaround.

**Only 1 function is a pure webhook** (called by fal.ai): `webhook`. The other 9 are orchestrators called by the frontend/Next.js routes.

---

## 3. Options Comparison

| Criterion | A: Fix Supabase EFs | B: Move to Next.js Routes | C: Standalone Server | D: Postgres Triggers |
|---|---|---|---|---|
| **Complexity** | Low (already working) | Medium (mechanical port) | High (new infra) | Very High (wrong tool) |
| **Reliability** | Medium (cold starts, Deno quirks) | High (Vercel infra) | High (full control) | Low (can't call external APIs) |
| **Cost** | Free tier → $25/mo Supabase Pro | $0 extra (Vercel already paid) | $5-20/mo (hosting) | $0 extra |
| **Maintenance** | 2 deployment targets, 2 runtimes | 1 deployment target, 1 runtime | 2 deployment targets | 1 target but severe limitations |
| **Debugging** | Hard (Deno logs in Supabase dashboard) | Easy (Vercel logs, local dev) | Medium (depends on hosting) | Very Hard (Postgres logs) |
| **JWT/Auth** | Permanently disabled (verify_jwt=false) | Standard Next.js middleware | Custom implementation | N/A |
| **Time to unblock** | ~1 hour (deploy with JWT disabled) | ~4-6 hours (port functions) | ~8-12 hours (setup + port) | Weeks (fundamental redesign) |
| **Env var management** | Supabase dashboard + .env.local | Single .env.local + Vercel dashboard | 3rd env config | N/A |
| **Local dev** | `supabase functions serve` + Next.js dev | Just `next dev` | 3 processes | N/A |

---

## 4. Option D: Eliminated

Supabase Database Webhooks / Postgres triggers **cannot handle this workload:**

- The `webhook` function receives complex fal.ai payloads with nested image/video URLs from ComfyUI nodes
- It needs to parse multiple response formats (images, audio, video, ComfyUI node outputs)
- Orchestrator functions need to make outbound HTTP calls to fal.ai/SkyReels — Postgres triggers can't do this natively
- The `music-metadata` npm package is used for audio duration calculation — not available in Postgres

**Verdict: Not viable. Eliminated.**

---

## 5. Option C: Eliminated

A standalone webhook server adds infrastructure for zero benefit:

- All functions are stateless, fast (<10s), and do simple parse+DB+HTTP work
- No long-running computations that would need a dedicated server
- Would require separate hosting, monitoring, SSL certs, uptime management
- The only advantage (no platform limits) is irrelevant — Vercel's limits are more than sufficient

**Verdict: Over-engineered. Eliminated.**

---

## 6. Deep Dive: Option A vs Option B

### Option A: Fix Supabase Edge Functions (Status Quo)

**What "fix" actually means:**
- JWT verification is already disabled (`verify_jwt = false` on all functions)
- The ES256/HS256 incompatibility is bypassed by using the anon key as bearer token
- The system works locally via `supabase functions serve`
- The real issue is **deploying to production** (Supabase hosted)

**Remaining pain points even if deployed:**
1. **Two deployment targets** — push to Vercel AND deploy edge functions to Supabase
2. **Two runtimes** — Node.js (Vercel) + Deno (Supabase EFs) with different import systems
3. **Duplicated env vars** — FAL_KEY, SUPABASE_SERVICE_ROLE_KEY must exist in both Vercel and Supabase
4. **No auth on edge functions** — all have `verify_jwt = false`, meaning anyone who knows the URL can call them
5. **Proxied calls** — Next.js routes call edge functions which call fal.ai — unnecessary hop for orchestrators
6. **Cold starts** — Supabase edge functions have cold starts on the free/pro tier

### Option B: Move Everything to Next.js API Routes

**Why this is the natural architecture:**

1. **The orchestrator functions are already proxied through Next.js.** The approve/route.ts fetches the storyboard, validates it, then calls the edge function. The edge function does the same thing the API route could do directly.

2. **Every function uses `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`.** Next.js routes can do the exact same thing with `@supabase/supabase-js`.

3. **Every function uses `fetch()` to call fal.ai.** Nothing Deno-specific about this.

4. **The webhook handler is stateless.** It receives a POST from fal.ai, parses the JSON, updates the DB. This is a textbook serverless function — perfect for Vercel.

5. **The one npm dependency** (`music-metadata` in the webhook handler for TTS duration calculation) works in Node.js natively. In Deno, it's imported as `npm:music-metadata@10` — a compatibility shim.

**Execution time analysis (Vercel limits):**
- Vercel Hobby: 10s timeout, Vercel Pro: 60s timeout
- `webhook` handler: parses JSON + 1-5 DB writes = **<2 seconds**
- Orchestrators: 1-5 DB reads + 1 fal.ai queue submission + 1-3 DB writes = **<5 seconds**
- Batch orchestrators (generate-video, generate-tts): loop with 1s delays between scenes. For 10 scenes = ~15 seconds → **needs Pro tier** or batch differently
- `poll-skyreels`: fetches pending scenes + polls SkyReels API = **<5 seconds**

**All well within Vercel Pro's 60s limit.** Even on Hobby, only batch operations with many scenes would need attention.

---

## 7. Recommendations

### Short-Term: Get Unblocked NOW (Option A, then migrate)

**If production deployment is needed today:**

1. Deploy edge functions to Supabase with `verify_jwt = false` (already configured)
2. Set env vars in Supabase dashboard: `FAL_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SKYREELS_API_KEY`
3. The webhook URL (`${SUPABASE_URL}/functions/v1/webhook`) will be publicly accessible
4. This works but leaves security debt (no auth on any edge function)

**Time: ~1 hour**

### Long-Term: Ideal Architecture (Option B)

**Move everything to Next.js API routes. Eliminate Supabase edge functions entirely.**

```
┌─────────────────────────────────────────────────────────────────────┐
│                       TARGET ARCHITECTURE                           │
└─────────────────────────────────────────────────────────────────────┘

  ┌──────────┐     ┌──────────────────────────────────────────────────┐
  │ Frontend │────▶│            Next.js API Routes (Vercel)           │
  │ (React)  │     │                                                  │
  └──────────┘     │  /api/storyboard/*      (plan, approve, grids)  │
       │           │  /api/workflow/*         (tts, video, sfx, edit) │
       │ realtime  │  /api/webhook/fal       (fal.ai callback)       │
       ▼           │  /api/webhook/skyreels  (skyreels poller)       │
  ┌──────────┐     └──────────────────┬───────────────────────────────┘
  │ Supabase │◀───────────────────────┘
  │ Database │     (direct Supabase client with service role key)
  │ + Auth   │
  │ + Realtime│    ┌──────────────────┐
  └──────────┘     │    fal.ai        │
                   │  (AI generation) │
                   └──────────────────┘
                   webhook URL points to:
                   https://your-app.vercel.app/api/webhook/fal?step=...
```

**Benefits:**
- Single codebase, single deployment (`git push` → Vercel builds everything)
- Single set of env vars (Vercel dashboard only)
- Standard Node.js/TypeScript (no Deno imports, no `Deno.serve()`)
- Built-in auth middleware for user-facing routes
- Webhook security via shared secret (fal.ai supports webhook signing)
- Better local dev: `next dev` serves everything, no `supabase functions serve`
- Vercel's edge network for global webhook reception
- Same Supabase client library (`@supabase/supabase-js`) already in use

---

## 8. Migration Plan (Option B)

### Phase 1: Webhook Handler (Critical Path) — ~2 hours

**Goal:** fal.ai callbacks land in Next.js instead of Supabase edge functions.

1. Create `/api/webhook/fal/route.ts` in Next.js
2. Port the `webhook/index.ts` handler:
   - Replace `Deno.serve()` with Next.js `POST()` export
   - Replace `Deno.env.get()` with `process.env`
   - Replace JSR imports with npm imports (`@supabase/supabase-js`, `music-metadata`)
   - Keep the step-based routing (`switch(step)`) — it's clean
3. Add webhook secret validation (optional but recommended):
   ```ts
   const secret = req.headers.get('x-fal-webhook-secret');
   if (secret !== process.env.FAL_WEBHOOK_SECRET) {
     return new Response('Unauthorized', { status: 401 });
   }
   ```
4. Test locally with a tunnel (ngrok/cloudflare tunnel) to receive fal.ai callbacks
5. Deploy to Vercel

### Phase 2: Inline Orchestrators — ~3 hours

**Goal:** Remove the Next.js → Supabase edge function hop. Inline the logic.

Functions to inline (they're already called from Next.js routes):

| Edge Function | Inline Into | Notes |
|---|---|---|
| `start-workflow` | `/api/storyboard/approve/route.ts` | Already called from here |
| `start-ref-workflow` | `/api/storyboard/approve/route.ts` | Already called from here |
| `approve-grid-split` | `/api/storyboard/approve-grid/route.ts` | Already called from here |
| `approve-ref-split` | `/api/storyboard/approve-ref-grid/route.ts` | Already called from here |

For each:
1. Copy the business logic from the edge function into the existing Next.js route
2. Remove the `fetch()` call to the edge function
3. The route already has Supabase client access — just use it with service role key
4. Update webhook URLs from `${SUPABASE_URL}/functions/v1/webhook` to `${VERCEL_URL}/api/webhook/fal`

### Phase 3: Port Frontend-Called Functions — ~2 hours

Functions called directly by the frontend:

| Edge Function | New Next.js Route |
|---|---|
| `generate-tts` | `/api/workflow/tts/route.ts` |
| `generate-video` | `/api/workflow/video/route.ts` |
| `generate-sfx` | `/api/workflow/sfx/route.ts` |
| `edit-image` | `/api/workflow/edit-image/route.ts` |
| `poll-skyreels` | `/api/workflow/poll-skyreels/route.ts` |

For each:
1. Create the Next.js route
2. Port the logic (mechanical translation — same patterns)
3. Update frontend to call new routes instead of Supabase function URLs
4. Add auth middleware (user must be authenticated)

### Phase 4: Cleanup — ~1 hour

1. Remove `supabase/functions/` directory
2. Remove Supabase edge function config from `config.toml`
3. Remove `NEXT_PUBLIC_SUPABASE_ANON_KEY` usage for edge function auth workaround
4. Update any documentation
5. Remove Supabase CLI dependency for function deployment

### Total Migration Effort: ~8 hours (1 developer-day)

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Vercel timeout on batch operations (>10 scenes) | Medium | Medium | Use Vercel Pro (60s) or split into individual requests from frontend |
| fal.ai webhook URL change breaks in-flight jobs | Low | High | Deploy webhook handler first, keep edge function running in parallel for 24h |
| Supabase service role key exposure in Vercel logs | Low | High | Use Vercel's encrypted env vars, never log the key |
| Webhook endpoint abuse (no fal.ai secret) | Medium | Low | Implement fal.ai webhook signing or IP allowlist |
| `music-metadata` npm version incompatibility | Very Low | Low | Already standard npm package, tested in Node.js |
| Frontend calls to old Supabase function URLs after migration | Low | Medium | Update all fetch URLs, search codebase for `functions/v1/` |

### Migration Risk Mitigation Strategy

1. **Run both systems in parallel** during migration (old Supabase functions + new Next.js routes)
2. **Update webhook URLs incrementally** — change one step handler at a time
3. **Feature flag** — env var `USE_NEXTJS_WEBHOOKS=true` to toggle between old and new
4. **Monitor fal.ai webhook delivery** — check for 4xx/5xx responses
5. **Keep Supabase edge functions deployed** for 1 week after full migration as fallback

---

## 10. Summary

| | Recommendation |
|---|---|
| **Get unblocked today** | Deploy Supabase edge functions as-is (verify_jwt=false). ~1 hour. |
| **Ideal architecture** | Move everything to Next.js API routes. ~8 hours. |
| **Why** | Single codebase, single deployment, standard TypeScript, better DX, eliminates JWT/CORS workarounds |
| **What stays in Supabase** | Database, Auth, Realtime subscriptions — its core strengths |
| **What leaves Supabase** | Edge Functions — replaced by Vercel serverless functions |
| **Key insight** | 9 of 10 edge functions are already called FROM Next.js routes. The proxy hop adds complexity with zero benefit. The 1 webhook function is a perfect fit for Vercel serverless. |
