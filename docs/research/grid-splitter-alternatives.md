# Grid Splitter Alternatives Research

> **Date**: 2026-03-06
> **Goal**: Find the best approach to auto-detect grid layout and split grid images, replacing the current manual rows/cols + fal.ai ComfyUI `splitgridimage` workflow.

---

## 1. Current Architecture

### Pipeline
```
AI generates grid image (ComfyUI on fal.ai)
    -> User reviews grid, manually inputs rows/cols
    -> approve-grid calls fal.ai ComfyUI `comfy/octupost/splitgridimage`
    -> ComfyUI splits into individual frames (node 30: raw, node 11: out-padded)
    -> Webhook saves each frame to first_frames/objects/backgrounds tables
    -> Outpaint step runs on individual frames
    -> Video generation from frames
```

### Key Files
- `editor/src/app/api/storyboard/approve-grid/route.ts` — sends split request with `{loadimage_1, rows, cols, width, height}` to `https://queue.fal.run/comfy/octupost/splitgridimage`
- `editor/src/app/api/webhook/fal/route.ts` — handles `SplitGridImage` callback, extracts images from ComfyUI node outputs (node 30 = raw tiles, node 11 = out-padded tiles)
- `editor/src/components/editor/media-panel/panel/grid-image-review.tsx` — UI where user manually sets rows/cols
- `editor/src/lib/schemas/wan26-flash-plan.ts` — plan schema with `objects_rows`, `objects_cols`, `bg_rows`, `bg_cols`

### Current Pain Points
1. **Manual rows/cols input** — user must inspect the grid and type the correct values
2. **No auto-detection** — fal.ai ComfyUI can't run custom nodes for grid detection
3. **Fragile** — wrong rows/cols = corrupted frames
4. **ComfyUI overhead** — running a full ComfyUI workflow just to crop an image into tiles is heavy

---

## 2. Alternative Approaches Analyzed

### 2.1 Sharp (Node.js) — Server-Side Splitting

**How it works**: Use Sharp's `extract({left, top, width, height})` to crop each tile from the grid image. Given known rows/cols, tile positions are computed arithmetically.

**Auto-detection**: NOT built-in. Would need a separate detection step.

**Implementation**:
```typescript
import sharp from 'sharp';

async function splitGrid(imageUrl: string, rows: number, cols: number) {
  const response = await fetch(imageUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const { width, height } = await sharp(buffer).metadata();
  const tileW = Math.floor(width! / cols);
  const tileH = Math.floor(height! / rows);

  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tile = await sharp(buffer)
        .extract({ left: c * tileW, top: r * tileH, width: tileW, height: tileH })
        .toBuffer();
      tiles.push(tile);
    }
  }
  return tiles;
}
```

| Criterion | Rating |
|-----------|--------|
| Cost | FREE (runs in existing Vercel/Supabase functions) |
| Reliability | Very high for known grid dimensions |
| Dev effort | ~2-4 hours |
| Auto-detection | Requires separate solution |

**Verdict**: Best for the splitting itself. Eliminates fal.ai ComfyUI dependency entirely for the split step. Can run in a Vercel serverless function or Supabase edge function.

---

### 2.2 Pixel Variance / Projection Profile Auto-Detection

**How it works**: For AI-generated grids, tiles are separated by subtle borders, color shifts, or content discontinuities. Algorithm:
1. Convert image to grayscale
2. Compute column-wise and row-wise pixel variance (or gradient magnitude)
3. Sum each column/row — grid lines show as peaks/valleys in the projection profile
4. Find periodic peaks → determine rows and cols
5. Alternatively: compute local variance in thin horizontal/vertical strips; grid boundaries have high variance

**Practical approach for AI grids** (simpler):
1. AI grids are typically NxN or Nx(N+1) with known aspect ratios
2. Try candidate grid sizes (2x2, 2x3, 3x3, 3x4, 4x4)
3. For each candidate, check if tile boundaries align with content discontinuities
4. Score each candidate; pick the best

**Implementation**: ~50-100 lines of code using Sharp for pixel access + simple math. No OpenCV needed.

| Criterion | Rating |
|-----------|--------|
| Cost | FREE |
| Reliability | Medium-high for AI grids (consistent spacing), lower for irregular grids |
| Dev effort | ~4-8 hours |
| Dependencies | Sharp only (already available) |

**Verdict**: Good enough for AI-generated grids. Combined with the plan's expected rows/cols as a hint, this becomes very reliable.

---

### 2.3 Vision AI Auto-Detection (GPT-4o / Claude / Gemini)

**How it works**: Send the grid image to a vision model with prompt like "How many rows and columns are in this grid image? Return JSON {rows, cols}". The model visually inspects and returns dimensions.

**Implementation**:
```typescript
const response = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "Count the rows and columns in this grid image. Return JSON: {rows, cols}" },
      { type: "image_url", image_url: { url: gridImageUrl } }
    ]
  }],
  response_format: { type: "json_object" }
});
```

| Criterion | Rating |
|-----------|--------|
| Cost | ~$0.001-0.005 per image (GPT-4o-mini with low-res) |
| Reliability | High (vision models are good at counting grid cells) |
| Dev effort | ~1-2 hours |
| Latency | 1-3 seconds |

**Verdict**: Simplest auto-detection approach. Very cheap. Could use Claude Haiku or GPT-4o-mini for near-free cost. Best accuracy/effort ratio.

---

### 2.4 fal.ai Native Capabilities

**Available image utils on fal.ai**:
- Background removal (`fal-ai/birefnet/v2`, `fal-ai/imageutils/rembg`)
- Depth estimation (`fal-ai/imageutils/marigold-depth`, `fal-ai/imageutils/depth`)
- SAM segmentation (`fal-ai/image-preprocessors/sam`, `fal-ai/imageutils/sam`)
- Line art, NSFW filter, Canny edge detection
- **No crop/split/resize utilities**

**SAM (Segment Anything)**: Could theoretically segment grid cells, but SAM is designed for object segmentation, not geometric grid detection. Would produce unpredictable results on grid images.

| Criterion | Rating |
|-----------|--------|
| Cost | Per-inference pricing |
| Reliability | Low for grid splitting (not designed for this) |
| Dev effort | High (need to interpret SAM masks as grid cells) |

**Verdict**: Not suitable. fal.ai has no image cropping/splitting utilities. SAM is overkill and unreliable for geometric grids.

---

### 2.5 Cloudinary

**Relevant feature**: `cld-decompose_tile` gravity option can crop a grid image to keep the "largest tile". However:
- It extracts ONE tile, not all tiles
- No API for "split into all tiles automatically"
- Would need N separate API calls with manual offset calculation (same as Sharp)
- Free tier: 25 credits/month = ~5,000 transformations

**Standard crop approach**: Upload image, use `c_crop,w_{tileW},h_{tileH},x_{offset},y_{offset}` for each tile. This works but requires knowing rows/cols upfront.

| Criterion | Rating |
|-----------|--------|
| Cost | Free tier covers ~5,000 crops/month |
| Reliability | High (Cloudinary cropping is rock-solid) |
| Dev effort | ~3-4 hours |
| Auto-detection | None |
| Latency | Adds network round-trip to Cloudinary per tile |

**Verdict**: Adds unnecessary external dependency. Sharp does the same thing locally with zero cost and no latency.

---

### 2.6 Cloud ComfyUI Services (Comfy Cloud, RunComfy, ThinkDiffusion)

**Comfy Cloud**: ~$0.45/hr GPU time, supports "most-used custom nodes". May support splitgridimage.
**RunComfy**: $0.99-$4.99/hr depending on GPU. Supports custom node installation. $19.99/mo Pro plan.
**ThinkDiffusion**: Similar pricing tier.

| Criterion | Rating |
|-----------|--------|
| Cost | $0.45-5.00/hr (overkill for image cropping) |
| Reliability | Medium (depends on node availability) |
| Dev effort | ~2-4 hours (similar to current setup) |

**Verdict**: ComfyUI is massive overkill for splitting an image into tiles. You're paying for GPU time to run what is essentially `image.crop()`. Only makes sense if you need ComfyUI for other processing in the same workflow.

---

### 2.7 Self-Hosted ComfyUI (RunPod/vast.ai)

**RunPod Serverless**: RTX 4090 at $0.39/hr, flex workers scale to zero.
**vast.ai**: Even cheaper spot instances.

Could run custom ComfyUI with any nodes, including auto-detection nodes.

| Criterion | Rating |
|-----------|--------|
| Cost | $0.39/hr+ (still overkill for cropping) |
| Reliability | Medium (need to manage infrastructure) |
| Dev effort | High (Docker setup, node management, API wrapper) |

**Verdict**: Only worthwhile if you need ComfyUI for many other workflows. Not justified for grid splitting alone.

---

### 2.8 Hybrid: Better Prompts + Fixed Grid Sizes

**Approach**: Instead of detecting arbitrary grids, constrain the generation:
1. Always generate grids with a FIXED layout (e.g., always 3x3)
2. Add explicit visual separators in the prompt ("white grid lines between panels")
3. Use the plan's rows/cols (which the AI decided) as ground truth

**Current state**: The plan already specifies `rows` and `cols`. The issue is when the generated image doesn't match the plan's grid dimensions.

| Criterion | Rating |
|-----------|--------|
| Cost | FREE |
| Reliability | Medium (AI may still deviate) |
| Dev effort | ~1 hour (prompt engineering) |

**Verdict**: Should be done regardless as a complementary measure. Doesn't solve the problem alone but reduces failure rate.

---

### 2.9 OpenCV / Python Server for Detection

**Approach**: Deploy a small Python service (or serverless function) using OpenCV:
1. Canny edge detection
2. Hough line transform to find horizontal/vertical lines
3. Cluster lines to find grid boundaries
4. Return rows/cols + split positions

Reference: [JulienPalard/grid-finder](https://github.com/JulienPalard/grid-finder) — OpenCV Python lib for finding grids.

| Criterion | Rating |
|-----------|--------|
| Cost | FREE (if deployed on existing infra) |
| Reliability | Medium-high (good for grids with visible borders) |
| Dev effort | ~8-16 hours (Python service + deployment) |
| Latency | ~1-2 seconds |

**Verdict**: More complex than needed. AI-generated grids often lack clear border lines, making edge-based detection unreliable. Vision AI approach is simpler and more reliable.

---

## 3. Top 3 Recommendations

### Rank 1: Sharp + Vision AI Detection (RECOMMENDED)

**Architecture**:
```
Grid image generated
    -> Vision model (Claude Haiku / GPT-4o-mini) detects {rows, cols}
    -> Sharp in Vercel serverless function splits into tiles
    -> Upload tiles to storage
    -> Continue with outpaint/video pipeline
```

**Why this wins**:
- **Cost**: ~$0.002 per grid (vision detection) + $0 for splitting = essentially free
- **Reliability**: Vision models are excellent at counting grid cells; Sharp cropping is deterministic
- **Dev effort**: ~4-6 hours total
- **No new infrastructure**: Runs in existing Vercel functions
- **Eliminates fal.ai ComfyUI dependency** for the split step entirely
- **Out-padding**: Can be done with Sharp's `extend()` method instead of ComfyUI

**Implementation plan**:
1. Add Sharp to the editor package (or a new API route)
2. Create `/api/storyboard/split-grid` route that:
   a. Fetches the grid image
   b. Calls vision model to detect rows/cols (with plan's values as hint/fallback)
   c. Splits using Sharp `extract()`
   d. Optionally extends/pads each tile with Sharp `extend()`
   e. Uploads tiles to Supabase storage
   f. Updates first_frames/objects/backgrounds records
3. Remove fal.ai ComfyUI split dependency

**Risk**: Vision model might occasionally miscount. Mitigate by:
- Using plan's rows/cols as expected values and only using vision AI when they differ
- Validating that detected dimensions produce reasonable tile sizes
- Falling back to plan values if vision detection seems wrong

---

### Rank 2: Sharp + Pixel Variance Detection (No External AI)

**Architecture**: Same as Rank 1, but replace vision model with algorithmic detection.

**Why**:
- **Cost**: $0 (zero external calls)
- **Reliability**: Good for AI grids with consistent spacing
- **Dev effort**: ~6-10 hours
- **Privacy**: No images sent to external AI

**Risk**: More fragile than vision AI. May fail on grids without clear boundaries.

---

### Rank 3: Sharp + Trust-the-Plan (Simplest)

**Architecture**: Don't auto-detect at all. Use the plan's rows/cols directly. Split with Sharp.

**Why**:
- **Cost**: $0
- **Reliability**: Depends on generation quality matching the plan
- **Dev effort**: ~2-3 hours (just replace ComfyUI split with Sharp)

**Risk**: If the generated grid doesn't match the plan dimensions, you get corrupted tiles. But this is the same risk as today, minus the ComfyUI overhead.

**Enhancement**: Add a simple validation step — check if total image dimensions are evenly divisible by rows/cols (within tolerance).

---

## 4. Risk Assessment

| Approach | Risk Level | Failure Mode | Mitigation |
|----------|-----------|--------------|------------|
| Sharp + Vision AI | Low | Vision model miscount | Fallback to plan values; validate tile sizes |
| Sharp + Pixel Variance | Medium | Algorithm fails on borderless grids | Combine with plan hint; fallback cascade |
| Sharp + Trust Plan | Medium | Grid gen doesn't match plan dims | Validate before splitting; let user override |
| fal.ai ComfyUI (current) | Medium-High | Custom node limitations; manual input errors | N/A (this is what we're replacing) |
| Cloudinary | Low | API rate limits on free tier | Upgrade tier if needed |
| Cloud ComfyUI | Medium | Node availability; cost per run | Not recommended |

---

## 5. What Other Projects Do

- **Midjourney grid splitters** (e.g., splitimage.com, midjourney-splitter): Simple client-side JavaScript that assumes 2x2 grid and crops with canvas. No auto-detection — they hardcode the grid size.
- **Comic panel detection** (academic): Uses CNN-based object detection to find panel boundaries. Overkill for regular grids.
- **Stable Diffusion grid tools**: Most tools (e.g., `split-image` Python package) require manual row/col input.
- **Game asset pipelines**: Use fixed-size sprite sheets with metadata files. No detection needed.

The industry consensus: for regular grids, **hardcode or parameterize the grid size** and use simple arithmetic cropping. Auto-detection is only needed for irregular/unknown layouts.

---

## 6. Final Recommendation

**Go with Rank 1: Sharp + Vision AI Detection.**

Specifically:
1. **Replace ComfyUI splitgridimage with Sharp** — this is the biggest win. Eliminates a fal.ai call, removes GPU cost, reduces latency by ~5-10 seconds.
2. **Use the plan's rows/cols as primary source** — the AI plan already decided the grid dimensions.
3. **Add optional Vision AI verification** — call Claude Haiku (~$0.001/image) to verify dimensions when the user approves. If it disagrees with the plan, show the user both options.
4. **Handle out-padding with Sharp's `extend()`** — replaces ComfyUI node 11 output.

**Total estimated cost per grid split: $0.001-0.003** (vision verification only; splitting itself is free).
**Dev effort: ~4-6 hours** to implement and test.
**Dependencies added: Sharp** (widely used, well-maintained, already compatible with Vercel).
