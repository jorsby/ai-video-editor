# DIY Grid Auto-Splitter API — Research Report

## 1. Current Flow Analysis

### How Grid Splitting Works Today

The current pipeline uses **two FAL.AI ComfyUI workflows**:

1. **Grid Generation** (`workflows/octupost/generategridimage`)
   - LLM generates a storyboard plan with `rows`, `cols`, and a `grid_image_prompt`
   - FAL.AI ComfyUI renders a single composed grid image (all frames in one image)

2. **Grid Splitting** (`comfy/octupost/splitgridimage`)
   - Receives: grid image URL + rows + cols + width + height
   - Returns: individual cell images from ComfyUI node outputs (Node 30 = raw cells, Node 11 = padded)
   - Updates `first_frames` / `objects` / `backgrounds` tables with split images

### Key Files
- **Grid generation trigger**: `editor/src/app/api/storyboard/approve-grid/route.ts`
- **Webhook handler**: `editor/src/app/api/webhook/fal/route.ts` (lines 155-447)
- **Plan generation**: `editor/src/app/api/storyboard/route.ts`

### Pain Points
| Issue | Impact |
|-------|--------|
| **Manual rows/cols specification** | Breaks when AI generates inconsistent grids |
| **Hardcoded ComfyUI node IDs** (30, 11) | Fragile; breaks if workflow changes |
| **No auto-detection** | FAL.AI ComfyUI doesn't support custom nodes needed for it |
| **No out-padding** control | Tied to whatever ComfyUI Node 11 does |
| **External dependency** for a simple image crop | Adds latency, cost, and failure modes |
| **URL-based param passing** | No type safety on `parseInt` deserialization |

### Grid Dimension Constraints (Current)
- **I2V mode**: rows/cols 2-8, constraint: `rows === cols || rows === cols + 1`
- **Ref-to-Video mode**: rows/cols 2-6, same row/col relationship constraint

### Existing Image Libraries in Project
- `fabric@6.9.0` (canvas manipulation, client-side)
- `pixi.js@8.14.3` (GPU rendering, client-side)
- `@ffmpeg/ffmpeg@0.12.15` (video processing)
- **No server-side image processing library (no sharp, no jimp)**

---

## 2. Technical Approach for Auto-Detection

### Recommended: Histogram Projection (sharp + JS)

This is the simplest approach that works well for AI-generated grids, which have clean, predictable separators.

```
Algorithm:
1. Load image → greyscale → raw pixel buffer
2. Compute column-wise mean intensity (vertical projection)
3. Compute row-wise mean intensity (horizontal projection)
4. Find valleys/peaks in projections → these are grid separator lines
5. Derive rows/cols from separator positions
6. Use sharp.extract() to crop each cell
7. Optionally extend edges (out-padding) with sharp.extend()
```

#### Pseudocode

```typescript
import sharp from 'sharp';

interface GridCell {
  row: number;
  col: number;
  buffer: Buffer;
}

async function detectAndSplitGrid(imageUrl: string, outPadding = 0): Promise<GridCell[]> {
  // 1. Fetch and load image
  const response = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const image = sharp(imageBuffer);
  const { width, height } = await image.metadata();

  // 2. Get raw greyscale pixels
  const { data } = await image
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 3. Compute column-wise mean intensity
  const colMeans = new Float64Array(width!);
  for (let x = 0; x < width!; x++) {
    let sum = 0;
    for (let y = 0; y < height!; y++) {
      sum += data[y * width! + x];
    }
    colMeans[x] = sum / height!;
  }

  // 4. Compute row-wise mean intensity
  const rowMeans = new Float64Array(height!);
  for (let y = 0; y < height!; y++) {
    let sum = 0;
    for (let x = 0; x < width!; x++) {
      sum += data[y * width! + x];
    }
    rowMeans[y] = sum / width!;
  }

  // 5. Find separator lines (valleys or peaks depending on separator color)
  const verticalSeparators = findSeparators(colMeans, width!);
  const horizontalSeparators = findSeparators(rowMeans, height!);

  const cols = verticalSeparators.length + 1;
  const rows = horizontalSeparators.length + 1;

  // 6. Extract cells
  const cells: GridCell[] = [];
  const xBounds = [0, ...verticalSeparators, width!];
  const yBounds = [0, ...horizontalSeparators, height!];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const left = xBounds[c];
      const top = yBounds[r];
      const cellWidth = xBounds[c + 1] - left;
      const cellHeight = yBounds[r + 1] - top;

      let cell = sharp(imageBuffer).extract({
        left, top, width: cellWidth, height: cellHeight
      });

      // 7. Out-padding: extend edges
      if (outPadding > 0) {
        cell = cell.extend({
          top: outPadding,
          bottom: outPadding,
          left: outPadding,
          right: outPadding,
          extendWith: 'mirror' // or 'copy' for edge replication
        });
      }

      cells.push({
        row: r, col: c,
        buffer: await cell.png().toBuffer()
      });
    }
  }

  return cells;
}

function findSeparators(means: Float64Array, size: number): number[] {
  // Find consistent dips/peaks that indicate separator lines
  const threshold = computeAdaptiveThreshold(means);
  const separators: number[] = [];
  let inSeparator = false;
  let sepStart = 0;

  for (let i = 0; i < size; i++) {
    const isSep = Math.abs(means[i] - threshold.separatorValue) < threshold.tolerance;
    if (isSep && !inSeparator) {
      sepStart = i;
      inSeparator = true;
    } else if (!isSep && inSeparator) {
      separators.push(Math.round((sepStart + i) / 2)); // midpoint
      inSeparator = false;
    }
  }

  return separators;
}
```

### Alternative Approaches (If Histogram Projection Fails)

| Approach | Pros | Cons | When to Use |
|----------|------|------|-------------|
| **Histogram Projection** | No deps, fast, simple | Fails on noisy/artistic grids | AI grids with clean separators |
| **OpenCV Hough Lines** | Robust, well-documented | Heavy dependency (50MB+) | Messy/hand-drawn grids |
| **Morphological Operations** | Robust for solid lines | Requires OpenCV | Grids with thick borders |
| **Contour Detection** | Works with bordered cells | Complex, needs OpenCV | Grids with visible cell borders |
| **Uniform Division** (fallback) | Zero detection needed | Wrong if grid is irregular | Last resort with known dims |

### Handling Edge Cases

1. **No visible separator lines** (AI generates seamless grids):
   - Fallback to uniform division: `cellWidth = width / cols`, `cellHeight = height / rows`
   - Accept optional `rows`/`cols` override parameters

2. **Slightly misaligned cells**:
   - Merge separators within a tolerance band (e.g., ±5px)
   - Use median cell size to regularize

3. **Separator width varies**:
   - Track separator start/end positions, crop to exclude the separator itself

---

## 3. Library Comparison

| Feature | sharp (Node.js) | OpenCV.js (Node) | Pillow (Python) | OpenCV (Python) |
|---------|-----------------|------------------|-----------------|-----------------|
| **Grid auto-detection** | Manual (pixel analysis) | Hough lines, morphology | Manual (pixel analysis) | Full suite |
| **Image cropping** | Excellent | Good | Good | Good |
| **Out-padding/extend** | Built-in (`extend()`) | Manual | Built-in (`expand()`) | `copyMakeBorder()` |
| **Performance** | 4-5x faster than ImageMagick | Good | Moderate | Good |
| **Bundle size** | ~8MB (native addon) | ~50MB+ | ~5MB | ~50MB+ |
| **Vercel compatible** | Native support | Problematic | Via Python runtime | Via Python runtime |
| **Complexity** | Low | High | Low | Medium |
| **Already in project** | No (but trivial to add) | No | No | No |

### Recommendation
**sharp** is the clear winner for this use case:
- AI-generated grids are clean enough for histogram projection
- No need for OpenCV's heavy machinery
- Native Vercel support (it's what Next.js Image Optimization uses)
- Single dependency, tiny footprint
- Extremely fast for the crop+extend operations

---

## 4. Deployment Recommendation

### Best Option: Next.js API Route on Vercel (with sharp)

```
POST /api/split-grid
Body: { imageUrl: string, outPadding?: number, rows?: number, cols?: number }
Returns: { rows: number, cols: number, cells: { row, col, url }[] }
```

| Factor | Assessment |
|--------|------------|
| **Cost** | Free (within Vercel hobby limits) |
| **Sharp support** | Native — Vercel bundles it for Next.js |
| **Memory** | 1GB hobby / 2GB pro — more than enough for 2048x2048 |
| **Timeout** | 10s hobby / 60s pro — splitting takes <2s |
| **Body size** | 4.5MB limit — solved by accepting URL instead of upload |
| **Cold start** | ~500ms — acceptable |
| **Deployment** | Zero config — just add an API route |

### Architecture

```
Current Flow:
  approve-grid → FAL.AI GenGridImage → webhook → FAL.AI SplitGridImage → webhook → DB update

New Flow:
  approve-grid → FAL.AI GenGridImage → webhook → /api/split-grid (local) → DB update
                                                   ↑ runs in-process, no external call needed
```

This eliminates:
- One external API call (FAL.AI SplitGridImage)
- One webhook round-trip
- Dependency on specific ComfyUI node IDs
- Need to pass rows/cols manually (auto-detected)

### Implementation Location
Add as `editor/src/app/api/split-grid/route.ts` — a single file API route. Called directly from the `GenGridImage` webhook handler instead of dispatching to FAL.AI.

### Alternative Deployments (If Vercel Doesn't Work)

| Platform | Free Tier | Sharp Support | Notes |
|----------|-----------|---------------|-------|
| **Fly.io** | 3 shared VMs, 256MB | Yes (Docker) | Good for persistent service |
| **Railway** | $5 credit/mo | Yes (Docker) | Easy Docker deploy |
| **Render** | 750h/mo free | Yes (Docker) | Slower cold starts |
| **Cloudflare Workers** | No sharp | Use `@cf-wasm/photon` | Not recommended |

---

## 5. Estimated Development Effort

| Task | Effort |
|------|--------|
| Basic splitter with uniform division (no auto-detect) | 2-3 hours |
| Histogram projection auto-detection | 3-4 hours |
| Out-padding with edge extension | 1 hour |
| Upload split images to storage (Supabase/S3) | 1-2 hours |
| Integration with existing webhook flow | 2-3 hours |
| Testing with real grid images | 2-3 hours |
| **Total** | **~1-2 days** |

### Phased Approach
1. **Phase 1** (MVP): Uniform division with manually-specified rows/cols — replaces FAL.AI SplitGridImage immediately, adds out-padding control
2. **Phase 2**: Add histogram-projection auto-detection — eliminates need for manual rows/cols
3. **Phase 3**: Hardening — edge cases, fallback logic, caching

---

## 6. Pros/Cons vs External Service

### DIY (sharp + Next.js API route)
| Pros | Cons |
|------|------|
| No external dependency for splitting | Need to build & maintain |
| Auto-detection of grid layout | May need tuning for edge cases |
| Full control over out-padding | |
| Faster (no webhook round-trip) | |
| Free (runs on existing Vercel deployment) | |
| Simpler architecture (fewer moving parts) | |
| No ComfyUI node ID fragility | |

### External Service (current FAL.AI approach)
| Pros | Cons |
|------|------|
| Already working | No auto-detection |
| No code to maintain | External dependency + cost |
| | Webhook latency |
| | Fragile node ID coupling |
| | Manual rows/cols required |
| | Can't customize out-padding |

### Verdict
**Build it ourselves.** The splitting operation is trivial (it's just image cropping), the auto-detection is straightforward for AI-generated grids, and it eliminates an unnecessary external dependency. The entire implementation fits in a single file.

---

## 7. Relevant GitHub Repos & Libraries

### Grid Detection
- **[grid-finder](https://github.com/JulienPalard/grid-finder)** — Python, OpenCV-based grid detection. Most directly relevant.
- **[cv-image-grid-detection](https://github.com/n1ru4l/cv-image-grid-detection)** — JavaScript, OpenCV.js. Detects grids in D&D battle maps. Good reference for the JS approach.
- **[split-image](https://github.com/whiplashoo/split-image)** — Python. Manual rows/cols splitting (no detection). Good reference for splitting logic.

### Image Processing
- **[sharp](https://github.com/lovell/sharp)** — High-performance Node.js image processing. 29k+ stars. The go-to for server-side image work in Node.
- **[promptoMANIA Grid Splitter](https://promptomania.com/grid-splitter/)** — Web tool that splits Midjourney grids. Proof that simple splitting works for AI grids.

### OpenCV References
- [OpenCV Hough Line Transform Tutorial](https://docs.opencv.org/3.4/d9/db0/tutorial_hough_lines.html)
- [OpenCV Morphological Line Detection](https://docs.opencv.org/3.4/dd/dd7/tutorial_morph_lines_detection.html)
- [Medium: Grid Image Processing with OpenCV](https://medium.com/@shiodev/analyzing-and-processing-grid-images-with-opencv-part-1-d5c42ab0703c)

### sharp API References
- [sharp extract (crop)](https://sharp.pixelplumbing.com/api-resize#extract)
- [sharp extend (padding)](https://sharp.pixelplumbing.com/api-resize#extend)
- [sharp raw pixel access](https://sharp.pixelplumbing.com/api-output#raw)
- [sharp convolve (custom kernels)](https://sharp.pixelplumbing.com/api-operation#convolve)
