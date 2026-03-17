# Octupost Product Spec v2 — Agent-Driven Video Editor

## Core Concept

An AI agent creates videos through conversation. The editor is a preview + approval surface, not an input surface. Same API serves both agents and manual users.

---

## Two Production Modes

| | Narrative | Cinematic |
|---|---|---|
| **Story delivery** | TTS voiceover narrates over video | Kling O3 native audio (dialogue + ambient) |
| **Audio source** | ElevenLabs v2.5 via fal.ai | Kling O3 built-in |
| **Scene prompt style** | Visual action + body language only. No speaking. | Dialogue cues, emotional delivery, ambient sounds |
| **Use case** | Storytelling, explainers, series narration | Drama, dialogue-heavy scenes, trailers |
| **Voice config** | voice_id per language in series metadata | N/A |

---

## Locked Models

| Purpose | Model | Pricing |
|---------|-------|---------|
| Images | nano-banana-2 (fal.ai) | $0.08/image (1K), 1.5× for 2K, 2× for 4K |
| Video | Kling O3 ref-to-video (fal.ai) | $0.084/5s (no audio) · $0.112/5s (with audio) |
| TTS | ElevenLabs turbo-v2.5 (fal.ai) | ~$0.02/scene |
| LLM | Claude (the agent itself) | Part of agent runtime |

---

## Architecture

### Two Layers

**Layer 1 — Series Assets (created once, reused forever)**
- Characters, locations, props
- Each has a default reference image (generated via grid)
- Variants for lasting changes (injury, wardrobe change across episodes)
- Short-term changes (wet, different expression) → handled by scene prompt

**Layer 2 — Episode Scenes (per storyboard)**
- References Layer 1 assets by ID
- Scene prompt, voiceover text, duration
- No object/background definitions inline

```
Series Assets (Layer 1)              Episode Storyboard (Layer 2)
┌─────────────────────────┐          ┌──────────────────────────────┐
│ Elena [ref image ✓]     │          │ Scene 1: Elena + Lobby       │
│ Receptionist [ref ✓]    │──refs──▶ │ Scene 2: Elena + Receptionist│
│ Room 4B [ref ✓]         │          │ Scene 3: Elena + Hallway     │
│ Hallway [ref ✓]         │          │ voiceover, prompt, duration  │
│ Lobby [ref ✓]           │          └──────────────────────────────┘
└─────────────────────────┘
```

### No Per-Episode Grids
Series asset images go directly to Kling O3 as references. Grid images are ONLY for initial asset creation at the series level.

### No First-Frame Generation
Killed. Kling O3 composes from references + prompt directly. Saves $0.08/scene.

---

## Grid Image Specifications (Locked)

| Setting | Value |
|---------|-------|
| Grid sizes | 2×2 (4 items) or 3×3 (9 items) ONLY |
| Aspect ratio | Always 1:1 (square) |
| Resolution | Always 4K (4096×4096) |
| Model | nano-banana-2 |
| Cell format | Equal-size cells, 1px black grid lines |
| Prompt format | `"A NxN Grid. Grid_1x1: [desc]. Grid_1x2: [desc]..."` |
| Style | Injected from series metadata |
| No-text suffix | Always appended (prevents text artifacts) |

### Grid Prompt Template — Characters
```
Photorealistic cinematic style with natural skin texture. Grid image with 
each cell in the same size with 1px black grid lines. Each cell shows one 
character on a neutral white background, front-facing, full body visible 
from head to shoes, clearly separated. Each character must show their 
complete outfit clearly visible. {style_from_metadata}
```

### Grid Prompt Template — Locations
```
Photorealistic cinematic style. Grid image with each cell in the same size 
with 1px black grid lines. Each cell shows one empty environment/location 
with no people, with varied cinematic camera angles. Locations should feel 
lived-in and atmospheric with natural lighting and environmental details. 
{style_from_metadata}
```

### Grid Prompt Template — Props
```
Product photography style. Grid image with each cell in the same size with 
1px black grid lines. Each cell shows one object/prop on a clean neutral 
background. Centered composition, studio lighting, high detail. 
{style_from_metadata}
```

---

## Series Metadata Schema

```typescript
interface SeriesMetadata {
  // Production mode
  mode: "narrative" | "cinematic";
  
  // Episode planning  
  target_episode_count: number;
  target_episode_duration_seconds: number; // e.g. 60, 120, 180
  pacing: "slow" | "medium" | "fast";
  
  // Voice (narrative mode only)
  voice_id: string; // ElevenLabs voice ID
  
  // Visual style (injected into all prompts)
  style: {
    setting: string;        // "1990s European hotel"
    time_period: string;    // "Late 1990s"
    visual_style: string;   // "photorealistic" | "animated" | "anime" | "stylized"
    color_palette: string;  // "muted, desaturated, cold tones with warm lamp accents"
    lighting: string;       // "dim, claustrophobic, surveillance-camera aesthetic"
    mood: string;           // "paranoid, tense, isolated"
    camera_style: string;   // "slow deliberate movements, voyeuristic angles, tight framing"
    custom_notes: string;   // anything else
  };
}
```

The `style` object gets serialized into a style suffix appended to ALL prompts (grid generation, scene prompts, etc). This ensures visual consistency across every generated asset.

---

## Storyboard Scene Schema (v2)

```typescript
interface ScenePlan {
  previous_episode_summary?: string;  // context from prior episode for continuity
  scenes: Array<{
    // Asset references (IDs from series assets)
    characters: string[];           // asset IDs
    character_variants?: (string | null)[];  // variant IDs, null = default
    location: string;               // asset ID
    location_variant?: string | null;
    props?: string[];               // asset IDs
    
    // Generation
    prompt: string;                 // Kling O3 scene prompt with @Element/@Image refs
    voiceover: string;              // single language, one string per scene
    duration: number;               // seconds — auto-rounded to 5/10/15 buckets
    
    // Creative direction
    pacing?: "slow_tension" | "medium" | "quick_reveal" | "frantic";
    transition_hint?: string;       // e.g. "Elena is already seated inside"
  }>;
}
```

**No grid prompts. No first-frame prompts. No object/background definitions. Just scenes referencing existing assets.**

---

## Approval Gates

| Action | Cost | Approver |
|--------|------|----------|
| Grid image generation (series assets) | ~$0.08/grid | Agent (auto) |
| Grid split into individual assets | Free | Agent (auto) |
| TTS voiceover generation | ~$0.02/scene | Agent (auto) |
| **Video generation (Kling O3)** | **$0.56-$1.12/clip** | **User (manual)** |
| Composite/stitch | Free | Agent (auto) |

Video generation uses dry-run pattern: agent shows cost estimate → user confirms → agent queues.

---

## Variant Rules

| Change Type | Duration | Action |
|-------------|----------|--------|
| Expression, wet, brief costume | 1 scene | Handle via prompt |
| Injury, bandage, wardrobe change | Multiple scenes/episodes | Create variant |
| Time of day, weather | 1-2 scenes | Handle via prompt |
| Location renovation, destruction | Permanent | Create variant |

Variants are tagged and reusable. Once created, they persist until the character "recovers" or the location changes back.

---

## TTS Configuration

- Model: ElevenLabs turbo-v2.5 via fal.ai
- Default voice: `pNInz6obpgDQGcFmaJgB` (Adam)
- Context: previous + next scene text sent for natural flow
- Speed: 0.7 - 1.2 (default 1.0)
- Single language per generation (translation is a later feature)

---

## Pipeline Flow

```
1. CONVERSATION: User + Agent discuss episode
          ↓
2. SERIES ASSETS: Agent creates characters/locations/props (if new)
          ↓  
3. GRID GENERATION: Agent generates reference images (2x2 or 3x3, 4K, 1:1)
          ↓
4. GRID SPLIT: Auto-split into individual asset images
          ↓
5. SCENE PLAN: Agent creates storyboard referencing asset IDs
          ↓
6. TTS: Agent generates voiceover per scene (auto-approved)
          ↓
7. VIDEO ESTIMATE: Agent shows cost per scene to user
          ↓
8. USER APPROVES: User confirms video generation
          ↓
9. VIDEO GENERATION: Kling O3 ref-to-video per scene
          ↓
10. COMPOSITE: Stitch scenes + audio into episode
          ↓
11. PUBLISH: Post to social accounts
```

Steps 2-4 happen ONCE per series (or when new assets are needed).
Steps 5-11 happen per episode.

---

## API Endpoints (v2)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v2/series/create` | Create series + project + assets |
| POST | `/api/v2/series/{id}/generate-assets` | Generate reference images for assets |
| POST | `/api/v2/storyboard/create` | Create storyboard with scene plan |
| POST | `/api/v2/storyboard/{id}/approve` | Trigger grid gen + asset injection |
| GET | `/api/v2/project/{id}/status` | Full pipeline status per scene |
| POST | `/api/v2/storyboard/{id}/generate-video` | Cost estimate + confirm to queue |
| POST | `/api/v2/storyboard/{id}/generate-tts` | Generate voiceover per scene |
| POST | `/api/v2/storyboard/{id}/composite` | Stitch scenes into episode |

---

## Prompt Architecture

```
Base prompts (in repo, versioned)     →  immutable foundation
     +
Agent memory (per user, runtime)      →  style preferences, learned patterns
     +  
Series metadata style                 →  injected into every prompt
     =
Final prompt sent to API
```

Base prompts evolve as the agent learns what produces better video globally.
Agent memory is per-user and captures individual preferences.
Series style is per-project and ensures visual consistency.

---

## Agent Review Pipeline

Tokens are cheap. Video generation is expensive. The agent reviews at every step to catch problems BEFORE spending money on video.

```
Grid generated → AGENT REVIEWS (vision) → if bad, regenerate → if good, split
     ↓
Split images → AGENT REVIEWS (vision) → verify all cells clean, correct count
     ↓
Scene plan created → AGENT REVIEWS (consistency) → verify refs match assets
     ↓
TTS generated → AGENT REVIEWS (listen) → verify audio quality
     ↓
Video estimate → USER APPROVES (cost gate)
     ↓
Video generated → AGENT + USER REVIEW → if bad, regenerate specific scene
```

**Rules:**
- Agent can regenerate images/grids/TTS without asking (cheap operations)
- Agent MUST show video cost estimate and wait for user approval
- If video generation produces bad output, agent can re-roll individual scenes (user approves the re-roll cost)
- One bad scene does NOT block other scenes — composite can work with partial results

**Grid split validation — two-phase:**
1. **Programmatic check FIRST** — verify cell dimensions (2048×2048 for 2×2 at 4K, ~1365×1365 for 3×3). If wrong, regenerate immediately without spending tokens on vision.
2. **Vision review SECOND** — catches quality issues (wrong character, bad pose, style mismatch).

**Duration optimization:**
- Kling O3 prices per 5s bucket. A 7s scene costs the same as 10s.
- Agent MUST round UP to 5/10/15s increments and use extra seconds for better pacing.

**Voiceover ↔ duration sync:**
- Scene duration MUST be ≥ TTS audio duration. Agent auto-adjusts.
- If voiceover is 12s but scene was set to 8s → scene duration becomes 15s (next 5s bucket).
- If voiceover is too long for one scene → agent splits the voiceover across scenes.

**Partial composite UX:**
- Editor shows red/green status per scene in the storyboard view.
- User chooses: composite without failed scenes (jump cut), re-roll failed scenes, or wait.

---

## Asset Descriptions (for Agent Context)

Every series asset MUST have a rich description so the agent knows when and how to use it:

```typescript
interface SeriesAsset {
  id: string;
  type: "character" | "location" | "prop";
  name: string;
  description: string;        // visual description for image generation
  usage_notes: string;        // when/how to use this asset in scenes
  tags: string[];             // searchable tags (e.g. "main_cast", "night_scene")
  reference_image_url: string | null;
  variants: Array<{
    id: string;
    label: string;            // "Night version", "Injured", "Rain-soaked"
    description: string;      // what changed from default
    usage_notes: string;      // "Use from EP3-Scene5 onwards until EP5"
    image_url: string | null;
  }>;
}
```

The agent uses `description` for generation and `usage_notes` + `tags` for scene planning decisions.

---

## Custom Asset Upload

Users can upload their own images as assets (not only AI-generated):
- Upload custom character photo → becomes a reference image
- Upload location photo → becomes a background reference  
- Upload prop image → becomes a prop reference

This is critical because some assets can't be AI-generated (real person's face, specific real location, branded product).

---

## Error Handling & Retry

| Step | On Failure | Retry Limit | Approver |
|------|-----------|-------------|----------|
| Grid generation | Auto-retry once, then alert user | 2 attempts | Agent |
| Grid split | Agent reviews visually, re-generate if malformed | 2 attempts | Agent |
| TTS generation | Auto-retry | 3 attempts | Agent |
| Video generation | Alert user, offer per-scene re-roll | User decides | User |
| Composite | Partial composite (skip failed scenes), alert user | 1 attempt | Agent |

**Per-scene independence:** Every scene tracks its own status. A failed scene does not block other scenes from generating or compositing.

---

## Future (Not Now)

- Multi-language voiceover + translation
- Multi-platform publishing (socialpost integration)
- Cinematic mode (native Kling audio)
- Per-user agent memory (SaaS multi-tenant)
- Music/SFX layer
- Storyboard versioning / undo
- Asset management UI for manual users
- In-editor chat interface for user onboarding
- Episode continuity tracking (what happened in previous episodes)
