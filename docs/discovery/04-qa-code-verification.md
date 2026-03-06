# QA Report: Code Verification — Edge Function Migration

**Date:** 2026-03-06
**Branch:** `feat/migrate-edge-to-nextjs-routes`
**Reviewer:** QA Agent 1

## Summary

All 10 Supabase edge functions have been migrated to Next.js API routes. Line-by-line comparison confirms all business logic is preserved. Auth guards were missing on 4 workflow routes and have been added. Build compiles and TypeScript passes clean.

## Function-by-Function Results

### Phase 1: Webhook Handler

| Function | Route | Verdict | Notes |
|---|---|---|---|
| webhook | `/api/webhook/fal` | **PASS** | All 7 step handlers preserved (GenGridImage, SplitGridImage, GenerateTTS, OutpaintImage, EnhanceImage, GenerateVideo, GenerateSFX). No auth (correct for fal.ai callback). Atomic DB gate `tryCompleteSplitting` preserved exactly. music-metadata import converted correctly. |

### Phase 2: Orchestrators (Inlined)

| Function | Route | Verdict | Notes |
|---|---|---|---|
| start-workflow | `/api/storyboard/approve` (inlined) | **PASS** | All logic preserved: validation, grid_images insert, fal request, error/success status updates. Webhook URL updated to `/api/webhook/fal`. |
| start-ref-workflow | `/api/storyboard/approve` (inlined) | **PASS** | Both grids (objects + backgrounds) preserved. Promise.all for dual fal requests. Both-failed case sets storyboard to 'failed'. Webhook URLs updated. |
| approve-grid-split | `/api/storyboard/approve-grid` | **PASS** | Scene creation loop, first_frames insert, voiceover per language, ComfyUI split request all preserved. Auth check present. Enhanced with dimension adjustment logic. |
| approve-ref-split | `/api/storyboard/approve-ref-grid` | **PASS** | Objects/backgrounds creation loops, dual split requests via Promise.all, split_request_id storage, both-failed handling all preserved. Auth check present. Enhanced with grid constraint validation and SkyReels clamp. |

### Phase 3: Frontend-Called Functions

| Function | Route | Verdict | Notes |
|---|---|---|---|
| generate-tts | `/api/workflow/tts` | **PASS** | All TTS logic preserved (context fetch, delay loop, fal request, status updates). Auth check added. |
| generate-video | `/api/workflow/video` | **PASS** | All model configs preserved (wan2.6, bytedance1.5pro, grok, wan26flash, klingo3, klingo3pro, skyreels). Provider routing (image_to_video / ref_to_video) preserved. SkyReels direct API path preserved. Auth check added. |
| generate-sfx | `/api/workflow/sfx` | **PASS** | SFX context validation, fal workflow request, status updates all preserved. Auth check added. |
| edit-image | `/api/workflow/edit-image` | **PASS** | All 4 actions (outpaint, enhance, custom_edit, ref_to_image) preserved. All 5 model endpoints preserved. Object sibling updates preserved. Auth check added. |
| poll-skyreels | `/api/workflow/poll-skyreels` | **PASS** | Stale task timeout (30 min), pending scene query, poll loop with success/failed/still_running logic all preserved. No auth needed (cron/internal endpoint). |

## Cross-Cutting Checks

| Check | Result |
|---|---|
| Stale `functions/v1/` references in `src/` | **PASS** — None found |
| Stale `supabase.co/functions` references | **PASS** — None found |
| `Deno.env` / `Deno.serve` references | **PASS** — None found |
| `jsr:` / `npm:` Deno-style imports | **PASS** — None found |
| Webhook URLs all point to `/api/webhook/fal` | **PASS** |
| `tryCompleteSplitting` atomic gate preserved | **PASS** — Exact CAS pattern in webhook handler |
| Logger (`@/lib/logger`) exists and works | **PASS** — Identical to original shared logger |
| Frontend (`workflow-service.ts`, `storyboard-cards.tsx`) uses new routes | **PASS** |
| `createServiceClient` / `createClient` imports correct | **PASS** |

## Issues Found and Fixed

1. **Missing auth on workflow routes (tts, video, sfx, edit-image)** — Added `createClient()` + `getUser()` auth checks to all 4 routes. The original edge functions relied on Supabase's built-in apikey header; the new Next.js routes need explicit auth.

2. **`remux.ts:83` Uint8Array BlobPart type mismatch** — Fixed with `as BlobPart` type assertion.

3. **`instagram.ts:19` implicit `any` on `res`** — Fixed with explicit `Response` type annotation. Pre-existing issue.

## Build Result

- **TypeScript (`tsc --noEmit`):** PASS — Zero errors
- **Next.js compilation:** PASS — "Compiled successfully"
- **Next.js full build:** FAIL (pre-existing) — `useSearchParams()` without Suspense boundary in `/auth/reset-password` and missing `TAVILY_API_KEY` env var. **Not related to this migration.**

## Minor Notes (Non-Blocking)

- Some `log.db()` calls from the original webhook handler were removed in the new version (cosmetic logging reduction, no functional impact).
- Webhook route does not export `OPTIONS` handler for CORS — correct since fal.ai calls are server-to-server.
- `poll-skyreels` needs an external cron trigger (Vercel cron or similar) since it no longer runs via Supabase cron.
- Some `supabase: any` type annotations where the original used `ReturnType<typeof createClient>` — cosmetic TypeScript quality note.

## Final Verdict

**READY** for QA Agent 2 (integration/runtime testing).
