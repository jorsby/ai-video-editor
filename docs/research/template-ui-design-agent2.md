# Template Video UI/UX Design — Alternative Vision (Agent 2)

> Date: 2026-03-06
> Philosophy: **"Script to Screen in One Breath"** — eliminate friction, not features.

---

## 1. The Core Insight: Kill the Tab

The current editor has 13 tabs. Adding "Templates" as tab #14 is the conventional move. It's also wrong.

**The problem with tabs:** Users think in *workflows*, not *tool categories*. Nobody opens the editor thinking "I need the storyboard tab, then the images tab, then the voiceover tab." They think: "I have a script. I want a video."

**The alternative:** Instead of a new tab, template videos get a **new creation mode** that takes over the entire editor layout when active. Think of it like how Figma switches between Design mode and Dev mode — same app, different lens.

---

## 2. The Two-Mode Editor

### Mode A: "Studio Mode" (What exists today)
The current 3-panel editor with timeline, canvas, media panel. Full control. Manual clip placement. This is for AI-generated videos and manual editing.

### Mode B: "Flow Mode" (New — for template videos)
A radically different layout optimized for the template video workflow:

```
┌─────────────────────────────────────────────────────────┐
│  [Studio Mode]  [Flow Mode]           Project: My Video │  ← Mode toggle in header
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────┐  ┌───────────────────────────┐ │
│  │                     │  │                           │ │
│  │   SCRIPT COLUMN     │  │    LIVE PREVIEW CANVAS    │ │
│  │                     │  │                           │ │
│  │   Scene 1: "..."    │  │    (PixiJS renders the    │ │
│  │   Scene 2: "..."    │  │     selected template     │ │
│  │   Scene 3: "..."    │  │     in real-time)         │ │
│  │   ...               │  │                           │ │
│  │                     │  │                           │ │
│  │   [Template Strip]  │  │                           │ │
│  │   ┌──┐┌──┐┌──┐┌──┐ │  │                           │ │
│  │   │KB││DC││TK││SP│ │  │                           │ │
│  │   └──┘└──┘└──┘└──┘ │  │                           │ │
│  └─────────────────────┘  └───────────────────────────┘ │
│                                                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  ▶  Scene 1 ━━━━━━━ Scene 2 ━━━━━━━ Scene 3 ━━━━  │ │  ← Simplified "scene strip"
│  │     0:00            0:05            0:10      0:15  │ │     (not a full timeline)
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Key differences from Studio Mode:**
- No track-based timeline — replaced with a **scene strip** (horizontal list of scene thumbnails)
- No media panel tabs — replaced with a **script column** that shows the narrative flow
- The canvas is larger and always shows a live preview
- Template selection is embedded in the script column, not a separate panel

---

## 3. Screen-by-Screen Flow

### Screen 1: The Starting Point — "What's Your Story?"

When a user creates a new project (or switches to Flow Mode), they see a single, focused input:

```
┌─────────────────────────────────────────┐
│                                         │
│        What's your story?               │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │                                 │   │
│   │  Paste your script here...      │   │
│   │                                 │   │
│   │  Or describe your video idea    │   │
│   │  and AI will write the script.  │   │
│   │                                 │   │
│   └─────────────────────────────────┘   │
│                                         │
│   Language: [English ▾]                 │
│   Aspect:   ○ 9:16  ● 16:9  ○ 1:1     │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │     ✨  Generate Video Plan     │   │
│   └─────────────────────────────────┘   │
│                                         │
│   ─── or choose a quick start ───       │
│                                         │
│   [📚 Educational] [📰 News Recap]     │
│   [🎯 Marketing]   [📖 Personal]       │
│                                         │
└─────────────────────────────────────────┘
```

**What's different:**
- No dropdowns for AI model selection (auto-selected based on language/category)
- Quick-start categories pre-fill a script structure and suggest matching templates
- The input is centered and focused — no sidebar, no timeline, no distractions
- This screen doubles as the "Tier 3" entry point (WhatsApp sends script → this processes it)

### Screen 2: The Plan Review — "Your Scenes"

After AI generates the plan, instead of the current collapsible accordion of textareas, we show a **visual scene board**:

```
┌──────────────────────────────────────────────────────────┐
│  ← Back to Script          Your Video Plan    [Approve]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │  Scene 1 │  │  Scene 2 │  │  Scene 3 │  │  Scene 4 │ │
│  │          │  │          │  │          │  │          │ │
│  │ [blank   │  │ [blank   │  │ [blank   │  │ [blank   │ │
│  │  card    │  │  card    │  │  card    │  │  card    │ │
│  │  with #] │  │  with #] │  │  with #] │  │  with #] │ │
│  │          │  │          │  │          │  │          │ │
│  │ "The sun │  │ "As the  │  │ "But     │  │ "Today,  │ │
│  │  rises.."│  │  world.."│  │  beneath"│  │  we know" │
│  │          │  │          │  │          │  │          │ │
│  │ [edit ✏]│  │ [edit ✏]│  │ [edit ✏]│  │ [edit ✏]│ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
│                                                          │
│  ─── Template ───────────────────────────────────────    │
│                                                          │
│  ● Ken Burns    ○ Documentary    ○ TikTok Impact         │
│  ○ Cinematic    ○ Split Screen   ○ Parallax              │
│                                                          │
│  💰 Template video: ~$0.05  vs  AI video: ~$1.50        │
│  ⚡ Ready in ~30 seconds   vs  AI video: ~3 minutes     │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │          ✨  Approve & Generate Images            │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

**What's different from the current DraftPlanEditor:**
- Horizontal card layout instead of vertical accordion — you see all scenes at once
- Template selection happens HERE, during plan review, not after
- Cost comparison is shown inline — this is a key conversion moment
- Scene cards are editable in-place (click to expand, edit voiceover + visual description)
- No collapsible sections for grid prompts — those are auto-generated and hidden (advanced users get them via a "Show advanced" link)

### Screen 3: The Editor — "Flow Mode" Active

Once images are generated and template is selected, the full Flow Mode editor appears:

```
┌────────────────────────────────────────────────────────────────┐
│ [Studio] [Flow]  ▸ Ken Burns ▾   🌐 EN ▾ TR ▾    [Export ▾]  │
├────────────────────┬───────────────────────────────────────────┤
│                    │                                           │
│  SCENE LIST        │           LIVE PREVIEW                    │
│  (scrollable)      │                                           │
│                    │   ┌───────────────────────────────────┐   │
│  ┌──────────────┐  │   │                                   │   │
│  │ 1 ▶ "The sun │  │   │                                   │   │
│  │    rises..."  │  │   │    Ken Burns zoom on Scene 2      │   │
│  │  [img thumb]  │  │   │    image, with voiceover text     │   │
│  └──────────────┘  │   │    appearing as subtitles          │   │
│                    │   │                                   │   │
│  ┌──────────────┐  │   │    ▶ Playing...                    │   │
│  │ 2 ▶ "As the  │  │   │                                   │   │
│  │    world..." ◀│  │   │                                   │   │
│  │  [img thumb]  │  │   └───────────────────────────────────┘   │
│  │  ┌─────────┐  │  │                                           │
│  │  │ EDIT    │  │  │   Template: [Ken Burns ▾]                 │
│  │  │ voiceover│  │  │                                           │
│  │  │ + visual│  │  │   ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐              │
│  │  │ desc    │  │  │   │KB││DC││TK││SP││CN││PX│ ← Carousel   │
│  │  └─────────┘  │  │   └──┘└──┘└──┘└──┘└──┘└──┘              │
│  │               │  │   ▲ active                                │
│  ┌──────────────┐  │  │                                           │
│  │ 3 ▶ "But     │  │  │   Clicking any template immediately    │
│  │    beneath.."│  │  │   re-renders preview (no loading)       │
│  │  [img thumb]  │  │  │                                           │
│  └──────────────┘  │  │                                           │
│                    │  │                                           │
├────────────────────┴───────────────────────────────────────────┤
│ ◀  │▶ Scene 1 │▶ Scene 2 │▶ Scene 3 │▶ Scene 4 │  ▶  │ 0:47 │
└────────────────────────────────────────────────────────────────┘
```

**The "Try On" Experience (Template Switching):**
- Bottom of the preview area has a horizontal **template carousel** — small thumbnails showing the same scene rendered in each template style
- Clicking a template thumbnail **instantly** re-renders the preview (PixiJS swaps the animation function, not the data)
- This feels like swiping Instagram filters — the content stays, the style changes
- Each thumbnail is a mini pre-rendered frame showing what that template looks like with *your actual images*

**The Scene Strip (bottom):**
- Replaces the full timeline — no tracks, no layers, no handles
- Each block represents one scene, sized proportionally to its duration
- Click a scene to jump to it in the preview
- Drag scene edges to adjust duration (stretches/compresses the voiceover segment)
- The strip shows a waveform of the voiceover audio underneath the scene blocks

---

## 4. How This Differs from Conventional

| Aspect | Conventional Approach | Our "Flow Mode" |
|--------|----------------------|-----------------|
| Entry point | New tab in existing panel | Dedicated creation mode (full layout change) |
| Template selection | Separate picker dialog/page | Inline carousel during editing — switch like filters |
| Plan review | Accordion of textareas | Horizontal visual scene cards |
| Timeline | Full multi-track timeline | Simplified scene strip |
| Preview | Static thumbnail or delayed render | Live PixiJS preview with instant template switching |
| Cost visibility | Hidden or in settings | Shown at decision point (plan review screen) |
| Language switching | Dropdown somewhere in settings | Language pills in header, click to switch voiceover + text |
| Advanced controls | Always visible | Hidden by default, available via "Advanced" toggle |

---

## 5. Innovative Ideas

### 5.1 "Mood Board" Template Picker (Full-Screen Immersive)

Instead of a dropdown or small carousel, pressing `T` or clicking the template name opens a **full-screen overlay gallery**:

```
┌────────────────────────────────────────────────────────────┐
│  Choose a Style                                    [✕]     │
│                                                            │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│  │            │  │            │  │            │           │
│  │  KEN BURNS │  │ DOCUMENTARY│  │   TIKTOK   │           │
│  │            │  │            │  │   IMPACT   │           │
│  │ [your img  │  │ [your img  │  │ [your img  │           │
│  │  zooming   │  │  with lower│  │  with bold │           │
│  │  slowly]   │  │  third bar]│  │  text slam]│           │
│  │            │  │            │  │            │           │
│  │  Elegant   │  │ Informative│  │  Energetic │           │
│  │  $0.03     │  │  $0.05     │  │  $0.04     │           │
│  └────────────┘  └────────────┘  └────────────┘           │
│                                                            │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│  │ CINEMATIC  │  │SPLIT SCREEN│  │  PARALLAX  │           │
│  │  ...       │  │  ...       │  │  ...       │           │
│  └────────────┘  └────────────┘  └────────────┘           │
│                                                            │
│  Category: [All ▾] [Education] [Marketing] [Entertainment] │
└────────────────────────────────────────────────────────────┘
```

Each card shows a **3-second looping animation** of Scene 1 rendered in that template style using the user's actual images. Not stock previews — their content.

### 5.2 "Split Preview" for Template Comparison

User can Shift+Click two templates to see a **side-by-side split preview**:

```
┌──────────────────┬──────────────────┐
│   KEN BURNS      │   DOCUMENTARY    │
│                  │                  │
│   [same scene    │   [same scene    │
│    rendering     │    rendering     │
│    simultaneously│    simultaneously│
│    in style A]   │    in style B]   │
│                  │                  │
│   ← Use This     │   Use This →    │
└──────────────────┴──────────────────┘
```

### 5.3 "Smart Duration" — AI-Matched Scene Timing

Instead of uniform scene durations, AI analyzes voiceover text:
- Short sentences (2-4 words) → faster scene transition
- Long descriptive passages → slower Ken Burns zoom
- Dramatic pauses → hold on image with subtle parallax
- Questions → slightly longer hold to build anticipation

The user sees this as a "Smart Timing" toggle. When on, scene durations in the strip vary. When off, uniform.

### 5.4 "Emphasis Words" — Template-Aware Text

For templates that show text overlays (TikTok Impact, Documentary), the plan editor lets users mark **emphasis words**:

```
Scene 3 voiceover:
"But beneath the surface, something **extraordinary** was happening."

→ Template renders "extraordinary" with slam animation / different color / larger size
```

Users highlight words and press `B` (or click bold) — the template system picks up bold markers and applies its own emphasis style.

### 5.5 "One-Click Variants" — Batch Style Exploration

After generating images, user clicks "Show Variants" and gets 4 mini-previews of the same video in 4 different templates playing simultaneously. Like choosing a photo filter — you see all options at once, pick the one that feels right.

### 5.6 "Rhythm Mode" — Beat-Synced Templates

If the user adds background music, templates can sync transitions to beats:
- AI detects beat timestamps in the audio
- Scene transitions snap to nearest beat
- Text animations trigger on beats
- A toggle: `♫ Sync to music` in the template settings

---

## 6. Component Structure

```
editor/src/components/
├── editor/
│   ├── editor.tsx                      # Add mode toggle (Studio/Flow)
│   ├── flow-mode/
│   │   ├── flow-editor.tsx             # Top-level Flow Mode layout
│   │   ├── script-input.tsx            # Screen 1: "What's your story?"
│   │   ├── plan-review.tsx             # Screen 2: Visual scene board
│   │   ├── scene-list.tsx              # Left column: scrollable scenes
│   │   ├── scene-card-flow.tsx         # Individual scene in Flow Mode
│   │   ├── template-carousel.tsx       # Horizontal template strip
│   │   ├── template-gallery.tsx        # Full-screen immersive picker
│   │   ├── template-preview.tsx        # PixiJS live preview renderer
│   │   ├── scene-strip.tsx             # Simplified timeline (bottom bar)
│   │   ├── language-switcher.tsx       # Language pills in header
│   │   ├── cost-badge.tsx              # Shows template vs AI cost
│   │   └── export-menu.tsx             # Export options (browser/server)
│   ├── flow-mode/templates/
│   │   ├── template-registry.ts        # Register all templates
│   │   ├── template-types.ts           # Template interface definitions
│   │   ├── ken-burns.ts                # Ken Burns template logic
│   │   ├── documentary.ts              # Documentary with lower thirds
│   │   ├── tiktok-impact.ts            # Bold text slam
│   │   ├── split-screen.ts             # Side-by-side layout
│   │   ├── cinematic.ts                # Letterbox + slow transitions
│   │   └── parallax.ts                 # Multi-layer depth effect
│   └── ...existing editor components
├── stores/
│   ├── flow-store.ts                   # Flow Mode state (active scene, template, etc.)
│   └── ...existing stores
```

### Key State (flow-store.ts)

```typescript
interface FlowStore {
  // Mode
  editorMode: 'studio' | 'flow';
  flowScreen: 'input' | 'plan' | 'editor';

  // Script & Plan
  script: string;
  scenes: FlowScene[];
  activeSceneIndex: number;

  // Template
  activeTemplateId: string;
  templateSettings: Record<string, unknown>; // per-template overrides

  // Language
  activeLanguage: LanguageCode;
  availableLanguages: LanguageCode[];

  // Preview
  isPlaying: boolean;
  currentTime: number;

  // Export
  exportQuality: 'preview' | 'hd';
}

interface FlowScene {
  id: string;
  imageUrl: string | null;
  voiceover: Record<LanguageCode, string>;
  visualDescription: string;
  duration: number; // seconds
  emphasisWords: string[]; // words to highlight in text overlay templates
}
```

---

## 7. User Flows by Tier

### Tier 1: Manual Control

```
User opens editor → Clicks "Flow Mode" in header
→ Screen 1: Pastes script, selects language + aspect ratio
→ Clicks "Generate Video Plan"
→ Screen 2: Reviews scene cards, edits voiceover text, adjusts visual descriptions
→ Selects template from bottom strip
→ Sees cost comparison, clicks "Approve & Generate Images"
→ Screen 3 (Flow Editor):
   → Images appear in scene list as they generate
   → Live preview plays in canvas (PixiJS)
   → User clicks through template carousel to try styles
   → Edits individual scene durations by dragging scene strip
   → Marks emphasis words in voiceover text
   → Switches to Studio Mode for fine-tuning (optional)
   → Clicks Export → chooses Browser (quick) or Server (HD)
```

### Tier 2: Semi-Automatic

```
User opens editor → Clicks "Flow Mode"
→ Screen 1: Pastes script
→ AI auto-detects: language, aspect ratio (from content analysis), category
→ Clicks "Generate Video Plan"
→ Screen 2: AI has pre-selected best template based on content category
   → "We chose Documentary for your educational content" (changeable)
   → AI has auto-marked emphasis words
   → AI has set smart durations per scene
→ User reviews, makes minor edits
→ Clicks "Approve" → images generate → preview auto-plays
→ If satisfied → one-click Export
→ If not → switch template (instant), edit text, regenerate image for specific scene
```

### Tier 3: Full Auto (WhatsApp / API)

```
Script arrives via WhatsApp/API
→ System auto-runs: detect language → generate plan → select template → generate images → render preview
→ Sends 15-second preview clip to WhatsApp
→ User replies: "👍" → full render + deliver | "change to cinematic" → re-render with new template | "scene 3 image is wrong" → regenerate scene 3 image
→ No editor involvement at all

In the editor, this shows as a completed project the user can open in Flow Mode to make tweaks.
The flow-store tracks a `source: 'editor' | 'whatsapp' | 'api'` field.
```

---

## 8. Template Switching — The "Try On" Experience

This is the make-or-break UX moment. Here's how to make it feel magical:

### Architecture

```
TemplateRenderer (PixiJS)
├── Receives: { images[], voiceovers[], template, currentTime }
├── On template change:
│   1. Keeps all loaded textures (images are the same)
│   2. Swaps only the animation/layout function
│   3. Re-renders current frame instantly (<16ms)
│   4. No loading state, no flash, no re-fetch
└── Result: Template switching feels like changing a CSS class
```

### The Interaction

1. **Hover** over a template thumbnail in the carousel → canvas shows a 1-second micro-preview of that template (ghosted/transparent over current)
2. **Click** → commits the template, preview plays from current position in new style
3. **Arrow keys** (← →) cycle through templates while preview plays — like flipping TV channels
4. **Hold Shift + Click** on two templates → split-screen comparison mode

### Why It Feels Instant

- All template logic is pure JavaScript functions (no network calls)
- Images are already loaded as PixiJS textures
- Switching template = swapping `update()` function reference
- PixiJS re-renders next frame with new animation — same 60fps loop

---

## 9. Multi-Language UX

### The Language Bar

In the Flow Mode header:

```
🌐  [EN] [TR] [+ Add]
     ▲ active
```

- Clicking a language pill switches:
  - Voiceover text shown in scene list
  - Voiceover audio played in preview
  - Text overlays in the canvas (for templates that show text)
- The images stay the same — only text/audio changes
- Adding a language triggers AI translation of all voiceover text

### Per-Scene Language View

In the scene list, each scene card shows the active language's voiceover. A small toggle reveals all languages:

```
┌──────────────────┐
│ Scene 2           │
│ [image thumbnail] │
│                   │
│ EN: "The ancient  │
│ city of..."       │
│                   │
│ ▸ Show TR, ES     │  ← collapsed by default
└──────────────────┘
```

### Export Language Selection

Export menu shows:

```
Export Video
├── Language: ○ English  ○ Turkish  ○ Both (separate files)
├── Quality:  ○ Preview (720p, browser)  ● HD (1080p, server)
└── [Export]
```

"Both" renders two separate videos with the same images but different voiceover/text, and delivers them as a zip or separate downloads.

---

## 10. Cost Transparency

### Where Cost Appears

1. **Plan Review (Screen 2):** Most prominent placement

```
┌──────────────────────────────────────────────┐
│  💰 This video                               │
│                                              │
│  Template video:  $0.05   ⚡ ~30 sec render  │
│  AI video:        $1.50   🕐 ~3 min render   │
│                                              │
│  You save: $1.45 (97%)                       │
└──────────────────────────────────────────────┘
```

2. **Template Gallery:** Each template shows its cost (some templates need more compute than others)

3. **Export Menu:** Final cost confirmation before server-side render

### Cost Breakdown Tooltip

Hover over the cost to see:
```
Image generation (12 scenes): $0.03
Template rendering:           $0.01
Voiceover TTS:                $0.01
Total:                        $0.05
```

### "Credits Remaining" in Header

Small indicator: `42 credits remaining` — one credit = one template video. Visible but not intrusive.

---

## 11. What Makes This Feel Premium

### Visual Design Principles

1. **Dark theme with accent glow.** The preview canvas has a subtle ambient glow behind it matching the dominant color of the current scene image. This makes the preview feel cinematic.

2. **Smooth transitions everywhere.** Mode switching (Studio ↔ Flow) uses a fluid layout animation (Framer Motion). Template switching uses a crossfade. Scene selection slides the list smoothly.

3. **Typography hierarchy.** Scene voiceover text uses a readable serif font in the scene list (content is literary). UI controls use the existing sans-serif. This signals: "your content is the star."

4. **Micro-interactions:**
   - Template carousel thumbnails have a subtle 3D tilt on hover (CSS perspective)
   - Scene strip blocks pulse gently when their voiceover audio is playing
   - The "Approve" button has a satisfying ripple effect
   - Export progress shows a PixiJS-rendered animation (not a boring progress bar)

5. **Empty states are invitations, not dead ends.** Instead of "No storyboards yet" with a generic icon, show a 5-second looping video of what a template video looks like, with a "Make one like this" CTA.

### The "Wow" Moments

1. **Script → Preview in 30 seconds.** User pastes script, clicks generate, and within 30 seconds sees a fully animated preview with their images, voiceover, and chosen template playing in the canvas. This is the primary wow.

2. **Template switching is instant.** No loading spinner. Click → new style. This makes people play with it and show others.

3. **Multi-language is one click.** Write in English, click Turkish, see/hear the same video in Turkish. This is unusual and impressive.

4. **The cost comparison.** Showing "$0.05 vs $1.50" at the decision point makes users feel smart for choosing templates, not like they're settling for a cheaper option.

5. **"Share Preview" button.** Before exporting, user can generate a shareable 15-second preview link (rendered client-side, hosted as a temporary URL). They can send this to a client/colleague for approval before spending credits on HD export.

---

## 12. How Studio Mode and Flow Mode Coexist

### Switching Between Modes

- A toggle in the header: `[Studio] [Flow]`
- Projects have a `mode` field but can switch freely
- Switching from Flow → Studio converts the template video into timeline clips (images on a video track, voiceover on an audio track, template-generated text on a text track)
- Switching from Studio → Flow only works if the timeline matches the flow structure (images + audio, no complex layering)
- This means users can start in Flow Mode for speed, then switch to Studio Mode for fine-tuning — then export from either

### Data Model Compatibility

Flow Mode scenes map cleanly to the existing storyboard data model:
- `scene.imageUrl` → `Scene.image_url` in Supabase
- `scene.voiceover` → multi-language voiceover in scene card
- `scene.duration` → used for timeline clip duration when switching to Studio Mode
- Template ID is stored as metadata on the storyboard record

---

## 13. Summary: Why This Is Different

| Traditional Video Template Tool | Our "Flow Mode" |
|-------------------------------|-----------------|
| Upload images manually | AI generates images from script |
| Pick template from a catalog | Template is suggested by AI, switchable instantly |
| Fill in fields one by one | AI fills everything, user reviews |
| Render and wait | Live preview in browser (PixiJS) |
| Export only | Preview → share → approve → export |
| One language | Multi-language with one-click switching |
| Separate from the editor | Integrated mode in the same app |
| Flat pricing | Per-video cost shown transparently |
| Manual workflow only | 3 tiers: manual, semi-auto, full-auto |

**The core differentiator:** This isn't a template tool bolted onto an editor. It's an AI-powered video creation flow that happens to use templates as its rendering engine. The user's mental model is "I write, AI creates" — not "I pick a template and fill in the blanks."

---

## Sources & References

- Current editor architecture: `editor/src/components/editor/editor.tsx`
- Current storyboard flow: `editor/src/components/editor/media-panel/panel/storyboard.tsx`
- PixiJS rendering capabilities: `docs/research/pixijs-video-research.md`
- Template engine comparison: `docs/research/video-template-alternatives.md`
- Media panel tabs: `editor/src/components/editor/media-panel/store.ts` (13 tabs currently)
- Canvas/PixiJS integration: `editor/src/components/editor/canvas-panel.tsx` (Studio class)
- Timeline: `editor/src/components/editor/timeline/index.tsx`
