# LTX-Desktop Adoption Plan (API-only Generation, Minimal Fork)

**Date:** 2026-03-12  
**Owner:** Engineering research

## A) Final recommendation (GO / NO-GO)

## Decision: **Conditional GO**
Adopt **LTX-Desktop as the editor shell** if (and only if) we keep all generation logic behind an additive backend seam and avoid edits to LTX `gen-space` core.

### Options compared (3)
| Option | Summary | Pros | Cons | Verdict |
|---|---|---|---|---|
| 1) Hard fork LTX + bake providers directly into client | Modify LTX internals for each model/subtitle path | Fastest first demo | High merge pain, vendor lock-in in UI layer | **No-go** |
| 2) **Thin fork + backend seam (recommended)** | Keep LTX editor intact; add shell adapter + new API routes | Lowest upstream divergence, vendor-agnostic backend, clearer ownership | Requires disciplined API contracts | **GO** |
| 3) Build custom editor from scratch | Recreate timeline/editor UX ourselves | Full control | Slowest, highest risk, loses LTX velocity | **No-go** |

### GO conditions
1. `gen-space` core remains untouched (or <= trivial config-level patch).
2. All 3 storyboard modes run through additive `/api/ltx/*` routes.
3. One subtitle flow (transcribe -> editable cues -> burn/export) works end-to-end.
4. Provider switch (at least 2 vendors) works without UI changes.
5. Spike shows upstream merge viability (clean rebase/cherry-pick path).

---

## B) Target architecture diagram (text)

```text
[LTX-Desktop UI (timeline, assets, edit tools)]
                  |
                  | (shell adapter only: action mapping, feature flags)
                  v
         [LTX Integration Layer in app]
                  |
                  | HTTP (canonical contracts)
                  v
      [BFF /api/ltx/*  (additive routes only)]
        |            |             |
        |            |             +--> [Subtitle service adapter]
        |            +-----------------> [Storyboard orchestrator]
        +------------------------------> [Model Router]
                                             |
                           +-----------------+------------------+
                           |                                    |
                  [Vendor Adapter A]                    [Vendor Adapter B]
                           |                                    |
                      External APIs                        External APIs

State + assets:
- Job/state store (existing app DB; Supabase behind server boundary if used)
- Asset store (S3/R2/signed URLs)
- Webhooks/callbacks -> /api/ltx/webhooks/:vendor -> job status updates
```

**Key rule:** LTX client never calls vendor APIs directly; only `/api/ltx/*`.

---

## C) Endpoint + data model mapping

### Endpoint mapping (additive seam)
| Capability | Existing app surface (today) | New additive route (proposed) | Notes |
|---|---|---|---|
| Create storyboard draft | `/api/storyboard` | `POST /api/ltx/storyboards` | Canonical request includes `mode`, `modelPreference`, `voiceover`, `refs[]`. |
| Approve storyboard | `/api/storyboard/approve`, `/approve-grid`, `/approve-ref-grid` | `POST /api/ltx/storyboards/:id/approve` | Route internally dispatches by mode. |
| i2v legacy | `image_to_video` path in storyboard/workflow | `POST /api/ltx/generate/i2v-legacy` | Grid-first legacy path. |
| i2v new (refs-based) | `workflow_variant=i2v_from_refs` | `POST /api/ltx/generate/i2v-refs` | Uses refs to generate first frames, then video. |
| ref2v direct | `workflow_variant=direct_ref_to_video` | `POST /api/ltx/generate/ref2v` | Direct reference-to-video path. |
| Video job status | `/api/workflow/poll-*`, db subscriptions | `GET /api/ltx/jobs/:jobId` | Single vendor-neutral status schema. |
| Vendor callbacks | `/api/webhook/fal` etc. | `POST /api/ltx/webhooks/:vendor` | Normalize payload -> canonical job state. |
| Subtitle transcription | `/api/transcribe` | `POST /api/ltx/subtitles/transcribe` | Reuse underlying transcribe service via adapter. |
| Subtitle cue update | (none unified) | `PATCH /api/ltx/subtitles/:trackId/cues` | Editor edits pushed as structured cues. |
| Subtitle burn/export | (mixed render paths) | `POST /api/ltx/subtitles/burn` | Returns rendered asset/job id. |

### Canonical data model mapping
| Canonical entity | Required fields | Maps to current concepts |
|---|---|---|
| `Storyboard` | `id, projectId, mode, variant, plan, status, modelPolicy` | `storyboards` row + `plan` JSON + `plan_status` |
| `Scene` | `id, storyboardId, order, prompt, refs[], durationSec` | `scenes` + `first_frames` + object/background links |
| `Asset` | `id, type(image/video/audio/subtitle), source(url/file), url, mime, checksum` | `assets` + grid/first-frame/object/background URLs |
| `GenerationJob` | `id, type(i2v/ref2v/subtitle), provider, providerJobId, status, inputRef, outputRef, error` | existing workflow request ids + webhook status fields |
| `SubtitleTrack` | `id, projectId, language, cues[{start,end,text}], stylePreset, status` | transcription cache + caption track representation |

---

## D) URL-vs-file asset policy (recommended)

1. **Default policy: URL-first canonical assets.** Persist durable signed/public URLs in backend state.  
2. **Client file uploads are ingress only.** Files are immediately uploaded to object storage; backend returns canonical URL + checksum.  
3. **Generation APIs accept both** `{url}` and `{fileToken}`, but normalize to URL before orchestration.  
4. **Refs-based modes require stable URLs** (no blob/local paths) to keep retries/webhooks deterministic.  
5. **Never pass raw file bytes through LTX core paths** after ingest; pass references only.

This keeps LTX integration thin, improves reproducibility, and avoids provider-specific multipart complexity in the editor shell.

---

## E) Minimal fork policy (merge-safe)

### Allowed changes
- New integration module(s) around LTX shell (action mapping, feature flags, API client).
- New UI panels/buttons for Storyboard Modes + Subtitles (extension points only).
- Config/env wiring and route clients for `/api/ltx/*`.

### Disallowed changes
- No invasive edits to LTX timeline engine, renderer internals, or `gen-space` core logic.
- No provider-specific business logic inside LTX core packages.
- No schema drift in upstream LTX entities unless done via local adapter transform.

### Governance
- Keep fork delta auditable (`fork-diff.md` updated each PR).
- Prefer patch files/wrapper composition over source rewrites.
- Rebase against upstream weekly during implementation window.

---

## F) 3-day spike plan + acceptance gates

## Day 1 — Seam + shell wiring
- Stand up `/api/ltx/*` scaffold with canonical `GenerationJob` responses.
- Wire LTX shell adapter to call seam routes (stub backend allowed).
- Add feature flags: `ltxStoryboardModes`, `ltxSubtitles`, `ltxModelRouter`.

**Gate 1 (must pass):**
- LTX editor runs with no `gen-space` edits.
- One create->approve storyboard call path works via additive route.

## Day 2 — 3 mode execution contracts
- Implement orchestration for:
  - `i2v-legacy`
  - `i2v-refs`
  - `ref2v`
- Normalize callbacks to canonical `GenerationJob` status.

**Gate 2 (must pass):**
- All 3 mode requests enqueue and return normalized status.
- At least one mode produces playable output in editor preview.

## Day 3 — Subtitle vertical slice + merge-risk check
- Add transcribe -> cue edit -> burn/export flow via `/api/ltx/subtitles/*`.
- Run upstream divergence check and document exact fork diff.

**Gate 3 (must pass):**
- Subtitle track can be generated, edited, and rendered once end-to-end.
- Fork delta remains confined to integration layer + additive UI/extensions.
- Go/No-go report produced with blocker list.

---

## G) 2-week implementation roadmap (if spike passes)

## Week 1 (Days 1-5): solidify backend seam + mode completeness
1. Finalize canonical API contracts + Zod validation.
2. Complete production handling for all 3 modes (retries, idempotency, webhook auth).
3. Implement model router abstraction (`provider`, `model`, `capabilities`) with at least 2 vendors.
4. Build asset ingest pipeline (file->URL normalization, checksum/dedupe).
5. Add observability: job timeline logs, failure taxonomy, per-vendor metrics.

## Week 2 (Days 6-10): subtitles + hardening + merge readiness
1. Subtitle UX polish (cue list, timing nudge, style presets).
2. Subtitle burn/export reliability + timeout/retry strategy.
3. E2E tests: 3 storyboard modes + subtitle path + provider failover.
4. Performance pass (queue latency, upload throughput, preview responsiveness).
5. Upstream sync rehearsal + release checklist + operator runbook.

---

## H) Supabase decision (now vs later)

**Decision:**
- **Now (for adoption spike + initial rollout):** Do **not** make Supabase a hard architectural dependency of the LTX integration layer. Keep persistence behind backend interfaces so the shell is backend-agnostic.
- **Pragmatic implementation:** If existing product services already use Supabase, continue using it **server-side only** for jobs/state/assets metadata; do not expose Supabase coupling to LTX client contracts.
- **Later:** Re-evaluate Supabase features (Realtime/collab/audit) after core generation + subtitle reliability is proven.

This gives simplicity now, preserves optionality later, and minimizes rework if backend strategy changes.

---

## Bottom line
Proceed with a **conditional GO** using a **thin-fork + additive backend seam** strategy. If spike gates fail (especially `gen-space` isolation or 3-mode/subtitle viability), stop and reassess before committing to full migration.