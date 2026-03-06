# QA Audit: Sharp Grid Splitter (commit d5072d2)

**Date:** 2026-03-06
**Commit:** `d5072d2` feat: replace ComfyUI grid splitting with Sharp-based auto-splitter
**Auditor:** Claude Opus 4.6

---

## 1. Code Review: `grid-splitter.ts` (470 lines)

### Histogram Projection Algorithm
- **PASS** - Column-wise and row-wise mean intensity computation is correct (lines 150-167)
- **PASS** - Separator detection uses dark/bright mode heuristic, picks best match (lines 57-76)
- **PASS** - Run-length filtering with min run length prevents noise (line 92)
- **PASS** - Merge step prevents duplicate separators within 3% proximity (lines 109-120)

### Edge Cases
- **PASS** - No separators found: stdDev < 2 returns empty array, falls back to uniform division (line 54, 200-214)
- **PASS** - Single cell: detection rejects < 2 rows/cols, falls back to uniform (lines 186-189)
- **PASS** - Very large images: no explicit size guard, but Sharp handles large images well. Memory is proportional to image size (greyscale buffer). Acceptable.
- **MINOR** - `metadata.width!` and `metadata.height!` (lines 141-142): non-null assertions. Sharp metadata for valid decoded images always has these, but a corrupt/truncated image could theoretically cause issues. Low risk since the fetch already validates response.ok.

### Out-padding with Sharp extend()
- **PASS** - `extendWith: 'mirror'` is a valid Sharp 0.34.x option (line 296)
- **PASS** - Only applied for `type === 'first_frames'` (line 288), matching the old ComfyUI node 11 behavior
- **PASS** - Default outPadding of 32px (line 266) is reasonable

### Raw Tiles + Padded Tiles
- **PASS** - Raw tiles always produced (lines 278-284)
- **PASS** - Padded tiles only for first_frames (lines 287-303)
- **PASS** - Both URLs stored in SplitTile and propagated to DB (lines 402-415)

### Type Safety
- **PASS** - 3 uses of `any` for supabase client, all with eslint-disable comments. Justified - the Supabase client generic type is unwieldy for helper functions.
- **PASS** - All function signatures are typed
- **PASS** - SplitGridInput, SplitTile, SplitGridResult interfaces are well-defined

---

## 2. Code Review: `split-grid/route.ts` (74 lines)

- **FAIL - NO AUTH CHECK** (Severity: **HIGH**)
  - File: `editor/src/app/api/split-grid/route.ts`, lines 5-10
  - The endpoint accepts POST requests with no authentication.
  - Compare with `approve-grid/route.ts` (line 9-15) which has `supabase.auth.getUser()`.
  - Anyone can call this endpoint with arbitrary imageUrl, storyboardId, gridImageId.
  - **Fix required:** Add auth check or verify this is intentionally an internal-only endpoint protected by other means (e.g., middleware, network rules).

- **PASS** - Input validation: checks required fields (line 22) and type enum (line 29)
- **PASS** - Error handling: try/catch with proper error responses (lines 66-73)
- **NOTE** - The response strips `paddedUrl` from tiles (line 60-63). This is fine for the API response but worth noting.

---

## 3. Integration Review

### `approve-grid/route.ts`
- **PASS** - Correctly imports and calls `splitGrid` instead of ComfyUI (line 5, 192)
- **PASS** - Operation is now synchronous (await splitGrid) instead of fire-and-forget webhook
- **PASS** - Handles split failure by marking first_frames as failed (lines 213-225)
- **PASS** - Updates plan_status to 'approved' on success (lines 231-234)

### `approve-ref-grid/route.ts`
- **PASS** - Correctly imports and calls `splitGrid` for both objects and backgrounds (line 5, 340-363)
- **PASS** - Uses `Promise.all` for parallel splitting (line 340)
- **PASS** - Sets plan_status to 'splitting' then 'approved' (lines 243-247, 395-399)
- **CONCERN** (Severity: **LOW**) - If only ONE of the two splits fails, the storyboard is still marked 'approved' (lines 374-399). Only both failing triggers the error path. This may be intentional (partial success is OK) but should be confirmed with the team.

### DB Compatibility
- **PASS** - `first_frames` table: updates `url`, `out_padded_url`, `grid_image_id`, `status` - matches existing schema usage in webhook handler
- **PASS** - `objects` table: updates `url`, `final_url`, `status` with `grid_position` matching - same as webhook handler
- **PASS** - `backgrounds` table: same pattern as objects

### Storage Paths
- **CHANGE** - Old ComfyUI: images stored at fal.ai CDN URLs. New: stored at `grid-tiles/{storyboardId}/{gridImageId}/tile_{r}_{c}.png` in R2
- **PASS** - This is an intentional improvement (self-hosted storage vs third-party CDN)

### Webhook Handler
- **NOTE** - `handleSplitGridImage` (webhook/fal/route.ts:347) is now dead code for new splits. However, it must remain for any in-flight ComfyUI requests that were queued before deployment. Safe to remove in a future cleanup commit after deployment stabilizes.

---

## 4. Dependency Check

- **PASS** - `sharp: ^0.34.5` in dependencies (package.json line 70)
- **PASS** - `@types/sharp: ^0.32.0` in devDependencies (package.json line 87)
- **PASS** - No other new dependencies added
- **PASS** - `editor/pnpm-lock.yaml` deletion is intentional (root lockfile `pnpm-lock.yaml` is authoritative, per commit a674a6f)

---

## 5. Build Verification

```
pnpm build → SUCCESS
```

All routes compile, no TypeScript errors. Build output confirms `/api/split-grid` is registered.

---

## 6. Unrelated Changes Check

- **PASS** - The commit diff (`git diff d5072d2^..d5072d2 --stat`) shows ONLY 7 files changed, all related to grid splitting:
  - `editor/package.json` (sharp dep)
  - `editor/src/app/api/split-grid/route.ts` (new)
  - `editor/src/app/api/storyboard/approve-grid/route.ts` (modified)
  - `editor/src/app/api/storyboard/approve-ref-grid/route.ts` (modified)
  - `editor/src/lib/grid-splitter.ts` (new)
  - `package.json` (root)
  - `pnpm-lock.yaml` (root)

- The caption-properties, text-properties, export-modal, timeline changes visible in `git status` are **uncommitted working tree changes**, NOT part of this commit. No concern.

---

## Summary of Findings

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | **HIGH** | `split-grid/route.ts` | No authentication check on public API endpoint |
| 2 | **LOW** | `approve-ref-grid/route.ts:395` | Partial split failure (1 of 2) still marks storyboard as 'approved' |
| 3 | **INFO** | `webhook/fal/route.ts:347` | `handleSplitGridImage` is now dead code; can be removed after deployment stabilizes |
| 4 | **INFO** | `grid-splitter.ts:141-142` | Non-null assertions on metadata.width/height (acceptable for valid images) |

---

## Final Verdict: NEEDS FIXES

### Required Fix (before shipping):
1. **Add auth check to `split-grid/route.ts`** - Either add `supabase.auth.getUser()` like the approve endpoints, or add a shared secret / API key check if this is meant to be called server-to-server only.

### Recommended (can ship with, fix soon):
2. **Decide on partial split failure behavior** in `approve-ref-grid/route.ts` - If intentional, add a comment. If not, mark storyboard as 'partial' or 'failed' when one split fails.

### Post-deploy cleanup:
3. **Remove dead `handleSplitGridImage`** from webhook handler after confirming no in-flight ComfyUI requests remain.
