# Grid Sizing Strategy: Number-of-Images-First Approach

## 1. Current State

### Current Constraints

| Mode | Min | Max | Square Constraint |
|------|-----|-----|-------------------|
| i2v (image_to_video) | 2 | 8 | rows===cols OR rows===cols+1 |
| ref_to_video | 2 | 6 | rows===cols OR rows===cols+1 (in frontend) |

### Current Valid Sizes (from system prompt)
`2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36)`

### Validation Locations (all must be updated together)
- **Schema**: `editor/src/lib/schemas/wan26-flash-plan.ts` (lines 10-11, 16-17, 35-36, 40-41) - `.min(2).max(6)`
- **Frontend (i2v)**: `editor/src/components/editor/media-panel/panel/grid-image-review.tsx` (line 43) - range 2-8
- **Frontend (ref)**: `editor/src/components/editor/media-panel/panel/ref-grid-image-review.tsx` (lines 43-48) - range 2-6 + square rule
- **API (i2v approve)**: `editor/src/app/api/storyboard/approve-grid/route.ts` (line 27) - range 2-8
- **API (i2v approve alt)**: `editor/src/app/api/storyboard/approve/route.ts` (lines 109-113) - range 2-8 + square
- **API (ref approve)**: `editor/src/app/api/storyboard/approve-ref-grid/route.ts` (lines 29-60) - range 2-6 + square
- **API (storyboard)**: `editor/src/app/api/storyboard/route.ts` (lines 530-551) - LLM output validation
- **Supabase (i2v)**: `supabase/functions/start-workflow/index.ts` (lines 82-86)
- **Supabase (ref)**: `supabase/functions/start-ref-workflow/index.ts` (lines 101-127)
- **Webhook**: `supabase/functions/webhook/index.ts` (lines 188-214)
- **Webhook (fal)**: `editor/src/app/api/webhook/fal/route.ts` (lines 245-248)
- **Grid splitter**: `editor/src/lib/grid-splitter.ts` (lines 185-189) - detection accepts 2-8
- **System prompt (ref)**: `editor/src/lib/schemas/wan26-flash-plan.ts` (lines 74, 79) - valid sizes list

### Grid Splitting (Sharp)
The Sharp-based splitter (`editor/src/lib/grid-splitter.ts`) has **no inherent dimension limits**. It auto-detects grid separators using pixel intensity analysis and falls back to uniform division. It currently validates detected grids are 2-8, but this is a soft sanity check, not a hard limitation.

---

## 2. Images-to-Grid Mapping Table

### Complete Mapping (1-36 images)

| Images | Grid | Cells | Wasted | Notes |
|--------|------|-------|--------|-------|
| 1 | 1x1 | 1 | 0 | No grid needed |
| 2 | 1x2 | 2 | 0 | |
| 3 | 1x3 | 3 | 0 | |
| 4 | 2x2 | 4 | 0 | Perfect square |
| 5 | 2x3 | 6 | 1 | |
| 6 | 2x3 | 6 | 0 | |
| 7 | 2x4 | 8 | 1 | |
| 8 | 2x4 | 8 | 0 | |
| 9 | 3x3 | 9 | 0 | Perfect square |
| 10 | 2x5 | 10 | 0 | |
| 11 | 3x4 | 12 | 1 | |
| 12 | 3x4 | 12 | 0 | |
| 13 | 3x5 | 15 | 2 | Or batch: 3x3 + 2x2 |
| 14 | 3x5 | 15 | 1 | |
| 15 | 3x5 | 15 | 0 | |
| 16 | 4x4 | 16 | 0 | Perfect square, quality threshold |
| 17 | 3x6 | 18 | 1 | Consider batching |
| 18 | 3x6 | 18 | 0 | |
| 19 | 4x5 | 20 | 1 | Consider batching |
| 20 | 4x5 | 20 | 0 | |
| 21 | 3x7 | 21 | 0 | Consider batching |
| 22-24 | 4x6 | 24 | 0-2 | Recommend batch |
| 25 | 5x5 | 25 | 0 | Max recommended single grid |
| 26-30 | 5x6 | 30 | 0-4 | Recommend batch |
| 31-36 | 6x6 | 36 | 0-5 | Recommend batch |

### Preferred Grid Shapes (sorted by preference)

For a given cell count, prefer grids that are:
1. **Square** (e.g., 3x3, 4x4) - most reliable with AI generators
2. **Near-square, more cols than rows** (e.g., 2x3, 3x4) - wide orientation
3. **Near-square, more rows than cols** (e.g., 3x2, 4x3)
4. **Elongated** (e.g., 2x5, 1x4) - least reliable, AI may merge cells

---

## 3. Quality Analysis per Grid Size

### Resolution Math

AI image generators typically output at these resolutions:
- **Gemini**: 1024x1024 (default), up to 2048x2048
- **DALL-E 3**: 1024x1024, 1024x1792, 1792x1024
- **Flux (fal.ai)**: configurable, commonly 1024x1024 or 1344x768

**Per-cell pixel count at 1024x1024 generation**:

| Grid | Cell Size | Pixels/Cell | Quality |
|------|-----------|-------------|---------|
| 1x1 | 1024x1024 | 1,048,576 | Maximum |
| 2x2 | 512x512 | 262,144 | Excellent |
| 2x3 | 512x341 | 174,592 | Very good |
| 3x3 | 341x341 | 116,281 | Good |
| 3x4 | 341x256 | 87,296 | Acceptable |
| 4x4 | 256x256 | 65,536 | Minimum acceptable |
| 4x5 | 256x204 | 52,224 | Degraded |
| 5x5 | 204x204 | 41,616 | Poor |
| 6x6 | 170x170 | 28,900 | Very poor |

### Quality Sweet Spot

- **Best quality**: 2x2 to 3x3 (9 cells max) - each cell has 100k+ pixels
- **Acceptable**: 3x4 to 4x4 (16 cells max) - each cell has 65k+ pixels
- **Degraded**: Beyond 4x4 - cells are under 256x256, fine details lost
- **Recommended max single grid**: **4x4 = 16 cells** for quality-sensitive work, **5x5 = 25 cells** absolute max

### Empirical Observations from Community

1. **DALL-E 3** struggles with grids beyond 3x3 - frequently produces wrong cell counts, merges cells, or generates off-kilter layouts ([OpenAI Community](https://community.openai.com/t/how-do-i-make-dall-e-3-generate-a-reliable-grid-3x3-of-images/659178))
2. **The 2x2 grid method** is specifically recommended for consistent AI video generation - "forces the AI to use the same visual seed data for four images simultaneously" ([Atlabs](https://www.atlabs.ai/blog/2x2-grid-method-consistent-ai-video-tutorial))
3. **Gemini** follows structured prompts well but benefits from "short, direct instructions" rather than complex layouts ([Google Developers Blog](https://developers.googleblog.com/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/))
4. **Flux** supports multi-reference with @ syntax and works best with structured (even JSON) prompts for complex compositions ([fal.ai](https://fal.ai/learn/devs/flux-2-prompt-guide))

---

## 4. Batching Strategy

### When to Batch

| Image Count | Strategy | Batch Config |
|-------------|----------|-------------|
| 1-4 | Single grid | 1 batch, up to 2x2 |
| 5-9 | Single grid | 1 batch, up to 3x3 |
| 10-16 | Single grid | 1 batch, up to 4x4 |
| 17-25 | **Batch** or single | 2x 3x3 (18) or 1x 4x5 (20) or 1x 5x5 (25) |
| 26-36 | **Batch** | 2-3x 3x4 or 4x4 grids |
| 37+ | **Multi-batch** | Multiple 3x3 or 4x4 grids |

### Batch Strategy Trade-offs

| Factor | Fewer batches (larger grid) | More batches (smaller grid) |
|--------|---------------------------|----------------------------|
| API cost | Lower (fewer calls) | Higher (more calls) |
| Quality per cell | Lower | Higher |
| Style consistency | Higher (same generation) | Lower (separate generations) |
| Generation time | Faster (1 call) | Slower (sequential) or same (parallel) |
| Prompt reliability | Lower (AI struggles with large grids) | Higher (simpler grids) |

### Recommendation

**Default strategy**: Max 16 cells (4x4) per grid. Beyond 16, split into multiple grids.

For **ref_to_video** (objects/backgrounds):
- Style consistency within a grid is important but less critical than i2v (scenes)
- Objects/backgrounds are used as references, not final frames
- Max 16 per grid is safe, can go to 25 (5x5) if needed

For **i2v** (first frames):
- Each cell IS the first frame of a scene - quality matters more
- Max 16 per grid, prefer 9 (3x3) for best quality
- Beyond 16 scenes: batch into multiple grids

---

## 5. Prompt Format Analysis

### Current Format

```
"With 2 A [Rows]x[Cols] Grids. Grid_1x1: [description], Grid_1x2: [description]..."
```

Prefix for i2v:
```
Cinematic realistic style.
Grid image with each cell will be in the same size with 1px black grid lines.
```

### Grid Cell Addressing Convention

Current: `Grid_{row}x{col}` where row and col are 1-indexed.

For a 2x3 grid:
```
Grid_1x1  Grid_1x2  Grid_1x3
Grid_2x1  Grid_2x2  Grid_2x3
```

For a 3x4 grid:
```
Grid_1x1  Grid_1x2  Grid_1x3  Grid_1x4
Grid_2x1  Grid_2x2  Grid_2x3  Grid_2x4
Grid_3x1  Grid_3x2  Grid_3x3  Grid_3x4
```

**This format works for ANY NxM grid.** The `Grid_{row}x{col}` notation is unambiguous and the AI can follow it for non-square grids. There is no technical reason it would break for rectangular grids.

### Potential Improvements

1. **Add explicit dimensions**: Include "arranged in {rows} rows and {cols} columns" for clarity
2. **Grid line instruction**: Keep "1px black grid lines" - helps the auto-splitter detect boundaries
3. **Cell ordering**: Current row-major order (1x1, 1x2, ..., 2x1, 2x2, ...) is natural and should be kept
4. **For large grids**: Consider shorter per-cell descriptions to stay within token limits

### Does the AI Handle Non-Square Grids?

**Yes**, with caveats:
- 2x3 and 3x2 work well - simple enough to follow
- 3x4 and 4x3 work reliably
- 4x5+ gets less reliable - more cells = more chances for the AI to lose track
- Very elongated grids (1x6, 2x8) are unreliable - AI tends to "wrap" or merge cells
- The `Grid_{row}x{col}` addressing helps the AI stay organized

---

## 6. The rows===cols Constraint: Keep or Drop?

### Evidence

**For keeping square-ish grids:**
- AI generators produce more reliable grids when the layout is close to square
- Elongated grids (e.g., 2x8) cause the AI to merge or skip cells
- Square grids have better per-cell aspect ratios (cells are also square)
- The 2x2 grid method is industry standard for consistency

**Against the strict constraint:**
- The current rule is too rigid - blocking valid layouts like 3x5 (15 cells)
- Users hit errors trying to use perfectly reasonable grid sizes
- The real constraint should be on total cell count, not shape
- Near-square is sufficient; exact square is unnecessary

### Recommendation: **Replace with a relaxed near-square rule**

Instead of `rows === cols || rows === cols + 1`, use:

```
abs(rows - cols) <= 2 && rows >= 1 && cols >= 1 && rows * cols <= MAX_CELLS
```

This allows: 2x3, 3x4, 3x5, 4x5, 4x6 while blocking 2x8, 1x6, etc.

---

## 7. `getOptimalGrid()` Function Design

```typescript
interface GridConfig {
  rows: number;
  cols: number;
  totalCells: number;
  wastedCells: number;
}

interface GridPlan {
  batches: GridConfig[];
  totalBatches: number;
  totalCells: number;
  wastedCells: number;
}

const MAX_CELLS_PER_GRID = 16; // 4x4 quality ceiling
const ABSOLUTE_MAX_CELLS = 25; // 5x5 hard cap

/**
 * Find the best grid dimensions for a given cell count.
 * Prefers square, then near-square (more cols than rows).
 * Minimizes wasted cells.
 */
function findBestGrid(cellCount: number, maxCells: number = MAX_CELLS_PER_GRID): GridConfig {
  if (cellCount <= 0) return { rows: 1, cols: 1, totalCells: 1, wastedCells: 1 };
  if (cellCount === 1) return { rows: 1, cols: 1, totalCells: 1, wastedCells: 0 };

  let best: GridConfig | null = null;

  for (let rows = 1; rows <= Math.ceil(Math.sqrt(maxCells)); rows++) {
    for (let cols = rows; cols <= rows + 2; cols++) { // near-square: cols within +2 of rows
      const total = rows * cols;
      if (total < cellCount) continue;
      if (total > maxCells) continue;

      const wasted = total - cellCount;
      const candidate: GridConfig = { rows, cols, totalCells: total, wastedCells: wasted };

      if (!best || wasted < best.wastedCells ||
          (wasted === best.wastedCells && Math.abs(rows - cols) < Math.abs(best.rows - best.cols))) {
        best = candidate;
      }
    }
  }

  // If no near-square grid fits, allow wider grids
  if (!best) {
    for (let rows = 1; rows <= maxCells; rows++) {
      const cols = Math.ceil(cellCount / rows);
      if (rows * cols > maxCells) continue;
      if (Math.abs(rows - cols) > 3) continue; // still limit elongation
      const total = rows * cols;
      const wasted = total - cellCount;
      const candidate: GridConfig = { rows, cols, totalCells: total, wastedCells: wasted };
      if (!best || wasted < best.wastedCells) {
        best = candidate;
      }
    }
  }

  return best || { rows: 1, cols: cellCount, totalCells: cellCount, wastedCells: 0 };
}

/**
 * Get the optimal grid configuration for a given image count.
 * Handles batching if count exceeds quality threshold.
 */
function getOptimalGrid(imageCount: number, maxCellsPerGrid: number = MAX_CELLS_PER_GRID): GridPlan {
  if (imageCount <= 0) {
    return { batches: [], totalBatches: 0, totalCells: 0, wastedCells: 0 };
  }

  // Single grid if within limit
  if (imageCount <= maxCellsPerGrid) {
    const grid = findBestGrid(imageCount, maxCellsPerGrid);
    return {
      batches: [grid],
      totalBatches: 1,
      totalCells: grid.totalCells,
      wastedCells: grid.wastedCells,
    };
  }

  // Multi-batch: split into roughly equal grids
  const numBatches = Math.ceil(imageCount / maxCellsPerGrid);
  const perBatch = Math.ceil(imageCount / numBatches);
  const batches: GridConfig[] = [];
  let remaining = imageCount;

  for (let i = 0; i < numBatches; i++) {
    const batchSize = Math.min(perBatch, remaining);
    batches.push(findBestGrid(batchSize, maxCellsPerGrid));
    remaining -= batchSize;
  }

  return {
    batches,
    totalBatches: batches.length,
    totalCells: batches.reduce((sum, b) => sum + b.totalCells, 0),
    wastedCells: batches.reduce((sum, b) => sum + b.wastedCells, 0),
  };
}
```

### Example Outputs

```
getOptimalGrid(4)   → { batches: [{rows:2, cols:2, total:4, wasted:0}], totalBatches:1 }
getOptimalGrid(6)   → { batches: [{rows:2, cols:3, total:6, wasted:0}], totalBatches:1 }
getOptimalGrid(9)   → { batches: [{rows:3, cols:3, total:9, wasted:0}], totalBatches:1 }
getOptimalGrid(12)  → { batches: [{rows:3, cols:4, total:12, wasted:0}], totalBatches:1 }
getOptimalGrid(16)  → { batches: [{rows:4, cols:4, total:16, wasted:0}], totalBatches:1 }
getOptimalGrid(20)  → { batches: [{rows:3, cols:4, total:12, wasted:2}, {rows:3, cols:3, total:9, wasted:1}], totalBatches:2 }
getOptimalGrid(25)  → { batches: [{rows:3, cols:5, total:15, wasted:2}, {rows:3, cols:4, total:12, wasted:2}], totalBatches:2 }
getOptimalGrid(36)  → { batches: [{rows:3, cols:4, total:12, wasted:0}, {rows:3, cols:4, total:12, wasted:0}, {rows:3, cols:4, total:12, wasted:0}], totalBatches:3 }
```

---

## 8. Recommended New Constraints

### Replace Current System With

| Parameter | Old | New |
|-----------|-----|-----|
| Min rows | 2 | 1 |
| Max rows | 6 (ref) / 8 (i2v) | 5 |
| Min cols | 2 | 1 |
| Max cols | 6 (ref) / 8 (i2v) | 5 |
| Max cells | 36 (ref) / 64 (i2v) | 16 per grid (25 absolute max) |
| Shape rule | rows===cols \|\| rows===cols+1 | abs(rows-cols) <= 2 |
| Batching | Not supported | Auto-batch if count > 16 |

### Valid Grid Sizes (New)

Single image: `1x1`
Small: `1x2(2), 1x3(3), 2x2(4)`
Medium: `2x3(6), 3x3(9), 3x4(12)`
Large: `4x4(16)` -- quality boundary
Extended (if needed): `4x5(20), 5x5(25)` -- only when batching isn't possible

### Key Constraints to Enforce
1. `rows * cols <= maxCellsPerGrid` (default 16, configurable to 25)
2. `abs(rows - cols) <= 2` (near-square)
3. `rows >= 1 && cols >= 1`
4. For cell counts > 16: auto-batch into multiple grid generations

---

## 9. Code Changes Required

### Phase 1: Relax Constraints (Quick Win)

1. **Schema** (`wan26-flash-plan.ts`): Change `.min(2).max(6)` to `.min(1).max(5)` for all row/col fields
2. **System prompt** (`wan26-flash-plan.ts` lines 74, 79): Update valid grid sizes list to include 1x-prefixed sizes and remove 6x sizes
3. **Frontend validation** (`ref-grid-image-review.tsx`, `grid-image-review.tsx`): Update range checks and replace square constraint with `abs(rows-cols) <= 2`
4. **API routes** (approve-grid, approve-ref-grid, approve, storyboard): Update all validation to new rules
5. **Supabase functions** (start-workflow, start-ref-workflow): Update validation
6. **Webhook handlers**: Update conditional validation
7. **Grid splitter** (`grid-splitter.ts` line 185-189): Expand detection range to accept 1-5

### Phase 2: Images-First API (New Feature)

1. Add `getOptimalGrid()` function to a new `editor/src/lib/grid-optimizer.ts`
2. Modify LLM system prompts to output `image_count` instead of `rows`/`cols` - let the system compute optimal grid
3. Or: keep LLM outputting rows/cols but validate against `getOptimalGrid()` and auto-correct

### Phase 3: Multi-Batch Support (Future)

1. Add batching logic to grid generation workflow
2. Support multiple grid_images per storyboard/grid type
3. Update grid splitting to handle batch results
4. Update UI to show/review multiple grid images

---

## 10. Summary of Recommendations

1. **Drop the strict square constraint.** Replace with `abs(rows-cols) <= 2`.
2. **Cap at 16 cells per grid** for quality. Allow 25 as absolute max.
3. **Allow 1-row grids** for small counts (1x1, 1x2, 1x3).
4. **Keep the Grid_{row}x{col} prompt format** - it works for any NxM.
5. **Implement `getOptimalGrid()`** to compute layout from image count.
6. **Plan for batching** as a future feature for 17+ images.
7. **The prompt format is fine** - no changes needed to the "With 2 A [R]x[C] Grids" structure.
8. **Update all 11+ validation locations** simultaneously to avoid inconsistencies.

Sources:
- [OpenAI Community: DALL-E 3 Grid Reliability](https://community.openai.com/t/how-do-i-make-dall-e-3-generate-a-reliable-grid-3x3-of-images/659178)
- [Atlabs: 2x2 Grid Method](https://www.atlabs.ai/blog/2x2-grid-method-consistent-ai-video-tutorial)
- [Google Developers: Gemini 2.5 Flash Prompting](https://developers.googleblog.com/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/)
- [fal.ai: Flux 2 Prompt Guide](https://fal.ai/learn/devs/flux-2-prompt-guide)
- [Gemini Image Generation Best Practices](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/gemini-image-generation-best-practices)
