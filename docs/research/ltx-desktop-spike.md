# LTX-Desktop Integration Spike (Editor Shell Only)

## Scope
Evaluate whether we can use **LTX-Desktop UI/editor as the shell** while keeping our existing backend stack:
- Next.js API routes
- Supabase persistence
- Existing async generation orchestration (fal queue + webhook + polling fallback)

Out of scope: switching to LTX generation backend.

## Added product requirements (must-haves)
1. Support **multiple generation models in full API mode** (not tied to one vendor).
2. Support storyboard flows for all 3 workflows:
   - i2v (legacy)
   - i2v (new refs-based)
   - ref2v (direct)
3. Support subtitling workflow.
4. Clarify media handling architecture (URL-based vs local file assets) and recommend rollout order.

---

## 1) Feasibility verdict

## **Verdict: YELLOW (feasible with constrained scope)**

### Why yellow (not green)
- LTX Desktop is tightly coupled to:
  - **Electron bridge** (`window.electronAPI`) for startup, filesystem, export, dialogs, backend credentials.
  - A **local FastAPI contract** (`/api/generate`, `/api/generation/progress`, `/api/settings`, `/api/models/*`, etc.).
- Our generation model is different:
  - LTX expects mostly **single-request generation flow** + progress endpoint.
  - We run **multi-entity async pipeline** (`storyboards` -> `grid_images` -> `scenes`/`first_frames`/`voiceovers` -> `video/sfx`) with webhook completion and DB status transitions.

### Why not red
- LTX frontend is React/TS and open-source (Apache-2.0), so shell reuse is legally and technically possible.
- We already have compatible primitives in our stack:
  - Project/timeline persistence (`projects`, `tracks`, `clips` + timeline service)
  - Asset persistence (`assets`)
  - Rich storyboard/scene workflow tables and APIs
  - Realtime status from Supabase + polling fallback

**Bottom line:** low-risk experimentation is realistic if we treat LTX as a **UI donor/shell subset**, not a full drop-in replacement.  
Feasibility stays **YELLOW** until multi-model API abstraction + all 3 storyboard workflows + subtitle path are proven in spike acceptance tests.

---

## 2) Integration architecture options

## Option A — API Adapter Proxy (LTX compatibility layer)
Required by request.

### Idea
Keep most LTX frontend behavior; add a compatibility API that mimics LTX backend responses while calling our existing APIs behind the scenes.

### Shape
- New compatibility namespace in Next app (example): `/api/ltx/*`
- Provide LTX-like endpoints:
  - `POST /api/ltx/generate` -> call our `/api/workflow/video` (or `/api/workflow/ref-first-frame` for image-first flows)
  - `GET /api/ltx/generation/progress` -> aggregate `scene.video_status` / `storyboard.plan_status` from Supabase
  - `POST /api/ltx/generate/cancel` -> best-effort soft cancel (mark local session as canceled; true upstream cancellation currently missing)
  - `GET/POST /api/ltx/settings`, `GET /api/ltx/runtime-policy`, `GET /api/ltx/models*` -> static/derived responses
- Add minimal `electronAPI` shim for web mode (or run inside Electron wrapper with custom preload)
- Add a **provider registry** in adapter (`provider + model`), routing to existing workflow endpoints so model expansion is config-driven (fal, skyreels, future providers)

### Pros
- Fastest path to seeing LTX shell with minimal front-end edits.
- Safer rollback (remove adapter, keep core app intact).

### Cons
- You maintain a translation layer forever unless later rewritten.
- Semantic mismatches (sync-like LTX generate vs our async scene jobs) can create brittle UX.

---

## Option B — Direct Frontend API Rewiring
Required by request.

### Idea
Fork/selectively copy LTX editor UI modules and replace `backendFetch` + Electron assumptions with our API clients and Supabase hooks.

### Shape
- Replace LTX app boot logic (Python/backend setup, models download, first-run license gates).
- Rewire generation hooks to:
  - `/api/storyboard/*`
  - `/api/workflow/*`
  - `/api/webhook/fal` + `/api/workflow/poll-fal`/`poll-skyreels`
- Replace LTX `ProjectContext` localStorage model with our Supabase-backed project/timeline model.
- Introduce shared frontend model catalog (`provider/model/capabilities`) so UI can select models without vendor-specific coupling.

### Pros
- Better long-term maintainability.
- Avoids maintaining fake compatibility responses.

### Cons
- Higher initial engineering risk and integration surface.
- More upfront refactor/testing before any demo.

---

## Option C — Hybrid (recommended for low-risk spike)
Use **only LTX Video Editor shell components**, keep our existing storyboard generation UI untouched.

### Why this is best for speed
- Avoids hardest contract mismatch (`/api/generate`, models/runtime-policy setup flows).
- Focuses on where LTX adds value: editor UX/timeline ergonomics.
- Leverages our existing persistence (`tracks`/`clips`, `assets`, `projects`).
- Keeps current storyboard routes as source of truth, which already separate i2v legacy/refs-based/ref2v behavior via `mode` + `workflow_variant`.

---

## 3) Exact mapping table (LTX -> our equivalents)

## A) Entity/Data mapping

| LTX Desktop entity | LTX meaning | Our equivalent | Mapping notes |
|---|---|---|---|
| `Project` | Container for assets + timelines | `projects` row | 1:1 for project container |
| `Project.assets[]` | Generated/imported media list | `assets` + generated outputs from `scenes.video_url`, `voiceovers.audio_url`, `first_frames.final_url` | Need normalization layer to form LTX `Asset` shape |
| `Timeline` | Tracks + clips | `tracks` + `clips` tables (via `timeline-service.ts`) | Strong fit (both are track/clip based) |
| `TimelineClip` | Clip placement/edit metadata | `clips.data` JSON (openvideo clip JSON) | Requires field transform for LTX clip attributes |
| `GenerationParams` (per asset) | Regeneration metadata | `storyboards.plan`, `scenes.prompt`, `video_model`, `voiceovers` | Not 1:1; derive/store adapter metadata |
| LTX localStorage `ltx-projects` | Local persistence | Supabase persistence (server auth) | Must replace localStorage-first assumptions |
| LTX `video_path`/`image_path` local files | Local FS paths | Remote URLs + proxy URLs (`/api/proxy/media`) | Need URL-first abstraction; no file-path guarantee |

## B) Endpoint mapping

| LTX endpoint | LTX contract | Our closest equivalent | Gap / transform needed |
|---|---|---|---|
| `POST /api/generate` | Start video gen, returns terminal status/video_path | `POST /api/workflow/video` | Ours is queued async per scene; adapter must translate to job/session view |
| `GET /api/generation/progress` | Global progress state | Supabase status aggregation + `/api/workflow/poll-fal` + `/api/workflow/poll-skyreels` | Need synthetic progress model (`phase`, `progress`) |
| `POST /api/generate/cancel` | Cancel current generation | **No first-class cancel route** | Major gap (soft-cancel only unless new backend work) |
| `POST /api/generate-image` | Image generation | `POST /api/workflow/ref-first-frame` or `POST /api/storyboard/regenerate-grid` | Depends on mode; not single universal endpoint |
| `POST /api/retake` | Partial regenerate workflow | `POST /api/workflow/video` with scene-level targeting + edit-image routes | Semantics differ; needs UX reinterpretation |
| `GET/POST /api/settings` | App/backend settings | No direct equivalent | Adapter can return derived/static settings |
| `GET /api/runtime-policy` | Force API/local mode policy | No direct equivalent | Adapter static response |
| `GET /api/models*` + download | Model inventory/download progress | No equivalent in our hosted flow | Stub/disable in shell |
| `GET /health` | Backend health | `GET /api/health` | Straightforward map |
| `POST /api/suggest-gap-prompt` | Prompt helper | No direct dedicated endpoint | Could map to internal chat/gen helper later |

## C) Status/state mapping

| LTX state | Our state(s) | Notes |
|---|---|---|
| `phase=validating_request` | request validation in `/api/workflow/*` | adapter-generated |
| `phase=uploading_*` | N/A (mostly URL-based inputs) | usually skip or synthesize |
| `phase=inference` | `grid_images/first_frames/scenes/voiceovers` status=`processing` | derived from entity status |
| `status=complete` | `scene.video_status=success` (or relevant target success) | per-scene vs global mismatch |
| `status=failed` | `*_status=failed` + error fields | map table-specific error |
| `status=cancelled` | no hard cancel primitive | requires synthetic canceled state |
| Storyboard planning | `storyboards.plan_status` (`draft`,`generating`,`grid_ready`,`splitting`,`approved`,`failed`) | richer than LTX single progress channel |

## D) Required workflow coverage mapping (must-have)

| Required workflow | Current backend support | Shell integration implication |
|---|---|---|
| i2v (legacy) | `storyboard.mode=image_to_video` + `approve-grid` + scene `first_frames` -> `/api/workflow/video` | Keep existing storyboard creation/approval screens; shell should consume resulting scenes/assets |
| i2v (new refs-based) | `mode=ref_to_video` + `workflow_variant=i2v_from_refs` + refs split/edit flow | Must expose refs objects/backgrounds state and still call i2v video path where configured |
| ref2v (direct) | `mode=ref_to_video` + `workflow_variant=direct_ref_to_video` + model-specific ref video route | Must preserve direct ref prompts/elements and direct model selection |

**Concrete recommendation:** during spike, do not collapse these into one generic “generate” action. Keep explicit workflow selector and map each to current API path to avoid regressions.

## E) Subtitling workflow fit

| Capability | Current state | Integration implication |
|---|---|---|
| Subtitle generation source | `/api/transcribe` exists; timeline supports caption/text style primitives | Add subtitle import command into shell (create/update caption clips on dedicated subtitle track) |
| Subtitle editing | LTX shell has timeline subtitle structures; our editor stack supports caption clips | Define one canonical subtitle storage format (timeline clip JSON) and bridge both UIs to it |
| Multi-language subtitles | Our pipeline already has language-aware voiceovers/tracks patterns | Start with single-language subtitle MVP; add language switching after basic flow is stable |

## F) Multi-model full API support (must-have)

### Concrete recommendation
Implement a **provider-agnostic model registry** in our shell integration layer:
- Registry row shape: `{ provider, modelKey, capabilities, routeStrategy }`
- `capabilities`: `i2v_legacy`, `i2v_refs`, `ref2v_direct`, `tts`, `sfx`, `image_edit`
- `routeStrategy`: maps model to our existing Next routes + payload transformers

Do not hardcode vendor branches in UI components. UI should only read capability flags and available models.

### Implications
- Short-term: small adapter work, cleaner model picker, faster provider expansion.
- Medium-term: we can add/retire providers without rewriting shell screens.
- Risk if skipped: hidden vendor lock and repeated branching bugs.

## G) Media handling architecture (URL vs local file assets)

### Recommendation (speed + reliability)
1. **Phase 1 (spike + pilot): URL-first assets only**
   - Canonical media references are HTTPS URLs (or proxied URLs).
   - Persist URLs in `assets`/timeline clip data.
   - Keep playback/export web-safe and stateless.
2. **Phase 2 (optional optimization): local cache/mirror**
   - Add background download/cache for heavy media in desktop builds.
   - Keep URL as source of truth; local path is an optional acceleration layer.

### Why URL-first first
- Matches current backend outputs (`video_url`, `audio_url`, `final_url`).
- Avoids brittle `file://` and OS path portability issues.
- Lower integration risk with Supabase + web clients.

### Implications
- Need robust signed/proxied URL handling and expiry refresh strategy.
- Export flows requiring local files can use temp download pipeline when needed.

---

## 4) Top 10 blockers/risks + mitigation

1. **Electron hard dependency (`window.electronAPI`)**  
   - Mitigation: web shim with no-op/file-dialog fallbacks; gate unsupported features.

2. **LTX app startup assumes local Python/backend lifecycle**  
   - Mitigation: bypass first-run/setup views; boot directly into project/editor shell.

3. **Generation contract mismatch (single request vs async pipeline)**  
   - Mitigation: adapter session layer that tracks one logical job across our scene statuses.

4. **No true cancel API in current workflow routes**  
   - Mitigation: mark session canceled in adapter UI; schedule real cancellation capability as follow-up.

5. **Local file-path assumptions (`video_path`, `file://`)**  
   - Mitigation: URL-first asset model + download/export endpoints where needed.

6. **Full API multi-model abstraction is not native in LTX shell**  
   - Mitigation: add provider/model registry + capability matrix (`supports_i2v_legacy`, `supports_i2v_refs`, `supports_ref2v`, `supports_sfx`) and drive UI options from it.

7. **Auth mismatch (LTX shared-token backend vs Supabase user auth)**  
   - Mitigation: keep Supabase auth as source of truth; adapter runs behind authenticated Next routes.

8. **Subtitle workflow mismatch risk (generation/edit/storage not unified yet)**  
   - Mitigation: pick one subtitle source of truth (timeline clip JSON + subtitle track) and implement one-way import first (`/api/transcribe` -> subtitle clips), then editing parity.

9. **Upstream churn (LTX frontend under active refactor)**  
   - Mitigation: vendor pinned commit; avoid deep coupling to unstable modules.

10. **Progress UX reliability (webhook delays/failures)**  
    - Mitigation: use existing fallback polling endpoints and explicit stale-timeout states.

---

## 5) Minimal 3-day spike plan (measurable exits)

## Day 1 — Shell boot + persistence bridge
- Mount LTX editor shell route in a branch (web mode).
- Implement minimal `electronAPI` shim to prevent crashes.
- Replace localStorage projects with read/write to our `projects` (+ timeline load/save path).

**Exit criteria:**
- Open shell route without fatal console errors.
- Create/open project; save and reload timeline successfully.

## Day 2 — Generation adapter + multi-model matrix
- Implement `/api/ltx/generate` + `/api/ltx/generation/progress` compatibility endpoints.
- Add provider/model capability registry (full API mode, vendor-agnostic).
- Wire all three storyboard workflows explicitly:
  - i2v legacy
  - i2v refs-based
  - ref2v direct

**Exit criteria:**
- Trigger generation from shell and observe progress updates.
- Demonstrate one successful run per workflow type (3/3).
- Terminal success state shows playable video URL in editor assets.

## Day 3 — Storyboard import + subtitles + decision demo
- Add importer: storyboard scenes -> editor assets/clips timeline.
- Add subtitle MVP path (`/api/transcribe` result -> subtitle track clips).
- Validate save/reload and one regenerate loop.
- Document unsupported features and final go/no-go score.

**Exit criteria:**
- Import >=3-scene storyboard to timeline automatically.
- Save/reload keeps clip order/timing.
- Subtitle track can be created and edited for at least one clip.
- One regenerate cycle updates asset in timeline.

---

## 6) Recommended go/no-go decision framework

Use these hard gates after spike:

### Must-pass gates
1. **Boot stability:** no blocker crashes in 30-min exploratory session.
2. **Persistence integrity:** timeline save/load roundtrip succeeds 3/3 times.
3. **Multi-model API mode:** model picker is registry-driven (not hardcoded to one provider) and at least 2 providers are selectable in config.
4. **Workflow coverage:** i2v legacy + i2v refs-based + ref2v direct each complete at least one successful run.
5. **Subtitling MVP:** transcript -> subtitle track -> manual edit -> save/reload works end-to-end.
6. **Media strategy compliance:** URL-first asset flow works for generation, playback, and timeline persistence.
7. **Auth safety:** all calls are user-scoped via Supabase auth (no cross-user leakage).
8. **UX latency:** progress updates visible within <=5s cadence during processing.

### Decision
- **GO (pilot):** all 8 gates pass.
- **NO-GO (defer):** any security, persistence, or workflow-coverage gate fails.
- **CONDITIONAL GO:** only non-critical UX polish gates fail, with concrete fix plan <=1 week.

---

## 7) Rough effort estimate

Assuming 1 senior FE + 1 senior full-stack support.

- **POC (adapter/hybrid scope):** ~2 to 4 weeks
  - Shell boot + shim: 2–4 days
  - Multi-model registry + compat endpoints + progress mapping: 4–7 days
  - 3-workflow coverage wiring (i2v legacy/refs, ref2v direct): 3–5 days
  - Storyboard import + subtitle MVP + timeline persistence glue: 3–5 days

- **Production hardening:** ~6 to 10 weeks
  - Robust cancel/retry semantics
  - Full auth/security review
  - Error-state UX + observability
  - Regression test coverage
  - Upgrade strategy for upstream LTX changes

---

## Recommendation
Proceed with a **3-day hybrid spike** (Option C) and keep Option A adapter minimal.  
Do **not** commit to full direct rewiring (Option B) until spike gates pass and real UX value is proven.

### Concrete product recommendation
- Ship shell integration in **full API mode with provider-agnostic model registry**.
- Keep **all 3 storyboard workflows** explicit in UX and routing (no premature unification).
- Ship **subtitle MVP** in spike scope (transcribe -> subtitle track -> edit -> persist).
- Standardize on **URL-first media architecture** now; defer local file cache/mirror to phase 2 optimization.

### Key implications
- Faster, safer pilot with less platform-specific fragility.
- Better future provider flexibility (reduced vendor lock).
- Requires stronger URL lifecycle handling (signed URL refresh/proxy) to keep playback/export reliable.

If spike passes these requirements, continue with adapter/hybrid pilot. If it fails on workflow coverage, subtitles, or persistence, no-go and keep improving current native editor UX.

---

## Evidence reviewed (code/docs)
- LTX Desktop README + architecture + endpoint surface (`backend/_routes/*`, `frontend/lib/backend.ts`, `frontend/hooks/use-generation.ts`, `frontend/contexts/ProjectContext.tsx`, `frontend/types/project.ts`)
- Our workflow stack (`editor/src/app/api/storyboard/*`, `editor/src/app/api/workflow/*`, `editor/src/app/api/webhook/fal/route.ts`, `editor/src/lib/supabase/workflow-service.ts`, `editor/src/lib/supabase/timeline-service.ts`)
