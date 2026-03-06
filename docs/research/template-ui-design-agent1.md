# Template-Based Video — Full UI/UX Design Specification

**Date:** 2026-03-06
**Author:** Agent 1 (UI/UX Design)
**Status:** Design Proposal

---

## Table of Contents

1. [Feature Naming](#1-feature-naming)
2. [User Flow Overview](#2-user-flow-overview)
3. [Screen-by-Screen Specification](#3-screen-by-screen-specification)
4. [Component Hierarchy](#4-component-hierarchy)
5. [Integration with Existing Editor](#5-integration-with-existing-editor)
6. [Reuse vs New Components](#6-reuse-vs-new-components)
7. [Responsive Considerations](#7-responsive-considerations)

---

## 1. Feature Naming

**Feature name:** "Quick Video"
**Mode name in dropdown:** "Quick Video (Template)"
**Tab label:** Remains under "Storyboard" tab (not a new tab)

**Rationale:** "Quick Video" communicates the key value proposition — fast, cheap, no AI video generation wait. Keeping it under the existing Storyboard tab avoids tab bloat and positions it as a natural alternative to "Image to Video" and "Ref to Video". The user's mental model stays the same: write a script → pick a mode → generate.

**Alternative names considered:**
- "Template Video" — too technical, implies the user needs to understand templates
- "Instant Video" — overpromises, rendering still takes time
- "Smart Slideshow" — undersells the quality; these aren't basic slideshows

---

## 2. User Flow Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    CREATION FLOW                             │
│                                                              │
│  Step 1: Write Script                                        │
│  ├── User enters voiceover text in the existing textarea     │
│  ├── Selects source language                                 │
│  └── Selects aspect ratio (16:9, 9:16, 1:1)                │
│                                                              │
│  Step 2: Choose Mode                                         │
│  ├── "Image to Video" (existing)                             │
│  ├── "Ref to Video" (existing)                               │
│  └── "Quick Video" ← NEW                                     │
│                                                              │
│  Step 3: Pick Template (NEW — only for Quick Video)          │
│  ├── Template gallery appears inline                         │
│  ├── User browses/filters templates                          │
│  └── User clicks to select one                               │
│                                                              │
│  Step 4: Generate Plan                                       │
│  ├── AI generates scene plan (image prompts + text overlays) │
│  ├── User reviews/edits in DraftPlanEditor                   │
│  └── User approves                                           │
│                                                              │
│  Step 5: Image Generation + Review                           │
│  ├── Grid image generated → auto-split                       │
│  ├── User reviews split images                               │
│  ├── Voiceover generated per scene                           │
│  └── User approves images (same GridImageReview)             │
│                                                              │
│  Step 6: Template Preview (NEW)                              │
│  ├── PixiJS renders template in canvas panel                 │
│  ├── Timeline shows template structure                       │
│  ├── User can scrub, play/pause                              │
│  ├── User can swap images, edit text overlays                │
│  └── User can change template without regenerating images    │
│                                                              │
│  Step 7: Export                                              │
│  ├── "Quick Export" → browser-side (Compositor)              │
│  └── "HD Export" → server-side (FFmpeg/Remotion)             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Screen-by-Screen Specification

### 3.1 Mode Selection (Modified Existing Screen)

**Location:** Bottom input section of PanelStoryboard, inside the "Create Mode" form.

**Current state:** A `<Select>` dropdown with two options: "Image to Video" and "Ref to Video".

**Change:** Add a third option: "Quick Video (Template)". When selected, a template picker section appears below the mode selector.

```
┌─────────────────────────────────────────┐
│  Voiceover Script                        │
│  ┌─────────────────────────────────────┐ │
│  │ Enter your voiceover script...      │ │
│  │                                     │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  Source Language                          │
│  ┌──────────────────────────────┐        │
│  │ English — en            ▾    │        │
│  └──────────────────────────────┘        │
│                                          │
│  ┌──────┐  ┌────────────────────────┐    │
│  │ 9:16 │  │ Quick Video (Template)▾│    │
│  └──────┘  └────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────┐        │
│  │ Gemini 3.1 Pro           ▾   │        │
│  └──────────────────────────────┘        │
│                                          │
│  ┌─ Template ───────────────────────┐    │
│  │  ╔═══════╗ ╔═══════╗ ╔═══════╗  │    │
│  │  ║ Ken   ║ ║ Doc   ║ ║TikTok ║  │    │
│  │  ║ Burns ║ ║ Style ║ ║Impact ║  │    │
│  │  ╚═══════╝ ╚═══════╝ ╚═══════╝  │    │
│  │  ╔═══════╗ ╔═══════╗ ╔═══════╗  │    │
│  │  ║Parall-║ ║ Split ║ ║Minimal║  │    │
│  │  ║  ax   ║ ║Screen ║ ║       ║  │    │
│  │  ╚═══════╝ ╚═══════╝ ╚═══════╝  │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │        Generate Storyboard        │    │
│  └──────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

**Behavior:**
- When user selects "Quick Video (Template)", the Video Model dropdown (`klingo3`, etc.) is hidden (not needed — no AI video generation).
- The Template Picker section fades in below the controls row, pushing the Generate button down.
- The AI model selector stays visible (still needed for plan generation).
- A template MUST be selected before the Generate button is enabled.

**Template Picker (inline):**
- A 3-column grid of template thumbnails within the bottom form area.
- Each thumbnail is ~80x45px (16:9 aspect) or ~45x80px (9:16 aspect), adapting to the selected aspect ratio.
- Selected template gets a `ring-2 ring-primary` border.
- Thumbnail shows a static preview frame from the template.
- Name below each thumbnail in `text-[10px]`.
- Maximum 6 templates visible; scroll if more. "See all" link opens a full gallery overlay.

**Component changes:**
- Modify `VIDEO_MODES` array in `storyboard.tsx` to add `{ value: 'quick_video', label: 'Quick Video (Template)' }`.
- Add `formTemplate` state (`string | null`).
- Conditionally render `<TemplatePicker>` when `formVideoMode === 'quick_video'`.
- Hide Video Model selector when `formVideoMode === 'quick_video'`.

---

### 3.2 Template Picker — Full Gallery (Overlay)

**Trigger:** "See all templates" link in the inline picker, or clicking a "Browse Templates" button.

**Location:** A modal overlay (using shadcn `Dialog`) that covers the media panel area. Not a full-screen modal — scoped to the left panel.

```
┌─────────────────────────────────────────┐
│  ← Back                   Templates     │
│─────────────────────────────────────────│
│  ┌──────────────────────────────────┐   │
│  │ 🔍 Search templates...           │   │
│  └──────────────────────────────────┘   │
│                                          │
│  Filter: [All] [Education] [Story]       │
│          [Product] [Social]              │
│                                          │
│  ┌─────────────┐  ┌─────────────┐       │
│  │             │  │             │       │
│  │  ANIMATED   │  │  ANIMATED   │       │
│  │  PREVIEW    │  │  PREVIEW    │       │
│  │  (on hover) │  │  (on hover) │       │
│  │             │  │             │       │
│  ├─────────────┤  ├─────────────┤       │
│  │ Ken Burns   │  │ Documentary │       │
│  │ Smooth zoom │  │ Narrated    │       │
│  │ & pan       │  │ factual     │       │
│  │ ───────────-│  │ ───────────-│       │
│  │ Best for:   │  │ Best for:   │       │
│  │ Science,    │  │ History,    │       │
│  │ Nature      │  │ Science     │       │
│  └─────────────┘  └─────────────┘       │
│                                          │
│  ┌─────────────┐  ┌─────────────┐       │
│  │             │  │             │       │
│  │  TikTok     │  │  Parallax   │       │
│  │  Impact     │  │  Depth      │       │
│  │             │  │             │       │
│  ├─────────────┤  ├─────────────┤       │
│  │ Bold text,  │  │ Layered     │       │
│  │ fast cuts   │  │ depth       │       │
│  │ ───────────-│  │ ───────────-│       │
│  │ Best for:   │  │ Best for:   │       │
│  │ Social,     │  │ Travel,     │       │
│  │ Marketing   │  │ Landscape   │       │
│  └─────────────┘  └─────────────┘       │
│                                          │
└─────────────────────────────────────────┘
```

**Template Card Details:**
- **Size:** 2-column grid within the panel (~140px wide each).
- **Thumbnail:** 16:9 or 9:16 preview image. On hover: plays a 3-5 second looping GIF/video preview.
- **Name:** Bold, `text-sm`.
- **Description:** 1-line summary, `text-xs text-muted-foreground`.
- **Best-for tag:** Colored pill badge, `text-[10px]` — e.g., `bg-blue-500/10 text-blue-500` for "Science", `bg-green-500/10 text-green-500` for "Nature".
- **Selection:** Click to select → card gets `ring-2 ring-primary` + checkmark overlay. Clicking "Back" returns to the form with the selection preserved.

**Filter tags:**
- Horizontal scrollable row of pill buttons.
- `All | Education | Story | Product | Social | Documentary | Minimal`
- Active filter: `bg-primary text-primary-foreground`. Inactive: `bg-secondary text-muted-foreground`.

**Search:**
- Simple text input that filters by template name and description.
- Debounced, client-side filtering (templates are a small static list).

---

### 3.3 Plan Generation (Modified Existing Screen)

**Location:** Same DraftPlanEditor component, but with template-specific plan structure.

**What changes for Quick Video plans:**

The AI generates a plan with these fields (instead of the current i2v/ref plan):
- `grid_image_prompt` — same as i2v (prompt for the grid image)
- `rows` / `cols` — same as i2v
- `voiceover_list` — same (per-language voiceover text per scene)
- `visual_flow` — same (description of visual progression)
- `text_overlays` — **NEW**: per-scene text overlay strings (e.g., titles, captions, key facts)
- `template_config` — **NEW**: template-specific overrides (colors, font suggestion, pacing)

**Plan Editor UI for Quick Video:**

```
┌─────────────────────────────────────────┐
│  Draft Plan — Quick Video                │
│  Template: Ken Burns  [Change]           │
│─────────────────────────────────────────│
│                                          │
│  Scene 1                                 │
│  ┌─────────────────────────────────────┐ │
│  │ Voiceover: "The Amazon rainforest   │ │
│  │ is home to 10% of all species..."   │ │
│  ├─────────────────────────────────────┤ │
│  │ Text Overlay: "10% of All Species"  │ │ ← NEW field
│  ├─────────────────────────────────────┤ │
│  │ Visual: Wide aerial shot of dense   │ │
│  │ canopy, morning mist rising...      │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  Scene 2                                 │
│  ┌─────────────────────────────────────┐ │
│  │ Voiceover: "Every year, 17% of..."  │ │
│  ├─────────────────────────────────────┤ │
│  │ Text Overlay: "17% Lost Annually"   │ │
│  ├─────────────────────────────────────┤ │
│  │ Visual: Satellite view showing...   │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  ... more scenes ...                     │
│                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Cancel   │  │Regenerate│  │Approve │ │
│  └──────────┘  └──────────┘  └────────┘ │
└─────────────────────────────────────────┘
```

**Key differences from i2v/ref plan:**
- Shows the selected template name at the top with a "Change" button (opens template picker without losing the plan).
- Each scene card has a new "Text Overlay" editable field.
- No video model information (not applicable).
- The "Visual" field maps to the image generation prompt (same as `visual_flow`).
- All fields are editable (same as current DraftPlanEditor behavior).

**Component changes:**
- Extend `DraftPlanEditor` to accept a `templateId` prop and `textOverlays` in the plan.
- Add `text_overlays` field rendering when `mode === 'quick_video'`.
- Show template name badge and "Change" button at the top.

---

### 3.4 Image Generation + Review

**Location:** Same StoryboardCards area with GridImageReview.

**Flow:**
1. After plan approval, grid image is generated (same as i2v).
2. Grid image appears in the GridImageReview component.
3. User reviews the grid, adjusts rows/cols if needed, clicks "Approve & Split".
4. Images are auto-split into individual scene images.
5. **Additionally for Quick Video:** Voiceover is generated per scene (TTS) in parallel with image generation.

**What changes:**
- The GridImageReview component is **reused as-is**. No changes needed.
- After grid approval, scenes enter a combined state: image ready + voiceover generating.
- Scene cards show a voiceover generation progress indicator (already exists in StoryboardCards).

**No changes to the grid review UI.** The template is applied AFTER images and voiceover are ready. The user reviews raw images, not templated images.

---

### 3.5 Template Preview (NEW — Major New Screen)

**Trigger:** All scene images are split AND voiceover is generated. A "Preview Template" button appears in the StoryboardCards area.

**Location:** This is the most significant new UI. It takes over BOTH the left panel AND the canvas:

- **Left panel (MediaPanel area):** Shows template controls + scene list
- **Center canvas:** PixiJS renders the template preview live
- **Bottom timeline:** Shows template structure (scenes as blocks)

```
┌──────────────────────┬────────────────────────────────────────────┐
│  TEMPLATE CONTROLS   │                                            │
│  (Left Panel)        │          CANVAS — TEMPLATE PREVIEW         │
│                      │                                            │
│  ┌────────────────┐  │     ┌──────────────────────────────┐       │
│  │ Template:      │  │     │                              │       │
│  │ Ken Burns   ▾  │  │     │                              │       │
│  └────────────────┘  │     │    [Scene 3 of 8]            │       │
│                      │     │                              │       │
│  ┌────────────────┐  │     │    Image with Ken Burns      │       │
│  │ Style          │  │     │    zoom effect applied       │       │
│  │ ──────────     │  │     │                              │       │
│  │ Font: Inter    │  │     │    ┌────────────────────┐    │       │
│  │ Color: #fff ●  │  │     │    │ "17% Lost Annually"│    │       │
│  │ BG: #000   ●   │  │     │    └────────────────────┘    │       │
│  │ Speed: ████░░  │  │     │                              │       │
│  └────────────────┘  │     └──────────────────────────────┘       │
│                      │                                            │
│  Scenes              │          ▶ 00:15 / 01:02                   │
│  ──────              │                                            │
│  ┌────────────────┐  ├────────────────────────────────────────────┤
│  │ 1. [img] Amaz. │  │ TIMELINE — TEMPLATE STRUCTURE              │
│  │    "10% of..." │  │                                            │
│  ├────────────────┤  │  ┌──┬──┬──┬──┬──┬──┬──┬──┐                │
│  │ 2. [img] Defo. │  │  │S1│S2│S3│S4│S5│S6│S7│S8│ ← image track  │
│  │    "17% Lost"  │  │  └──┴──┴──┴──┴──┴──┴──┴──┘                │
│  ├────────────────┤  │  ┌──┬──┬──┬──┬──┬──┬──┬──┐                │
│  │ 3. [img] Spec. │  │  │V1│V2│V3│V4│V5│V6│V7│V8│ ← voiceover    │
│  │    "Every min" │  │  └──┴──┴──┴──┴──┴──┴──┴──┘                │
│  ├────────────────┤  │  ┌──┬──┬──┬──┬──┬──┬──┬──┐                │
│  │ ▶ Playing...   │  │  │T1│T2│T3│T4│T5│T6│T7│T8│ ← text overlay  │
│  │   Scene 3      │  │  └──┴──┴──┴──┴──┴──┴──┴──┘                │
│  └────────────────┘  │       ▲                                    │
│                      │       playhead                              │
│  [← Back to Scenes]  │                                            │
└──────────────────────┴────────────────────────────────────────────┘
```

#### Left Panel: Template Controls

**Section 1: Template Selector**
- Dropdown to change the template. Changing the template re-renders the preview instantly (images and voiceover stay the same, only the visual treatment changes).
- Below the dropdown: "Customize" disclosure that expands template settings.

**Section 2: Template Customization (collapsible)**
```
┌────────────────────────┐
│ ▼ Customize             │
│                         │
│ Font                    │
│ ┌───────────────────┐   │
│ │ Inter           ▾ │   │
│ └───────────────────┘   │
│                         │
│ Text Color     [●]#fff  │
│ Background     [●]#000  │
│ Accent         [●]#3b82 │
│                         │
│ Transition Speed        │
│ ██████████░░░░  1.0s    │
│                         │
│ Text Position           │
│ ○ Top  ● Center  ○ Bot  │
│                         │
│ Zoom Intensity          │
│ ████████░░░░░░  1.15x   │
│                         │
│ [Reset to Defaults]     │
└────────────────────────┘
```

- **Font:** Select from 5-8 pre-loaded fonts (must be available in PixiJS BitmapText).
- **Colors:** Small color dot buttons that open a color picker (use existing shadcn popover + simple color input).
- **Transition speed:** Slider, 0.3s to 2.0s, default depends on template.
- **Text position:** Radio group — top, center, bottom.
- **Zoom intensity:** Slider for Ken Burns zoom amount (1.0x to 1.3x). Only shown for templates that use zoom.
- **Reset to Defaults:** Ghost button to restore template defaults.

**Section 3: Scene List**
- Scrollable list of scene cards, each showing:
  - Small thumbnail (32x32px) of the scene image.
  - Scene number.
  - First ~30 chars of the text overlay, truncated.
  - Click to seek the preview to that scene.
  - Active/playing scene highlighted with `bg-primary/10 border-l-2 border-primary`.

**Scene card actions (on hover/click):**
- **Swap Image:** Click the thumbnail → opens a mini file picker (existing upload images or regenerate).
- **Edit Text:** Click the text → inline editable text field. Changes reflect in preview immediately.
- **Play this scene:** Click play icon → preview jumps to this scene's start time.

**Back navigation:**
- "← Back to Scenes" button at the bottom returns to the normal StoryboardCards view.

#### Center Canvas: Template Preview

The existing `CanvasPanel` renders the template preview using the Studio/Compositor:

- PixiJS renders the template frame-by-frame: background images with effects (Ken Burns zoom, parallax), text overlays with animations (fade-in, typewriter, slide-up), transitions between scenes (crossfade, slide, wipe).
- **Play/Pause button** centered below the canvas: `▶ 00:15 / 01:02` format.
- **Scrubbing:** User can click/drag anywhere on the timeline to scrub.
- Audio plays in sync when previewing (voiceover).

**Technical note:** The preview uses the existing `Studio` instance. Template scenes are added as clips (ImageClip + TextClip + transitions) to the openvideo timeline model. This means the template preview IS the actual editor timeline — the user can further tweak clips directly on the canvas if they want.

#### Bottom Timeline: Template Structure

The existing Timeline component shows the template structure:

- **Track 1 (Image):** Scene images as rectangular blocks, each sized proportionally to its duration. Thumbnails shown inside blocks.
- **Track 2 (Voiceover):** Audio waveform blocks per scene.
- **Track 3 (Text):** Text overlay blocks per scene (showing the text string).
- **Playhead:** Red vertical line that syncs with preview playback.
- **Transitions:** Small diamond/overlap indicators between scene blocks.

This uses the existing Timeline component — the template populates the timeline automatically. The user CAN drag to reorder or adjust durations, but this is an advanced action; the template provides sensible defaults.

---

### 3.6 Export Flow

**Trigger:** User clicks "Export" button. Two locations:
1. In the left panel Template Controls area (a prominent button at the top).
2. In the existing Renders tab (consistent with current export flow).

**Export Options Dialog:**

```
┌───────────────────────────────────┐
│  Export Quick Video                │
│                                    │
│  ┌──────────────────────────────┐  │
│  │  ⚡ Quick Export              │  │
│  │  720p · Browser rendering    │  │
│  │  ~30 seconds                 │  │
│  │  Free                        │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │  ✨ HD Export                 │  │
│  │  1080p · Server rendering    │  │
│  │  ~2-3 minutes                │  │
│  │  Uses 1 render credit        │  │
│  └──────────────────────────────┘  │
│                                    │
│  Format: MP4 (H.264)              │
│                                    │
│  ┌──────────────────────────────┐  │
│  │        Start Export           │  │
│  └──────────────────────────────┘  │
└───────────────────────────────────┘
```

**Quick Export (Browser):**
- Uses the existing Compositor + VideoEncoder pipeline.
- Progress bar replaces the canvas during rendering: `Rendering... 45% (Frame 810/1800)`.
- Output: 720p MP4 downloaded directly.
- No server cost.

**HD Export (Server):**
- Sends scene data + template config to the server.
- Server renders via FFmpeg (Phase 1) or Remotion (Phase 2).
- Progress polling: `Rendering on server... 60%`.
- Output: 1080p MP4, uploaded to R2/S3, download link provided.
- Result appears in the Renders tab.

**Progress Indicator:**
- Replaces the "Export" button with a progress bar + percentage.
- Cancel button appears next to the progress bar.
- On completion: "Download" button + "Open in Renders" link.
- Toast notification: "Your Quick Video is ready! [Download]"

---

### 3.7 Template Customization — Depth Levels

Three levels of customization, progressively disclosed:

**Level 1: Template Selection (everyone)**
- Pick a template from the gallery. Done. No customization needed.
- The template applies sensible defaults based on the content.

**Level 2: Style Tweaks (optional, in left panel)**
- Font, colors, transition speed, text position.
- Exposed in the "Customize" collapsible section.
- Changes are live-previewed in the canvas.

**Level 3: Per-Scene Overrides (power users)**
- Click a scene in the timeline or scene list.
- Properties panel (right side, if copilot is hidden) or inline in left panel shows:
  - Image: swap, crop, zoom override
  - Text overlay: edit content, size, animation style
  - Duration: override auto-calculated duration
  - Transition: override the template's default transition for this scene
- This level maps to editing individual clips in the openvideo timeline model.

---

## 4. Component Hierarchy

### New Components

```
editor/src/components/editor/media-panel/panel/
├── storyboard.tsx                          (MODIFY — add quick_video mode)
├── template-picker.tsx                     (NEW)
│   ├── TemplatePickerInline               — 3-col grid in the form
│   └── TemplatePickerFull                 — Full gallery overlay
├── template-card.tsx                       (NEW)
│   └── TemplateCard                       — Single template thumbnail + info
├── template-preview-controls.tsx           (NEW)
│   ├── TemplateSelector                   — Dropdown to change template
│   ├── TemplateCustomizer                 — Style tweaks (collapsible)
│   └── TemplateSceneList                  — Scrollable scene list
├── template-export-dialog.tsx              (NEW)
│   └── TemplateExportDialog               — Quick/HD export options
└── draft-plan-editor.tsx                   (MODIFY — add text_overlays field)

editor/src/lib/
├── templates/                              (NEW)
│   ├── types.ts                           — VideoTemplate, TemplateConfig interfaces
│   ├── registry.ts                        — Template registry (list of all templates)
│   ├── ken-burns.ts                       — Ken Burns template definition
│   ├── documentary.ts                     — Documentary template definition
│   ├── tiktok-impact.ts                   — TikTok Impact template definition
│   ├── parallax.ts                        — Parallax template definition
│   ├── split-screen.ts                    — Split Screen template definition
│   └── minimal.ts                         — Minimal template definition

editor/src/stores/
└── template-store.ts                       (NEW)
    — selectedTemplate, templateConfig, customizations

editor/src/hooks/
└── use-template-preview.ts                 (NEW)
    — Hook that manages PixiJS template rendering in the Studio
```

### Modified Components

```
storyboard.tsx          — Add 'quick_video' to VIDEO_MODES, add formTemplate state,
                          conditionally render TemplatePicker
draft-plan-editor.tsx   — Render text_overlays field when mode is quick_video
storyboard-cards.tsx    — Add "Preview Template" button when all scenes are ready
                          and mode is quick_video
store.ts (media-panel)  — No changes needed (stays in storyboard tab)
```

---

## 5. Integration with Existing Editor

### How Quick Video Fits Into the Current Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Header (save status, project name, export button)              │
├──────────────┬──────────────────────────────┬───────────────────┤
│              │                              │                   │
│  MediaPanel  │       CanvasPanel            │  Copilot/         │
│  (Left)      │       (Center)               │  Assistant        │
│              │                              │  (Right,          │
│  TabBar      │  PixiJS Studio canvas        │   optional)       │
│  ──────────  │  - Normal mode: timeline     │                   │
│  Content:    │    clips as usual             │                   │
│  - Storyboard│  - Template preview mode:    │                   │
│    (contains │    template rendering         │                   │
│     Quick    │                              │                   │
│     Video)   │                              │                   │
│              │                              │                   │
│              ├──────────────────────────────┤                   │
│              │       Timeline (Bottom)       │                   │
│              │  - Normal: user clips         │                   │
│              │  - Template: auto-populated   │                   │
│              │    scene blocks               │                   │
└──────────────┴──────────────────────────────┴───────────────────┘
```

### State Machine (Quick Video Mode in StoryboardCards)

```
ViewMode states for Quick Video:

create → (generate) → draft → (approve) → view
                                              │
                                              ├── scenes generating
                                              ├── grid_review (GridImageReview)
                                              ├── images splitting
                                              ├── voiceover generating
                                              ├── all_ready
                                              │     │
                                              │     └── (click "Preview Template")
                                              │           │
                                              │           └── template_preview ← NEW STATE
                                              │                 │
                                              │                 ├── user scrubs, edits, swaps
                                              │                 ├── user changes template
                                              │                 └── user exports
                                              │
                                              └── (back to scene cards)
```

When entering `template_preview` state:
1. The left panel content switches from StoryboardCards to TemplatePreviewControls.
2. The Studio is populated with template clips (images + text + transitions).
3. The Timeline shows the template structure.
4. The user interacts with the preview.

When leaving `template_preview` (clicking "Back to Scenes"):
1. Template clips are cleared from the Studio.
2. Left panel returns to StoryboardCards.
3. Timeline returns to its previous state.

### Data Flow

```
User Script
    ↓
AI Plan Generation (/api/storyboard POST)
    ↓ includes text_overlays + template_id
Draft Plan (DraftPlanEditor)
    ↓ user approves
Scene Generation (/api/storyboard/approve POST)
    ↓ grid image → auto-split → voiceover TTS
Scene Data (images[], voiceovers[], text_overlays[])
    ↓
Template Renderer (PixiJS in browser)
    ↓ reads from template-store + scene data
Canvas Preview (Studio)
    ↓
Export (Compositor for browser / API for server)
    ↓
MP4 Output
```

### API Changes

**POST /api/storyboard** — Modified request body:
```json
{
  "voiceoverText": "...",
  "model": "google/gemini-3.1-pro-preview",
  "projectId": "...",
  "aspectRatio": "9:16",
  "mode": "quick_video",
  "sourceLanguage": "en",
  "templateId": "ken-burns"
}
```

**Response includes new fields:**
```json
{
  "storyboard_id": "...",
  "mode": "quick_video",
  "template_id": "ken-burns",
  "rows": 3,
  "cols": 4,
  "grid_image_prompt": "...",
  "voiceover_list": { "en": ["Scene 1 text...", ...] },
  "visual_flow": ["Wide aerial shot...", ...],
  "text_overlays": ["10% of All Species", "17% Lost Annually", ...]
}
```

**POST /api/template/export** — New endpoint:
```json
{
  "storyboardId": "...",
  "templateId": "ken-burns",
  "quality": "hd",
  "templateConfig": {
    "font": "Inter",
    "textColor": "#ffffff",
    "bgColor": "#000000",
    "transitionSpeed": 1.0,
    "textPosition": "center",
    "zoomIntensity": 1.15
  }
}
```

---

## 6. Reuse vs New Components

### Reused As-Is
| Component | Why |
|-----------|-----|
| `GridImageReview` | Grid review flow is identical for Quick Video |
| `DraftPlanEditor` (mostly) | Same plan editing UX, just add text_overlays field |
| `StoryboardCards` (mostly) | Scene card management, status tracking, polling |
| `SceneCard` | Individual scene display with image/voiceover status |
| `StatusBadge` | Scene status indicators |
| `VoiceoverPlayButton` | Audio playback per scene |
| `TabBar` | No changes — Quick Video lives under Storyboard tab |
| `CanvasPanel` | Same Studio instance, template populates it |
| `Timeline` | Auto-populated by template, same scrub/playhead behavior |
| All shadcn components | Button, Select, Slider, Dialog, Collapsible, ScrollArea, etc. |

### Modified (Small Changes)
| Component | Change |
|-----------|--------|
| `storyboard.tsx` | Add `quick_video` mode, `formTemplate` state, render TemplatePicker |
| `draft-plan-editor.tsx` | Add `text_overlays` editable field for quick_video mode |
| `storyboard-cards.tsx` | Add "Preview Template" button when all scenes ready + mode is quick_video |
| `workflow-service.ts` | Add `template_id`, `text_overlays` to Storyboard type |

### New Components
| Component | Purpose | Complexity |
|-----------|---------|------------|
| `TemplatePicker` (inline + full) | Browse and select templates | Medium |
| `TemplateCard` | Single template display | Low |
| `TemplatePreviewControls` | Left panel during preview mode | Medium |
| `TemplateCustomizer` | Style tweaks (font, colors, speed) | Medium |
| `TemplateSceneList` | Scrollable scene list with actions | Medium |
| `TemplateExportDialog` | Export options (Quick/HD) | Low |
| `template-store.ts` | Zustand store for template state | Low |
| `use-template-preview.ts` | Hook for PixiJS template rendering | High |
| Template definitions (6+) | Ken Burns, Documentary, TikTok, etc. | High (per template) |

---

## 7. Responsive Considerations

**Desktop-first design.** The editor is primarily a desktop tool. However:

- **Narrow left panel (15-25% width):** Template picker thumbnails switch from 3-col to 2-col. Template controls stack vertically. Scene list items become more compact.
- **Wide left panel (25-40% width):** Template picker can show 3-4 columns. Scene list shows full text overlays.
- **Small canvas:** Preview still works — PixiJS renders to whatever size the canvas is. Play/pause controls overlay the canvas.
- **Timeline height:** Template scene blocks use the same responsive sizing as regular timeline clips.

**Minimum viable widths:**
- Left panel: 250px (below this, template picker becomes unusable)
- Canvas: 400px (enough for meaningful preview)
- Timeline: 150px height (enough to show 3 tracks)

---

## Appendix A: Template Definitions (Initial Set)

| ID | Name | Description | Best For | Key Effect |
|----|------|-------------|----------|------------|
| `ken-burns` | Ken Burns | Smooth zoom & pan on each image with crossfade transitions | Science, Nature, Documentary | Slow zoom 1.0→1.15x, crossfade |
| `documentary` | Documentary | Narrated factual style with lower-third text and fade transitions | History, Science, Education | Text lower-third, fade transitions |
| `tiktok-impact` | TikTok Impact | Bold centered text, fast cuts, high energy | Social Media, Marketing | Large bold text, quick cuts, slam text |
| `parallax` | Parallax Depth | Layered depth effect with slow horizontal movement | Travel, Landscape, Architecture | Foreground/background separation, horizontal drift |
| `split-screen` | Split Screen | Two images shown side-by-side with comparison text | Comparison, Before/After, Science | Side-by-side layout, alternating |
| `minimal` | Minimal Clean | Simple fade-in images with subtle text, no distractions | Corporate, Product, Professional | Clean fades, centered text, minimal animation |

---

## Appendix B: Template Data Model

```typescript
// Stored in Supabase alongside storyboard
interface QuickVideoPlan {
  rows: number;
  cols: number;
  grid_image_prompt: string;
  voiceover_list: Record<string, string[]>;
  visual_flow: string[];
  text_overlays: string[];           // NEW: per-scene text
}

// Template definition (client-side)
interface VideoTemplate {
  id: string;
  name: string;
  description: string;
  bestFor: string[];
  thumbnail: string;                 // URL to preview image
  previewVideo?: string;             // URL to preview loop video
  defaultConfig: TemplateConfig;
  // Creates clips for the openvideo timeline
  buildTimeline(
    scenes: SceneData[],
    config: TemplateConfig,
    studio: Studio
  ): void;
}

interface TemplateConfig {
  font: string;
  textColor: string;
  bgColor: string;
  accentColor: string;
  transitionSpeed: number;           // seconds
  textPosition: 'top' | 'center' | 'bottom';
  zoomIntensity: number;             // 1.0 to 1.3
  // Template-specific extras
  [key: string]: unknown;
}

interface SceneData {
  imageUrl: string;
  voiceoverUrl: string;
  voiceoverDuration: number;
  textOverlay: string;
  index: number;
}
```

---

## Appendix C: Key Design Decisions & Rationale

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Where to put Quick Video? | Under existing Storyboard tab as a mode | Avoids tab bloat; same mental model (script → mode → generate) |
| Template picker location? | Inline in form + full gallery overlay | Inline for quick selection; overlay for browsing. Keeps the flow linear. |
| Separate preview screen? | Yes, takes over left panel + canvas | Template preview is a different interaction model; needs dedicated UI |
| Template customization depth? | 3 levels (pick → tweak → per-scene) | Progressive disclosure: simple for beginners, powerful for experts |
| How to render preview? | PixiJS via existing Studio/Compositor | Already have the infrastructure; no new dependencies |
| Server-side export? | FFmpeg (Phase 1), Remotion (Phase 2) | Per research docs — FFmpeg is free and sufficient for MVP |
| New tab vs mode dropdown? | Mode dropdown | Consistent with existing i2v/ref pattern; fewer UI changes |
| Text overlays in plan? | Yes, AI generates them | Reduces manual work; AI can extract key facts from voiceover script |
| Can user change template after image gen? | Yes, without regenerating images | Key UX win — images are template-agnostic; only the rendering layer changes |

---

*End of specification.*
