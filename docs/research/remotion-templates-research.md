# Remotion Templates Research for Informative Video Generation

**Date:** 2026-03-06
**Purpose:** Evaluate Remotion as the rendering engine for template-based informative videos (science facts, explainers) using AI-generated images + voiceover + text, replacing expensive fal.ai AI video generation.

---

## 1. Remotion Overview

### What is Remotion?

Remotion is a React-based framework for creating videos programmatically. You write React components, and Remotion renders them frame-by-frame into MP4/WebM videos. Key concepts:

- **Compositions** = video definitions (width, height, fps, duration)
- **`useCurrentFrame()`** = the current frame number (drives all animation)
- **`interpolate()`** = map frame ranges to value ranges (opacity, position, scale)
- **`<Sequence>`** = show components at specific time ranges
- **`<Video>`** = chain sequences one after another
- **`<Audio>`** / **`<Img>`** = media elements with frame-perfect sync
- **`staticFile()`** = reference files in `public/` directory
- **`calculateMetadata()`** = dynamically compute duration from props at render time

### Animation Capabilities

| Effect | How | Already Have? |
|--------|-----|---------------|
| Ken Burns (zoom+pan) | `interpolate()` on `transform: scale() translate()` | Yes - `BackgroundEffect.tsx` |
| Parallax | `interpolate()` on `translateY()` with scaled image | Yes - `BackgroundEffect.tsx` |
| Crossfade transitions | Opacity interpolation between sequences | Yes - `ImageCycler.tsx` |
| Slide transitions | `translateX/Y` interpolation | Yes - template configs |
| Typewriter text | Character-by-character reveal via frame | Yes - `TextAnimation` type |
| Word-by-word reveal | Word reveal synced to frame progression | Yes - `word-reveal`, `word-by-word` |
| Slam/impact text | Scale + opacity spring animation | Yes - `slam` animation |
| Image cycling | Crossfade between array of images with ken-burns | Yes - `ImageCycler.tsx` |
| Video backgrounds | `<OffthreadVideo>` component | Yes - `VideoBackground.tsx` |
| Spring physics | `spring()` function for natural motion | Available (not yet used) |

### Server-Side Rendering

Remotion renders via headless Chromium + FFmpeg. Each frame is a browser screenshot composited into video. Four SSR options:

1. **Remotion Lambda** - Distributed rendering across AWS Lambda functions
2. **Vercel Sandbox** - VM-based rendering, simple deploy
3. **Cloud Run** - Google Cloud containers
4. **Self-hosted** - `@remotion/renderer` on any Node.js server

### Render Performance (Lambda benchmarks)

| Video | Warm Lambda | Cold Lambda |
|-------|-------------|-------------|
| Hello World | $0.001, 7.6s | $0.001, 11s |
| **1-minute video** | **$0.017, 19s** | **$0.021, 15.5s** |
| 10-min remote HD | $0.103, 56s | $0.108, 61s |
| 10-sec remote 4K | $0.013, 45s | $0.014, 53s |

A 60-second informative video with images + text + audio: **~$0.02 per render, ~20 seconds**.

---

## 2. Licensing & Pricing

### Free Usage (no license needed)

- Individuals (personal projects)
- For-profit companies with **up to 3 employees**
- Non-profit organizations
- Evaluation/testing

### Commercial License Required

For-profit companies with **4+ employees** must purchase a license:

| Tier | Price | Includes |
|------|-------|----------|
| Company | $25/dev/month + $10/1000 renders/month (min $100/mo) | Self-hosted rendering, priority support |
| Enterprise | $500+/month | Private support, consulting, custom terms |

### Our Situation

We are a small team. **If <= 3 employees, Remotion is completely free** including commercial use. If we grow beyond 3, the minimum is $100/month which is still vastly cheaper than fal.ai video generation ($0.50-2.00 per video).

---

## 3. What We Already Have

### Existing video-toolkit (at `~/.openclaw/skills/video-toolkit/`)

We already have a **production-ready Remotion setup** with:

#### Template System
- **1 generic template** (`templates/video/`) that handles all visual styles via JSON props
- **23 template configs** defining different looks (layout + animation + colors):
  - `documentary` - lower-third text, ken-burns bg, fade transitions
  - `fast-cuts` - full-bleed, slam text, hard-cut transitions (TikTok style)
  - `split-panel` - image on one side, text on other
  - `immersive` - word-reveal text over ken-burns images
  - `bold-impact` - text-only, slam animation, gradient bg
  - `cinematic` - full-bleed, fade-up text, ken-burns
  - `story-scroll` - scroll-up text, slide transitions
  - `quote-card` - centered text with quote marks
  - 10+ typewriter variants (neon, warm, dark, editorial, luxury, etc.)
  - `parallax-depth`, `top-bar`, `editorial`

#### 7 Layout Components
- `FullBleedLayout` - text over full background
- `SplitLayout` - image + text side by side
- `LowerThirdLayout` - text bar at bottom (documentary style)
- `CenteredLayout` - centered text (quote cards)
- `TextOnlyLayout` - text on gradient (bold statements)
- `ImmersiveLayout` - word-by-word reveal over images
- `TopBarLayout` - text strip at top

#### Animation System
- 8 text animations: `fade-up`, `fade-in`, `slide-left`, `typewriter`, `slam`, `scroll-up`, `word-reveal`, `word-by-word`
- 4 background effects: `ken-burns`, `parallax`, `static`, `gradient`
- 6 transition types: `fade`, `zoom-fade`, `slide-left`, `slide-up`, `soft-fade`, `hard-cut`
- 4 progress indicators: `bar`, `dots`, `numbers`, `none`

#### Render Pipeline
- `render_video.py` - End-to-end: voiceover (Qwen3-TTS) -> timing sync -> Remotion render
- `voiceover.py` - Per-scene TTS generation
- `sync_timing.py` - Match slide durations to actual audio
- Brand system with configurable colors, fonts, voice settings

#### Props Format (JSON-driven)
```json
{
  "title": "Video Title",
  "scenes": [
    {
      "text": "Scene narration",
      "audioSrc": "audio/scene1.mp3",
      "backgroundImage": "images/bg.jpg",
      "images": ["img1.jpg", "img2.jpg"],
      "duration": 5
    }
  ],
  "template": "documentary",
  "style": {
    "colors": { "primary": "#ea580c", "bg": "#1a1a2e", "text": "#fff" }
  },
  "output": { "fps": 30, "width": 1080, "height": 1920 }
}
```

### What's in the ai-video-editor (this project)

- **Grid splitter** (`editor/src/lib/grid-splitter.ts`) - Splits AI-generated grid images into individual tiles
- **Storyboard system** - Scenes with first_frames, objects, backgrounds stored in Supabase
- **Content types** (`editor/src/types/content.ts`) - Rich scene layout system with per-word-index media timing
- **Voiceover** - Qwen3-TTS integration
- **No Remotion** - Currently zero Remotion dependencies in the editor project

---

## 4. Template Designs for Science/Informative Content

Based on what we already have, here are 5 optimized template configurations:

### Template 1: "Documentary" (already exists)
**Config:** `documentary` template
**Look:** Lower-third text bar, ken-burns background, elegant fade transitions
**Best for:** Nature facts, historical explainers, "Did you know?" content
**Animation:** Background slowly zooms/pans (ken-burns), text fades up in lower third
**Existing:** 100% ready - just pass images + text + audio as JSON props

### Template 2: "TikTok Impact" (already exists as `fast-cuts`)
**Config:** `fast-cuts` template
**Look:** Full-screen images, slam text animations, hard cuts between scenes
**Best for:** Quick science facts, "mind-blowing" hooks, viral shorts
**Animation:** Images snap on, text slams in from scale(0) to scale(1), rapid transitions
**Existing:** 100% ready

### Template 3: "Split Explainer" (already exists as `split-panel`)
**Config:** `split-panel` template
**Look:** Image on left, animated text/facts on right, clean layout
**Best for:** Step-by-step explanations, comparisons, "How it works"
**Animation:** Image on one side with ken-burns, text slides up on other side
**Existing:** 100% ready

### Template 4: "Immersive Story" (already exists)
**Config:** `immersive` template
**Look:** Full-screen images with word-by-word text reveal, cinematic feel
**Best for:** Storytelling, emotional science content, space/nature
**Animation:** Word-by-word reveal synced to pacing, ken-burns on images, zoom-fade transitions
**Existing:** 100% ready

### Template 5: "Cinematic Slideshow" (already exists)
**Config:** `cinematic` template
**Look:** Full-bleed images, bottom text with fade-up, ken-burns + zoom-fade
**Best for:** Premium educational content, documentary-style science
**Animation:** Smooth ken-burns pan on each image, text elegantly fades up from bottom
**Existing:** 100% ready

### What's Missing (nice-to-have additions)

| Feature | Status | Effort |
|---------|--------|--------|
| Subtitle/caption overlay (word-level sync) | Not in templates | Medium - need word-timestamp alignment |
| Background music volume ducking | Partial (static volume) | Low - use `interpolate()` on volume |
| Animated counters/numbers | Not implemented | Low - frame-based number interpolation |
| Map/globe animations | Not implemented | Medium - SVG/canvas component |
| Chart/graph animations | Not implemented | Medium - animated data viz component |

---

## 5. Integration Plan

### Current Pipeline (expensive)
```
Script -> Scene Plan -> Grid Gen (Gemini) -> Split Grid -> fal.ai I2V ($$$) -> Final Video
```

### Proposed Pipeline (near-free)
```
Script -> Scene Plan -> Grid Gen (Gemini) -> Split Grid -> Remotion Template Render -> Final Video
                                                      |
                                              Qwen3 TTS Voiceover
```

### How Images Flow

1. **Grid generation** (Gemini/fal): Produces grid images (3x3, 2x3, etc.)
2. **Grid splitter** (`grid-splitter.ts`): Auto-detects grid lines, splits into individual tiles, uploads to R2
3. **Individual images** are stored per-scene in Supabase (first_frames, objects, backgrounds)
4. **Remotion template** receives image URLs in props JSON, renders them with animations

### Data Flow to Remotion Props

```typescript
// Transform our storyboard data -> Remotion VideoProps
function storyboardToRemotionProps(storyboard: Storyboard): VideoProps {
  return {
    title: storyboard.title,
    template: 'documentary', // or 'immersive', 'fast-cuts', etc.
    scenes: storyboard.scenes.map(scene => ({
      text: scene.narration,
      audioSrc: scene.voiceover_url,      // Qwen3 TTS output
      backgroundImage: scene.background_url, // Split grid tile
      images: scene.object_urls,            // Multiple images to cycle
      duration: scene.duration_seconds,
    })),
    style: {
      colors: storyboard.brand_colors,
    },
    output: {
      width: 1080,
      height: 1920, // or 1080 for 16:9
      fps: 30,
    },
  };
}
```

### Multi-Language Support

Same images, different voiceover/subtitles:
```typescript
// Same storyboard, different audio + text
const enProps = storyboardToProps(storyboard, { lang: 'en', audio: enVoiceover });
const trProps = storyboardToProps(storyboard, { lang: 'tr', audio: trVoiceover });
// Render both -> same visuals, different narration
```

### Multi-Aspect-Ratio Support

The `output` config already supports this:
```json
// 9:16 (TikTok/Reels)
{ "width": 1080, "height": 1920 }
// 16:9 (YouTube)
{ "width": 1920, "height": 1080 }
// 1:1 (Instagram)
{ "width": 1080, "height": 1080 }
```

Layouts are CSS-based and adapt. The `SplitLayout` switches from side-by-side (16:9) to top-bottom (9:16) based on aspect ratio.

---

## 6. Rendering Options

### Option A: Remotion Lambda (Recommended for Production)

| Aspect | Detail |
|--------|--------|
| **How** | Distributed rendering across AWS Lambda functions |
| **Cost** | ~$0.02 per 60-second video |
| **Speed** | ~20 seconds for a 1-minute video |
| **Setup** | AWS account + IAM roles + S3 bucket |
| **Scaling** | Automatic, handles 1000s of concurrent renders |
| **Pros** | Fastest, cheapest per-render, scales to zero |
| **Cons** | AWS setup complexity, needs IAM permissions |

**Monthly cost projection:**
- 100 videos/month: ~$2.00
- 1,000 videos/month: ~$20.00
- 10,000 videos/month: ~$200.00

### Option B: Vercel Sandbox (Easiest Setup)

| Aspect | Detail |
|--------|--------|
| **How** | Ephemeral Linux VM per render on Vercel |
| **Cost** | Usage-based (Vercel billing) |
| **Speed** | Slower than Lambda (single machine, cold starts) |
| **Setup** | Just deploy to Vercel + connect Blob storage |
| **Scaling** | 10 concurrent (Hobby), 2000 concurrent (Pro) |
| **Timeout** | 45 min (Hobby), 5 hours (Pro) |
| **Pros** | Simplest setup, no AWS needed |
| **Cons** | Slower, cold starts, less predictable cost |

### Option C: Self-Hosted (Cheapest at Scale)

| Aspect | Detail |
|--------|--------|
| **How** | `@remotion/renderer` on a VPS (Hetzner, Railway, etc.) |
| **Cost** | ~$5-20/month for a VPS |
| **Speed** | Depends on server specs, single-machine rendering |
| **Setup** | Node.js + Chromium + FFmpeg on a server |
| **Pros** | Cheapest at volume, full control |
| **Cons** | Manage infrastructure, no auto-scaling, pay for idle |

### Option D: Direct CLI (Development/Low Volume)

Already have this via `render_video.py`:
```bash
python3 tools/render_video.py --template documentary --config props.json --output video.mp4
```

### Recommendation

**Phase 1:** Use CLI rendering (already works) for development and low-volume production.
**Phase 2:** Add Remotion Lambda when we need automated/API-triggered rendering at scale.
**Phase 3:** Consider self-hosted if monthly volume exceeds 5,000+ videos.

---

## 7. Cost Analysis

### Current Cost (fal.ai AI Video Generation)

| Item | Cost per Video | 100 videos/mo |
|------|---------------|----------------|
| fal.ai I2V (Kling/Wan) | $0.50 - $2.00 | $50 - $200 |
| Grid generation (Gemini) | ~$0.02 | $2 |
| Qwen3 TTS (RunPod) | ~$0.01 | $1 |
| **Total** | **$0.53 - $2.03** | **$53 - $203** |

### Proposed Cost (Remotion Templates)

| Item | Cost per Video | 100 videos/mo |
|------|---------------|----------------|
| Remotion Lambda render | ~$0.02 | $2 |
| Grid generation (Gemini) | ~$0.02 | $2 |
| Qwen3 TTS (RunPod) | ~$0.01 | $1 |
| Remotion license (<=3 ppl) | $0.00 | $0 |
| **Total** | **~$0.05** | **~$5** |

### Savings

- **Per video:** $0.48 - $1.98 saved (90-97% reduction)
- **Per 100 videos:** $48 - $198 saved
- **At scale (1000 videos):** $480 - $1,980/month saved

### When to Still Use AI Video (fal.ai)

- Content that **needs motion** (sports, action, dynamic scenes)
- **Character animation** (talking heads, lip sync)
- **Cinematic quality** that static images can't achieve
- When the **content type demands it** (entertainment, not information)

---

## 8. Development Effort

### What's Already Built (0 effort)

- Complete Remotion template system with 23 template configs
- 7 layout components with animations
- Ken Burns, parallax, crossfade, slam, typewriter effects
- ImageCycler for multi-image scenes
- Full render pipeline (voiceover -> timing -> render)
- Brand/theming system
- Grid splitter for AI-generated images

### What Needs Building

| Task | Effort | Priority |
|------|--------|----------|
| **Storyboard-to-Remotion adapter** - Transform our Supabase storyboard data into Remotion `VideoProps` JSON | 1-2 days | P0 |
| **API endpoint for rendering** - Trigger Remotion renders from the editor (either CLI or Lambda) | 1-2 days | P0 |
| **Template selection UI** - Let users pick template style in the editor | 1 day | P1 |
| **Remotion Lambda setup** - AWS IAM, S3, Lambda deployment | 1 day | P1 |
| **Word-level subtitle sync** - Align caption timing with voiceover word timestamps | 2-3 days | P2 |
| **Animated data viz** - Counter animations, simple charts | 2-3 days | P2 |
| **Preview in editor** - Render a low-res preview before final render | 1 day | P2 |

### Total: ~3-4 days for MVP, ~10-12 days for full feature set

The critical insight is that **the Remotion template system is already built**. We just need to:
1. Write a data adapter (storyboard -> VideoProps)
2. Wire up an API endpoint to trigger rendering
3. (Optional) Set up Lambda for production scale

---

## 9. Architecture Decision

### For Informative Content (science, explainers, facts)
**Use Remotion templates.** Images + text + voiceover rendered locally. Near-free. Fast. Already built.

### For Entertainment/Action Content
**Keep fal.ai.** AI-generated video with motion is irreplaceable for dynamic content.

### The Router Pattern
```
Content Type Decision:
  - Informative/educational -> Remotion template render (~$0.02)
  - Needs real motion/animation -> fal.ai I2V (~$1.00)
  - Talking head needed -> SadTalker + Remotion composite (~$0.10)
```

This hybrid approach uses the cheapest tool for each content type while maintaining quality.

---

## Sources

- [Remotion Documentation](https://www.remotion.dev/docs)
- [Remotion License & Pricing](https://www.remotion.dev/docs/license)
- [Remotion Lambda Cost Examples](https://www.remotion.dev/docs/lambda/cost-example)
- [Remotion Lambda Overview](https://www.remotion.dev/docs/lambda)
- [Remotion SSR Comparison](https://www.remotion.dev/docs/compare-ssr)
- [Remotion Vercel Sandbox](https://www.remotion.dev/docs/vercel-sandbox)
- [Vercel Sandbox Pricing](https://vercel.com/docs/vercel-sandbox/pricing)
- [Remotion on Vercel (Serverless Limitations)](https://www.remotion.dev/docs/miscellaneous/vercel-functions)
- Existing codebase: `~/.openclaw/skills/video-toolkit/`
