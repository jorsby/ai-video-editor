# LTX Desktop Day 1 Kickoff (2026-03-12)

## Scope
Day 1 execution for LTX-Desktop experiment:
1. Fork/clone Lightricks/LTX-Desktop
2. Validate local setup viability on this Mac (API-only path)
3. Capture evidence + immediate next steps

---

## Environment
- Host: Serhat’s MacBook Pro (Apple Silicon)
- Working dir: `/Users/serhatcamici/Development`
- Time: `2026-03-12 11:36 EDT`

---

## Commands Attempted + Outcomes

### 1) GitHub auth check
```bash
gh auth status
```
**Result:** ✅ Success
- Logged in as `jorsby`
- Token scopes include `repo`

### 2) Fork + clone (requested path)
```bash
gh repo fork Lightricks/LTX-Desktop --clone=true --remote=true
```
**Result:** ✅ Success
- Fork created: `https://github.com/jorsby/LTX-Desktop`
- Repo cloned locally (initial folder: `LTX-Desktop`)

### 3) Enforce dedicated local folder name
```bash
mv LTX-Desktop ltx-desktop
```
**Result:** ✅ Success
- Final local path: `/Users/serhatcamici/Development/ltx-desktop`

### 4) Verify remotes
```bash
cd /Users/serhatcamici/Development/ltx-desktop
git remote -v
git branch -vv
```
**Result:** ✅ Success
- `origin` → `https://github.com/jorsby/LTX-Desktop.git`
- `upstream` → `https://github.com/Lightricks/LTX-Desktop.git`
- Branch: `main` tracking `origin/main`

### 5) Dev setup from README
```bash
pnpm setup:dev
```
**Result:** ✅ Success
Key readiness signals captured:
- Node / pnpm / uv checks passed
- `pnpm install complete`
- Python venv created and `uv sync complete`
- `MPS available: True`
- `ffmpeg found`
- Final message: `Setup complete! Run the app with: pnpm dev`

### 6) Smoke start from README
```bash
pnpm dev
```
**Result:** ✅ Smoke-success (short verification)
Readiness signal captured:
- `VITE v5.4.21 ready`
- `Local: http://localhost:5173/`
- Electron bundles built (`dist-electron/main.js`, `dist-electron/preload.js`)

---

## API-only Mode Viability on This Mac

**Status:** ✅ Viable for Day 1 setup/smoke.

Evidence:
- README explicitly marks macOS as **API-only** mode
- Full dependency/bootstrap flow completed on this machine
- Dev server reached ready state without setup errors

Important caveat for actual video generation:
- macOS path requires an **LTX API key** for API-backed generation.

---

## Blockers / Required Input

No hard blocker for Day 1 kickoff.

For Day 2 functional generation testing, required from Serhat:
1. A test **LTX API key** (can be free key from LTX Console)
2. (Optional) fal key only if testing Z Image Turbo text-to-image path

---

## Day 1 Gate Status

**Gate result: PASS** ✅

Reason:
- Fork + clone completed
- Local setup completed
- Dev smoke start produced readiness signal
- macOS API-only constraints identified and documented

---

## Recommended Immediate Day 2 Start Commands

```bash
# 1) Enter repo
cd /Users/serhatcamici/Development/ltx-desktop

# 2) Start app
pnpm dev

# 3) In-app: add LTX API key in settings
# (manual UI step)

# 4) Run first API-mode validation flow
# - text-to-video minimal prompt
# - capture request/response behavior and output path

# 5) Optional deeper checks
pnpm typecheck
pnpm backend:test
```

---

## Proof Paths
- Local cloned repo: `/Users/serhatcamici/Development/ltx-desktop`
- Research note: `/Users/serhatcamici/Development/ai-video-editor/docs/research/ltx-desktop-day1.md`
