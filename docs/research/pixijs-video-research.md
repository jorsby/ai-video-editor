# PixiJS for Template-Based Video Rendering — Research

**Date:** 2026-03-06
**Question:** Since we already use PixiJS 8, can we use it to render template-based videos from images + voiceover?

---

## 1. Current PixiJS Usage in Our Codebase

### Overview

PixiJS 8 (`pixi.js@8.14.3`) is the **core rendering engine** of our video editor, used via the `openvideo` workspace package. It's not a minor dependency — it's the foundation.

### Dependencies

| Package | Location | PixiJS Deps |
|---------|----------|-------------|
| `openvideo` | `packages/openvideo/` | `pixi.js@^8.14.3`, `@pixi/layout@^3.2.0`, `pixi-filters@^6.1.5` |
| `editor` | `editor/` | `pixi.js@^8.14.3` (direct), plus via `openvideo` |

### Files Using PixiJS (20+ files in `packages/openvideo/src/`)

| Component | Files | PixiJS Features Used |
|-----------|-------|---------------------|
| **Compositor** | `compositor.ts` | `Application`, `Container`, `Sprite`, `TilingSprite`, `Texture`, `RenderTexture`, `Graphics`, `BlurFilter`, `ColorMatrixFilter`, `Filter`, `GlProgram`, `UniformGroup` |
| **Sprite Renderer** | `sprite/pixi-sprite-renderer.ts` | `Sprite`, `TilingSprite`, `Texture`, `Container`, `Graphics`, `BlurFilter`, `ColorMatrixFilter`, `Filter`, `GlProgram`, `UniformGroup` |
| **Effects System** | `effect/effect.ts`, `effect/types.ts`, `effect/constant/` | Custom GLSL fragment shaders via `Filter` + `GlProgram`, chroma key, color maps, lightmaps |
| **Transitions** | `transition/transition.ts`, `transition/types.ts` | Shader-based transitions between clips |
| **Animation** | `animation/gsap-animation.ts` | GSAP + PixiPlugin for character/word/line-level animations on PixiJS objects |
| **Clips** | `clips/text-clip.ts`, `clips/image-clip.ts`, `clips/caption-clip.ts` | `BitmapText`, `Sprite`, `Texture` for rendering media elements |
| **Transformer** | `transfomer/` (3 files) | Interactive handles/wireframes for on-canvas editing |
| **Utilities** | `utils/color.ts`, `studio.ts`, `studio/timeline-model.ts` | Color parsing, selection, timeline management |
| **Editor** | `editor/src/lib/caption-generator.ts`, `editor/src/utils/schema-converter.ts` | `BitmapText` for text measurement |

### How It Works Today

The `Compositor` class (`compositor.ts`) is the heart of the rendering pipeline:

1. Creates an `OffscreenCanvas` + PixiJS `Application` (WebGL mode)
2. Adds clips (Video, Image, Text, Caption, Audio) as sprites to the PixiJS stage
3. Manually renders frame-by-frame (ticker is stopped — manual `render()` calls)
4. Each frame is encoded via `VideoEncoder` + muxed via `wrapbox` (`recodemux`)
5. Outputs a `ReadableStream<Uint8Array>` → MP4/WebM

**Key insight:** The Compositor already does frame-by-frame PixiJS rendering → video encoding. This is exactly the pattern needed for template-based video export.

### Animation Capabilities Already Present

- **GSAP + PixiPlugin**: Character/word/line-level text animations with GSAP timeline control
- **Custom GLSL shaders**: Effects (chroma key, color grading, etc.) and transitions
- **Transform system**: Position, scale, rotation, opacity, flip, mirror, blur, brightness
- **`pixi-filters`**: 20+ GPU-accelerated filters (bloom, glow, CRT, etc.)

---

## 2. Video Export Approaches with PixiJS

### Approach A: Browser-Side (What We Already Have)

**How:** `OffscreenCanvas` → PixiJS `Application` → `VideoEncoder` → `recodemux` → MP4

- **Status:** Already implemented in `compositor.ts`
- **Pros:** Works today, no server needed, runs in browser/Web Worker
- **Cons:** Requires WebCodecs API (modern browsers only), client CPU/GPU usage
- **Use case:** Preview rendering, client-side export (already works)

### Approach B: Canvas.captureStream() + MediaRecorder

**How:** PixiJS renders to canvas → `canvas.captureStream()` → `MediaRecorder` → WebM/MP4

- **Pros:** Simple API, real-time recording
- **Cons:** Real-time only (60s video = 60s render), WebM output (not MP4 in Firefox), frame drops possible, quality issues
- **Verdict:** Inferior to what we already have. Skip.

### Approach C: Server-Side via @pixi/node (Headless)

**How:** `@pixi/node` runs PixiJS on Node.js with headless OpenGL → frame-by-frame → FFmpeg

- **`@pixi/node` status:** Experimental. Requires `xvfb` (virtual framebuffer) on Linux. Last release ~1 year ago. Uses `headless-gl` and `node-canvas` (native deps with compilation issues).
- **Pros:** Reuse all PixiJS code server-side, same rendering output
- **Cons:**
  - `@pixi/node` is **not well-maintained** — stale releases, compatibility issues with PixiJS 8
  - Requires `xvfb`, `headless-gl`, native deps → deployment pain (Docker, CI complexity)
  - GPU acceleration on servers is expensive (GPU instances)
  - Without GPU: software rendering via Mesa/llvmpipe is slow
- **Verdict:** Technically possible but fragile and operationally heavy. Not recommended for production.

### Approach D: Puppeteer/Playwright Recording

**How:** Load PixiJS app in headless Chrome → screenshot each frame → FFmpeg stitch

- **Pros:** Full browser environment, guaranteed rendering fidelity, can use all browser APIs
- **Cons:** Heavy (Chrome process per render), memory-intensive, ~1-2s per frame for screenshot
- **Verdict:** This is essentially what Remotion does. If going this route, just use Remotion.

### Approach E: Frame-by-Frame in Web Worker → FFmpeg (Hybrid)

**How:** Run the existing `Compositor` in a Web Worker (OffscreenCanvas) → extract frames as PNG/raw pixels → pipe to FFmpeg WASM or server-side FFmpeg

- **Pros:** Reuses existing code, runs faster than real-time, no browser dependency for server
- **Cons:** FFmpeg WASM is slow (~3-5x real-time for encoding); server-side FFmpeg requires frame transfer
- **Verdict:** Possible but adds complexity without clear advantage over Approach A.

### Summary Table

| Approach | Already Built? | Server-Side? | Quality | Speed | Complexity | Recommended? |
|----------|---------------|-------------|---------|-------|------------|-------------|
| **A: Browser VideoEncoder** | Yes | No | Excellent | Fast | Low | Yes (client) |
| B: captureStream | No | No | Medium | Real-time only | Low | No |
| C: @pixi/node | No | Yes | Good | Slow (no GPU) | Very High | No |
| D: Puppeteer recording | No | Yes | Excellent | Slow | High | No (use Remotion) |
| E: Worker → FFmpeg | Partial | Hybrid | Excellent | Medium | High | Maybe |

---

## 3. Server-Side Rendering Feasibility

### The Core Problem

PixiJS is a **WebGL/WebGPU rendering library** designed for browsers. Running it server-side requires one of:

1. **Headless browser** (Puppeteer/Playwright) — heavy, slow, but works
2. **`@pixi/node`** with headless-gl — fragile, poorly maintained, native dep hell
3. **GPU-equipped server** — expensive ($0.50-2.00/hr for GPU instances)

### @pixi/node Specifics

- Repository: [pixijs-userland/node](https://github.com/pixijs/node)
- Requires: `xvfb-run`, `headless-gl`, `node-canvas` (Cairo), Mesa for software GL
- Compatibility: Primarily tested with PixiJS 7.x; PixiJS 8 support is uncertain
- Deployment: Docker image needs `libGL`, `libegl`, `mesa-utils`, `xvfb` — adds ~200MB+ to image
- Reliability: Community reports intermittent crashes, texture loading failures, WebGL context issues

### Verdict

**Server-side PixiJS is not production-ready.** The `@pixi/node` ecosystem is too immature and fragile. If you need server-side rendering, use a purpose-built tool (Remotion, Revideo, FFmpeg).

---

## 4. Template System Design (If We Were to Use PixiJS)

### How It Would Work

```typescript
// Template definition
interface VideoTemplate {
  id: string;
  name: string;
  // Scene layout function — returns PixiJS display objects
  createScene(app: Application, props: TemplateProps): Container;
  // Per-frame update function — animates the scene
  update(frame: number, fps: number, scene: Container, props: TemplateProps): void;
  // Duration calculation
  getDuration(props: TemplateProps): number;
}

// Template props (data-driven)
interface TemplateProps {
  images: string[];           // Image URLs
  text: string[];             // Per-scene text
  audioUrl: string;           // Voiceover URL
  audioDuration: number;      // Total audio duration
  style: {
    colors: { primary: string; bg: string; text: string };
    fontFamily: string;
  };
}

// Example: Ken Burns slideshow template
const kenBurnsTemplate: VideoTemplate = {
  id: 'ken-burns',
  name: 'Ken Burns Slideshow',
  createScene(app, props) {
    const container = new Container();
    // Create sprites for each image
    props.images.forEach((url, i) => {
      const sprite = Sprite.from(url);
      sprite.visible = false;
      container.addChild(sprite);
    });
    return container;
  },
  update(frame, fps, scene, props) {
    const time = frame / fps;
    const sceneDuration = props.audioDuration / props.images.length;
    const currentScene = Math.floor(time / sceneDuration);
    const sceneProgress = (time % sceneDuration) / sceneDuration;

    // Ken Burns: slow zoom from 1.0 to 1.15 over scene duration
    scene.children.forEach((child, i) => {
      const sprite = child as Sprite;
      sprite.visible = i === currentScene;
      if (i === currentScene) {
        sprite.scale.set(1.0 + sceneProgress * 0.15);
        sprite.alpha = sceneProgress < 0.1 ? sceneProgress * 10 :
                       sceneProgress > 0.9 ? (1 - sceneProgress) * 10 : 1;
      }
    });
  },
  getDuration(props) { return props.audioDuration; }
};
```

### Integration with Existing Compositor

Since `Compositor` already does frame-by-frame PixiJS → video encoding, templates would plug in naturally:

```typescript
async function renderTemplate(template: VideoTemplate, props: TemplateProps) {
  const compositor = new Compositor({ width: 1080, height: 1920, fps: 30 });
  await compositor.initPixiApp();

  const scene = template.createScene(compositor.pixiApp, props);
  compositor.pixiApp.stage.addChild(scene);

  const totalFrames = template.getDuration(props) * 30;
  for (let frame = 0; frame < totalFrames; frame++) {
    template.update(frame, 30, scene, props);
    compositor.pixiApp.renderer.render(compositor.pixiApp.stage);
    // ... encode frame via VideoEncoder
  }

  return compositor.output();
}
```

### Advantages of PixiJS Templates

- **Reuse existing infrastructure** — same Compositor, same encoder, same effects
- **GPU-accelerated** — WebGL shaders for transitions, filters, color grading
- **Rich text** — BitmapText with GSAP animations (already built)
- **Full control** — pixel-perfect positioning, custom shaders, any animation imaginable

### Disadvantages

- **Browser-only** — templates only render in browser/Web Worker (no server CLI)
- **No declarative API** — imperative PixiJS code vs. Remotion's React components
- **Template authoring** — requires PixiJS knowledge, not CSS/HTML
- **No preview** — Remotion has a built-in preview player; we'd need to build one

---

## 5. Comparison: PixiJS vs Remotion vs FFmpeg

| Criterion | PixiJS (our stack) | Remotion | FFmpeg (fluent-ffmpeg) |
|-----------|-------------------|----------|----------------------|
| **Already in codebase** | Yes (core dependency) | No (separate toolkit exists) | No |
| **Server-side rendering** | No (fragile via @pixi/node) | Yes (Lambda, Cloud Run, self-hosted) | Yes (CLI, any server) |
| **Animation quality** | Excellent (GPU shaders, GSAP) | Excellent (React/CSS/SVG) | Medium (drawtext, zoompan only) |
| **Template authoring** | Imperative PixiJS code | Declarative React components | JSON → filter graphs |
| **Text rendering** | BitmapText (limited fonts) | Full HTML/CSS (any font) | drawtext (basic) |
| **Ken Burns** | Manual (scale/position tween) | `interpolate()` on CSS transform | `zoompan` filter |
| **Transitions** | Custom GLSL shaders (powerful) | Opacity/position interpolation | `xfade` filter (40+ presets) |
| **Audio sync** | Manual (frame counting) | `<Audio>` component, frame-perfect | `amix`/`amerge` filters |
| **Preview** | Need to build | Built-in Player component | None (render only) |
| **Cost** | Free (MIT) | Free for ≤3 people, $100+/mo otherwise | Free (LGPL) |
| **Dev effort to add templates** | Medium (2-3 days) | Low (templates already exist) | High (3-5 days) |
| **Export pipeline** | Browser VideoEncoder (exists) | Headless Chrome + FFmpeg | FFmpeg CLI |
| **Ecosystem** | PixiJS plugins, pixi-filters | Large React ecosystem | Massive, rock-solid |

---

## 6. Recommendation

### Don't use PixiJS for template-based video rendering. Use Remotion.

**Rationale:**

1. **Server-side is the dealbreaker.** Template-based video rendering should be automated (API trigger → video file). PixiJS cannot reliably render server-side. Remotion can (Lambda, Cloud Run, self-hosted).

2. **We already have Remotion templates.** Per `remotion-templates-research.md`, we have 23 template configs, 7 layout components, Ken Burns, parallax, crossfade, slam, typewriter — all built and working in `~/.openclaw/skills/video-toolkit/`.

3. **PixiJS is the right tool for the editor, not for batch rendering.** PixiJS excels at interactive, real-time rendering in the browser — which is exactly what our video editor needs. But for automated, server-side, template-driven video generation, Remotion (or FFmpeg) is purpose-built.

4. **Client-side PixiJS rendering is a nice-to-have.** The existing `Compositor` could power in-browser preview of template videos before server-side rendering. This is a complementary role, not a replacement for server-side rendering.

### Recommended Architecture

```
┌─────────────────────────────────────────────────┐
│                    Editor (Browser)               │
│                                                   │
│  PixiJS (openvideo) ──── Interactive editing      │
│       │                   Timeline, effects,      │
│       │                   real-time preview        │
│       │                                           │
│  Compositor ──────────── Client-side export       │
│       │                   (already works)          │
│       │                                           │
│  Template Preview ────── Preview template videos  │
│       │                   in-browser via PixiJS    │
│       │                   (nice-to-have)           │
└───────┼───────────────────────────────────────────┘
        │
        │ API call (scene data + template config)
        ▼
┌─────────────────────────────────────────────────┐
│              Server-Side Rendering               │
│                                                   │
│  Remotion Lambda/Self-hosted                      │
│       │                                           │
│  23 existing template configs                     │
│  7 layout components                              │
│  Full animation system                            │
│       │                                           │
│  Output: MP4 → R2/S3 → CDN                       │
└───────────────────────────────────────────────────┘
```

### Where PixiJS Adds Value (Keep Using It For)

- **Video editor**: Interactive editing, timeline, effects, transform controls
- **Client-side export**: The existing Compositor → VideoEncoder pipeline
- **Template preview**: Render a low-quality preview of template videos in-browser before triggering server-side Remotion render
- **Custom effects**: GLSL shaders, GPU-accelerated filters not available in Remotion

### Dev Effort Estimate

| Task | Effort | Notes |
|------|--------|-------|
| **Storyboard → Remotion props adapter** | 1-2 days | Transform Supabase data → VideoProps JSON |
| **API endpoint for Remotion render** | 1-2 days | Trigger CLI or Lambda render |
| **Template preview in editor (PixiJS)** | 2-3 days | Optional: use Compositor to preview templates client-side |
| **Remotion Lambda setup** | 1 day | AWS IAM, S3, deploy |
| **Total MVP** | 3-4 days | Without preview |
| **Total with preview** | 5-7 days | With PixiJS-based in-browser preview |

---

## 7. Key Takeaways

1. **PixiJS is deeply integrated** — it's the rendering engine of our editor via `openvideo`, not a superficial dependency
2. **The Compositor already renders video** — frame-by-frame PixiJS → VideoEncoder → MP4 works in-browser
3. **Server-side PixiJS is not viable** — `@pixi/node` is fragile, unmaintained, and requires GPU/xvfb
4. **Remotion templates already exist** — 23 configs, 7 layouts, full animation system, ready to wire up
5. **Best strategy: PixiJS for editing + preview, Remotion for server-side template rendering**
6. **Don't rebuild what's already built** — the Remotion toolkit is production-ready; just needs a data adapter

---

## Sources

- [PixiJS Discussion: Pixi to video (#7259)](https://github.com/pixijs/pixijs/discussions/7259)
- [PixiJS Issue: Pixi to video (#6731)](https://github.com/pixijs/pixijs/issues/6731)
- [@pixi/node on npm](https://www.npmjs.com/package/@pixi/node)
- [@pixi/node GitHub](https://github.com/pixijs/node)
- [PixiJS Discussion: Running in Node.js (#8326)](https://github.com/pixijs/pixijs/discussions/8326)
- [PixiJS Environments Guide](https://pixijs.com/8.x/guides/concepts/environments)
- [PixiJS Renderers Guide](https://pixijs.com/8.x/guides/components/renderers)
- [Remotion SSR Comparison](https://www.remotion.dev/docs/compare-ssr)
- [Remotion Lambda](https://www.remotion.dev/docs/lambda)
- [Remotion License & Pricing](https://www.remotion.dev/docs/license)
- Internal: `packages/openvideo/src/compositor.ts` — PixiJS frame-by-frame rendering + video encoding
- Internal: `packages/openvideo/src/sprite/pixi-sprite-renderer.ts` — Full PixiJS sprite/effect pipeline
- Internal: `docs/research/remotion-templates-research.md` — Existing Remotion template system
- Internal: `docs/research/video-template-alternatives.md` — FFmpeg, Revideo, Rendervid comparison
