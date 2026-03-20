# Prompt-Driven Generation — Project Plan

**Date:** 2026-03-20
**Status:** ✅ FINAL — Ready for implementation
**Branch:** `feat/prompt-driven-generation` (from `feat/v2-agent-pipeline`)

---

## Core Vision

You talk to me, I build the video. The editor is a dashboard where you review, tweak, approve, and regenerate. I am the brain and the worker. You are the reviewer and approver.

**Consistency** is the #1 priority — same characters, same locations, same visual style across every scene. I track what was used where, learn from every regeneration, and get better over time.

---

## The Funnel

```
1. Conversation         You and I discuss the series concept
        │
2. Series Setup         I confirm mandatory fields, create series
        │
3. Bible                I write the series bible (tone, style, world)
        │
4. Episodes (outline)   I outline all episodes (title, synopsis, beats)
        │
5. Characters/Objects/  I define all assets with descriptions
   Locations            and generation prompts
        │
6. Episode Prompts      I write per-scene: video prompts, voiceover
                        scripts, asset references (by variant ID)
        │
7. Review Pass          I do a logic/consistency review across
                        all scenes before you see them
        │
8. Asset Generation     Images generated (characters, objects, locations)
                        You review in editor, give feedback
        │
9. Video Generation     You click Generate in editor (for now)
        │
10. Feedback Loop       You give feedback → I update prompts →
                        you regenerate → I learn for next time
```

---

## Architecture

```
You (Discord) ──talk──▶ Me (Agent)
                           │
              write prompts + meta via API
                           │
                           ▼
                      API Routes ──▶ Supabase DB
                        ▲     │          │
              edit/review│     │          ▼
                        │     │    generation_logs
                        │     │    (version history)
                        │     ▼
                      Editor UI (dashboard)
                           │
                     click Generate
                           │
                           ▼
                      API Routes ──▶ fal.ai / ElevenLabs / Kling
```

**All writes go through API routes** (industry standard, reusable).

---

## Phase 0: Series Metadata Schema + UI Cleanup

### 0a. Series-level mandatory fields

These are confirmed in our conversation ONCE when starting a series. Every storyboard/episode inherits them.

| Field | Type | Example | Stored in |
|-------|------|---------|-----------|
| `scene_mode` | `text NOT NULL` | `narrative` / `cinematic` | `series.metadata` |
| `episode_count` | `int` | `10` | `series.metadata` |
| `aspect_ratio` | `text NOT NULL` | `9:16` / `16:9` | `series.metadata` |
| `language` | `text NOT NULL` | `tr` | `series.metadata` |
| `voice_id` | `text` | `75SIZa3vvET95PHhf1yD` | `series.metadata` |
| `video_model` | `text NOT NULL` | `klingo3` | `series.metadata` |
| `image_model` | `text NOT NULL` | `fal-ai/nano-banana-2` | `series.metadata` |

**Already exists in `series.metadata.style`:** `visual_style`, `setting`, `time_period`, `color_palette`, `lighting`, `mood`, `camera_style`, `custom_notes`.

**Migration:** Update `series.metadata` jsonb to include production fields alongside existing style fields.

### 0b. UI Cleanup — Storyboard Create Form

**Remove:**
- ❌ Voiceover text input (I write this via API)
- ❌ Scene Mode selector (inherited from series)
- ❌ Aspect Ratio selector (inherited from series)
- ❌ Model selection state (`formVideoModel`, always `klingo3`)
- ❌ `formVoiceover`, `formAspectRatio`, `formModel`, `formVideoModel` state vars

**Keep:**
- ✅ Storyboard list/selector (switching between storyboards)
- ✅ Draft banner
- ✅ "New" button → simplified (just creates empty storyboard shell)

**Repurpose:**
- Scene cards: voiceover text becomes read-only display + click-to-edit (for review)
- Create form → becomes a minimal "New Storyboard" action, not a prompt entry form

### 0c. What I confirm before creating a series

When you say "let's create a new series", I ask:

```
Before I start, confirming:
1. Scene mode: Narrative (TTS + voiceover) or Cinematic (music only)?
2. How many episodes?
3. Aspect ratio: 9:16 (vertical/shorts) or 16:9 (horizontal)?
4. Language? (for voiceover + prompts)
5. Any special rules? (e.g. "never show faces", "historical accuracy")
```

Once confirmed → I create the series with all metadata set.

---

## Phase 1: DB Schema Migration

### 1a. Add columns to existing tables

#### Objects
| Column | Type | Purpose |
|--------|------|---------|
| `generation_prompt` | `text` | Exact prompt for image generation |
| `generation_meta` | `jsonb DEFAULT '{}'` | Generation settings + context |
| `feedback` | `text` | Current unaddressed feedback (null = none) |

#### Backgrounds
| Column | Type | Purpose |
|--------|------|---------|
| `generation_prompt` | `text` | Exact prompt for image generation |
| `generation_meta` | `jsonb DEFAULT '{}'` | Generation settings + context |
| `feedback` | `text` | Current unaddressed feedback (null = none) |

#### Scenes (keep existing `prompt` + `multi_prompt`)
| Column | Type | Purpose |
|--------|------|---------|
| `generation_meta` | `jsonb DEFAULT '{}'` | Video generation settings + context |
| `feedback` | `text` | Current unaddressed feedback (null = none) |

#### Voiceovers (keep existing `text`)
| Column | Type | Purpose |
|--------|------|---------|
| `generation_meta` | `jsonb DEFAULT '{}'` | TTS settings + context |
| `feedback` | `text` | Current unaddressed feedback (null = none) |

### 1b. New table: `generation_logs`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | |
| `entity_type` | `text NOT NULL` | `object` / `background` / `scene` / `voiceover` |
| `entity_id` | `uuid NOT NULL` | FK to the entity |
| `storyboard_id` | `uuid` | FK to storyboard |
| `version` | `int NOT NULL DEFAULT 1` | Auto-increment per entity |
| `prompt` | `text` | The prompt used |
| `generation_meta` | `jsonb` | Settings snapshot |
| `feedback` | `text` | Feedback that triggered this regen (null for v1) |
| `result_url` | `text` | Generated output URL |
| `status` | `text NOT NULL DEFAULT 'pending'` | `pending` / `success` / `failed` / `skipped` |
| `created_at` | `timestamptz DEFAULT now()` | |

**Index:** `(entity_type, entity_id, version DESC)`

**Pattern:** Append-only. Always INSERT, never UPDATE. Entity columns are a denormalized cache of the latest log row. On every generation:
1. INSERT new `generation_logs` row (version N+1)
2. UPDATE entity's `generation_prompt` + `generation_meta` to match
3. Full history always available via `generation_logs`

---

### `generation_meta` schemas

#### Objects
```json
{
  "model": "fal-ai/nano-banana-2",
  "output_format": "png",
  "aspect_ratio": "1:1",
  "use_case": "Night guard patrolling Meccan alley, silhouette",
  "episode_id": "6697659f-...",
  "episode_title": "Suikast Planı",
  "scene_order": 3,
  "generated_at": "2026-03-20T05:00:00Z",
  "generated_by": "agent"
}
```

#### Backgrounds
```json
{
  "model": "fal-ai/nano-banana-2",
  "output_format": "png",
  "aspect_ratio": "16:9",
  "use_case": "Narrow Meccan alley for chase/patrol scenes",
  "episode_id": "6697659f-...",
  "episode_title": "Suikast Planı",
  "scene_order": 1,
  "generated_at": "2026-03-20T05:00:00Z",
  "generated_by": "agent"
}
```

#### Scenes
```json
{
  "model": "fal-ai/kling-video/o3/standard/reference-to-video",
  "resolution": "720p",
  "duration_seconds": 5,
  "shot_type": "single",
  "use_case": "Night guard patrol establishing shot",
  "episode_id": "6697659f-...",
  "episode_title": "Suikast Planı",
  "generated_at": "2026-03-20T05:00:00Z",
  "generated_by": "agent"
}
```

#### Voiceovers
```json
{
  "model": "turbo-v2.5",
  "voice_id": "75SIZa3vvET95PHhf1yD",
  "speed": 1.0,
  "language": "tr",
  "use_case": "Narrator describing guard's movements",
  "episode_id": "6697659f-...",
  "episode_title": "Suikast Planı",
  "scene_order": 1,
  "generated_at": "2026-03-20T05:00:00Z",
  "generated_by": "agent"
}
```

---

## Feedback Loop

```
1. You: "scene 3 is too bright"
2. Me: write feedback to scenes.feedback
3. Me: read current prompt + generation_logs history
4. Me: log current state → generation_logs (version N)
5. Me: write updated prompt to scenes.prompt
6. Me: clear scenes.feedback (addressed)
7. You: see updated prompt in editor (Realtime)
8. You: click Regenerate
9. API: generates → logs result (version N+1)
```

I learn: version N prompt="bright marketplace" → feedback="too bright" → version N+1 prompt="low-key dramatic marketplace" → success. Pattern saved to skill file.

---

## Phase 2: API Routes

### Update existing routes

| Route | Change |
|-------|--------|
| `POST /api/v2/storyboard/[id]/approve` | Read `generation_prompt`. Null → `skipped[]`. Log to `generation_logs`. |
| `POST /api/v2/storyboard/[id]/generate-video` | Read `scenes.prompt`. Null → skip. Log to `generation_logs`. |
| `POST /api/workflow/video` | Require prompt. Log to `generation_logs`. |
| `POST /api/workflow/tts` | Add logging to `generation_logs`. |

### New endpoints

| Route | Purpose |
|-------|---------|
| `PUT /api/v2/storyboard/[id]/prompts` | Bulk save scene prompts + voiceover text + meta |
| `PUT /api/v2/series/[id]/asset-prompts` | Bulk save asset generation prompts |
| `POST /api/v2/feedback` | Save feedback to entity + return updated state |
| `GET /api/v2/generation-logs/[entityType]/[entityId]` | Get generation history |
| `PATCH /api/series/[id]` | Update series metadata (production fields) |

### Response shape (all generate routes)
```json
{
  "queued": 5,
  "skipped": [
    { "id": "...", "name": "Night Guard", "reason": "no_prompt" }
  ]
}
```

---

## Phase 3: Frontend — Prompt-Aware UI

- Green/orange dot per scene/asset for prompt status
- `generation_prompt` visible on objects/backgrounds (click to edit)
- `feedback` shown as yellow banner when present
- Generate buttons disabled if prompt is null → tooltip: "Save a prompt first"
- Realtime picks up new columns automatically (existing subscriptions)
- Generation history panel (low priority, optional)

---

## Phase 4: Agent Workflow

### Episode generation
| Step | What I do |
|------|-----------|
| 1 | Query series assets by `series_id` |
| 2 | Read episode outline |
| 3 | Build scene plan with direct asset refs (variant IDs, not names) |
| 4 | Write all prompts (video, voiceover, assets) |
| 5 | Save via API endpoints |
| 6 | Auto-review: consistency check |
| 7 | Notify: "Episode X ready — 7 scenes, 2 new assets" |

### Feedback handling
| Step | What I do |
|------|-----------|
| 1 | Read your feedback |
| 2 | Query current prompt + `generation_logs` |
| 3 | Update prompt incorporating feedback |
| 4 | Save via API (log old → write new → clear feedback) |
| 5 | "Updated scene 3 — click Regenerate" |

---

## Phase 5: Skill File + Series Rules

### Global (`~/.openclaw/skills/video-editor/SKILL.md`)
- API endpoint reference (how to call each route)
- Image/video/voiceover prompt patterns
- Learned preferences from generation history
- Common failures and fixes

### Per-series (e.g. `memory/series-hicret.md`)
- Characters, relationships, visual style
- Story rules (no face depiction, historical accuracy)
- Location canon, episode arcs

---

## Execution Order

| Phase | What | Effort | Depends on |
|-------|------|--------|-----------|
| **0** | Series metadata schema + UI cleanup | 2 hours | Nothing |
| **1** | DB migration (columns + generation_logs) | 45 min | Nothing |
| **2** | API route updates + new endpoints | 3-4 hours | Phase 0 + 1 |
| **3** | Frontend prompt-aware UI | 2-3 hours | Phase 0 + 1 |
| **4** | Agent workflow (me writing prompts) | 1-2 hours | Phase 2 |
| **5** | Skill file + series rules | 1 hour | Anytime |

**Phase 0 and 1 can run in parallel.**
**Phase 2 and 3 can run in parallel after 0+1.**

**Total estimate: ~10-12 hours of work.**

---

## Out of Scope
- Multi-user / SaaS
- Auto-generate on prompt save (always manual click)
- Me clicking Generate for videos (for now — you do it)
- Generation history UI (can add later)
- Prompt A/B testing
