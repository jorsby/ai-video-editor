---
name: video-editor
description: Operate the Octupost AI Video Editor — create videos, write chapters, plan scenes, generate assets/TTS/video, and publish. Use when asked to create chapters, write storyboards, generate videos, manage video assets, or run the AI video production workflow. This skill defines both the production methodology and the API usage pattern. Use it for narrative video production inside Octupost.
---

# Octupost Video Editor

Operate through the Octupost app/API layer.
Do **not** call model providers directly.
Use webhook-updated app state as the source of truth.

---

## Before You Start

1. Read the active API cookbook for the current workspace.
2. Read the active `PROJECT.md`.
3. Pull fresh runtime state from the app/API. Never trust stale IDs.
4. If cookbook, runtime behavior, and actual API responses disagree, stop guessing and escalate to Video Editor Dev.

---

## System Hierarchy

```text
Project -> Video -> Chapters -> Scenes
                 -> Video Assets (characters, locations, props)
```

---

## Non-Negotiables

- For **long-form narrative** videos: write and review the **full video voiceover first** before chaptering.
- After chaptering, work **chapter by chapter** for the scene phase unless the user explicitly asks for batch work.
- Use **scene spec first, prompt last**.
- Use **variant slugs** in scene prompts, not provider-native image slots.
- Use **variant-first** expansion. New asset is last resort.
- Keep **generic environment detail** in prompt text; do not promote everything into its own asset.
- Use **fresh live state** before writing scenes.
- Use **narrative mode by default** for this workflow.
- The goal is **not** the smallest asset count; the goal is the **strongest, most beautiful video**. Think like a **director** with artistic judgment.
- If the current asset set would make the video feel visually thin, repetitive, or under-produced, add the necessary characters, locations, props, and variants.
- Do **not** avoid character creation just to stay minimal. If supporting characters materially shape repeated beats or continuity, define them explicitly instead of leaving them as random generated people.
- Treat the video engine as a **renderer, not a co-director**. Important visual decisions should already be made in canon / scene spec / asset plan.
- Before creating any asset or variant, ask: **is this prompt describing the reusable reference image itself, or am I accidentally describing the story moment where it will be used?** Put scene context in scene specs / scene prompts, not inside the reference identity unless it is visually inseparable.
- Before final prompting, ask: **am I leaving anything important to engine improvisation?** If yes, define it explicitly.

**Golden rule (scene phase):** `scene spec -> asset plan -> final prompt`

---

# Production Workflow

## Step 1 — Project Canon

Read or define the stable project canon:
- audience
- tone
- language
- platform / aspect ratio
- historical / religious guardrails
- recurring characters
- recurring locations
- production mode

Keep canon stable. Do not rewrite it every chapter.

## Step 2 — Full Video Voiceover

Write the **entire video voiceover first** as one continuous narrative before creating chapters.

The full script must already contain:
- hook
- causal flow
- emotional progression
- escalation
- resolution
- final moral echo

Do **not** chapterize a weak draft just to make it feel structured.
If the full video does not read cleanly from beginning to end, stop there and fix it.

## Step 3 — Full Script Review

Review the complete voiceover as a **single story unit**.
Check:
- meaning continuity
- event order
- subject / pronoun clarity
- emotional flow
- repetition
- read-aloud naturalness in Turkish
- whether one line accidentally implies something happens before it was introduced

## Step 4 — Update Full Script If Needed

If the review finds problems, fix the **full video script first**.
Do **not** carry broken logic into chaptering, scene planning, TTS, or generation.

## Step 5 — Extract Characters / Props / Locations

After the full script is approved, extract the production set:
- recurring / important characters
- required locations
- hero props
- continuity-critical objects
- obvious variant needs

This extraction comes from the **approved full video voiceover**, not from isolated scene guesses.

## Step 6 — Create / Expand Assets

Use the app/API only.
Always re-check runtime state after create/edit.

### Usually asset-worthy
- recurring characters
- recurring locations
- recurring hero props
- continuity-critical props
- reusable environment variants
- supporting characters that materially shape recurring beats
- chapter-critical characters that should not appear as random strangers
- additional chapter-critical locations that prevent the world from feeling visually flat
- repetition-breaking variants for long-form coverage
- background/object elements that materially affect continuity or story readability

### Usually **not** separate assets
- generic stone walls
- cloth
- torches
- generic doors
- background crowd detail
- generic market clutter
- one-off environmental fillers

Default bias:
- if unsure, keep it in `set_dressing_only`
- if it repeats and continuity matters, promote it to asset / variant

### Variant-first rule

When the same core asset needs variety:
1. create a new variant
2. create an edit-derived variant
3. change action / camera / composition in the scene
4. open a brand-new asset only if the above is not enough

### Variant generation workflow (mandatory)

Default bias:
- **do not create a new asset first** if you are still depicting the same recurring character, the same prop, or the same core background/location identity
- if the need is only a **change of clothing, angle, lighting, cleanliness, weather, time-of-day, composition, or small added/removed details**, keep the same asset and create a **new variant**
- create a **brand-new asset** only when it is truly a different recurring identity, object, or place

Examples:
- same man, different clothes -> **new variant**, not new character asset
- same character, older / dirtier / battle-worn / different pose -> **new variant**
- same room / cave / market edge, but cleaner / darker / wider / dawn / night -> **new variant**
- same prop with wear, angle, or decoration change -> **new variant**
- actually different person / different object / different place -> **new asset**

#### Main vs non-main image generation

- **Main variant** = first image for a new asset; generate from **text-to-image**
- **Non-main variant** = later variation of that same asset; generate from **image-to-image** using the main variant image as the reference whenever available
- Goal: keep identity continuity stable across all later variants

#### Asset-type generation default

| Asset type | Main variant | Non-main variant |
|------------|--------------|------------------|
| Character  | Z-Image (t2i) | Flux i2i |
| Location   | GPT Image 1.5 (t2i) | GPT Image i2i |
| Prop       | Z-Image (t2i) | Flux i2i |

#### Fallback rule

- If the main variant image is not ready yet, a non-main variant may temporarily fall back to **text-to-image**
- This is allowed as a resilience fallback, but it is **not** the preferred continuity path
- Once the main image exists, regenerate/edit from that main reference when continuity matters

#### Practical rule for production decisions

Before opening a new asset, ask:
1. Is this still the same recurring identity?
2. Is the requested change only styling / outfit / angle / environment treatment / detail change?
3. Can continuity be preserved better by branching from the existing main variant?

If the answer is yes, **make a variant, not a new asset**.

## Step 7 — Split the Approved Video Into Chapters

Only after the full script and initial asset set are sound, split the video into chapters.

For each chapter, define:
- `chapter_title`
- `synopsis`
- `mode`
- `full_audio_outline`
- `full_visual_flow`
- `bible_alignment_notes`

## Step 8 — Chapter Review

Review the chapter breakdown for:
- internal coherence
- transition quality
- load balance
- whether the chapter cut points feel natural
- whether the long-form story still reads as one continuous flow

## Step 9 — Update Chapters If Needed

If the chapter breakdown creates confusion, uneven rhythm, or duplicated information, update the chapter layer before scene work.

## Step 10 — Chapter + Asset Combine Review

Now review the chapter plan together with the existing asset set.
Check:
- missing people / places / props / variants
- repetition risk across an 8–9 minute video
- whether the current assets really cover the chapter beats
- whether the world feels rich enough for production

If the current asset set would make the video feel thin, repetitive, or visually underpowered, expand it **before** scene work.

## Step 11 — Scene Specs

After the chapter plan and asset coverage are clear, create the scene plan before touching prompts.

### Required SceneSpec fields

- `scene_order`
- `mode`
- `audio_text`
- `visual_flow`
- `background_name`
- `location`
- `time_of_day`
- `characters`
- `asset_required_subjects`
- `hero_props`
- `set_dressing_only`
- `continuity_critical_elements`
- `main_action`
- `emotion`
- `continuity_note`
- `prompt_json`

### `prompt_json` minimum shape

- `subjects`
- `actions`
- `camera`
- `lighting`
- `atmosphere`
- `continuity_constraints`
- `negative_constraints`

Do **not** hide missing thinking inside a vague prompt.
If the scene is unclear here, the final prompt will also be weak.
If a background, person, prop, or continuity beat matters, specify it here instead of hoping the engine invents the right thing.

## Step 12 — Scene Prompts

Once the scene spec is clear, write the final scene prompt.

## Step 13 — Scene ↔ Asset Coverage Check

After scene prompts are drafted, compare every scene against the actual asset set.
Check for:
- missing subject coverage
- missing location coverage
- continuity-critical prop gaps
- weak repetition-breaking coverage
- places where a new variant or edit-derived variant is needed

## Step 14 — Expand Missing Coverage

If a scene needs stronger reference support, add the necessary asset / variant / edit-derived variant first, then re-validate the scene against live state.

## Step 15 — Final Scene Pass

Before TTS, ask:
- is the scene understandable without extra explanation?
- does the narration match what the visuals can actually show?
- are we leaving any important visual fact to engine improvisation?
- do the assets and variants actually support this scene cleanly?

If not, fix the scene spec or asset coverage first.

## Step 16 — TTS and Video Generation

Only after the final scene pass should you move into TTS and video generation.

---

# Asset Prompt Standards

Asset prompts should be **structure-first**.
Do not rely on vague wording like `ancient Mecca`, `cinematic leader`, or `tense prop`.
State the key facts directly: **what it is, which year / century it belongs to, how it should be lit, and what must be visible**.

### Sanity check before writing any asset prompt

Ask:
1. Is this describing the **reference image itself**?
2. If I remove the story sentence, does the asset still make sense as a reusable reference?
3. Am I keeping **usage context** out of `[OBJECT]` / `[IDENTITY]` / `[LOCATION]` and inside scene planning instead?
4. Would a human director look at this and say “yes, this is the reference we need”?

If not, rewrite it.

## 1) Location prompts

### First decide which kind of location image this is

#### A. Reusable location / background variant
Use this when the image will be reused across scenes.
- default: **no people / no crowd / no named characters**
- keep it readable, neutral, reusable
- do not bake one-time action into the image
- time-of-day can be included if that specific variant is meant for that use

#### B. One-off location image
Use this only if the image is not meant to be a reusable background asset.
- people **can** appear if the shot truly requires it
- if people are included, say so explicitly
- do not pretend a one-off populated image is a reusable base location

### Location prompt structure

Use blocks like this:
- `[LOCATION]` exact place / environment identity
- `[YEAR]` year or century
- `[LAYOUT]` terrain / spatial arrangement
- `[ARCHITECTURE]` materials / building language
- `[LIGHTING]` light condition
- `[USE]` reusable empty background **or** one-off populated environment
- `[PEOPLE]` none / sparse / specific type
- `[NEGATIVE]` what must not appear

### Example — reusable main location variant

```text
[LOCATION] Mecca valley settlement around the Kaaba precinct.
[YEAR] Late 6th century CE.
[LAYOUT] Rocky basin, open circulation paths, readable central gathering area.
[ARCHITECTURE] Stone and mud construction, early western Arabian settlement language, period-correct market-town geometry.
[LIGHTING] Neutral daylight.
[USE] Reusable environment background for multiple scenes.
[PEOPLE] No people, no crowd, no named characters.
[NEGATIVE] No animals in frame, no modern elements, no exaggerated fantasy scale.
```

### Example — one-off location image

```text
[LOCATION] Mecca valley market edge near the Kaaba approach.
[YEAR] Late 6th century CE.
[LAYOUT] Narrow but readable walking lane opening into a wider communal space.
[ARCHITECTURE] Stone, mudbrick, cloth shade structures, period-correct Arabian trade settlement details.
[LIGHTING] Warm late afternoon light.
[USE] One-off scene image, not reusable base background.
[PEOPLE] Sparse merchants and passersby visible in the distance.
[NEGATIVE] No modern objects, no dense unreadable crowd, no fantasy ornament.
```

## 2) Character prompts

Character prompts should behave like a **reference sheet**, not a cinematic scene frame.

### Character structure

Use blocks like this:
- `[IDENTITY]` who this person is
- `[YEAR]` year or century
- `[AGE]` visible age range
- `[PHYSIQUE]` build / posture
- `[FACE]` facial traits / beard / hair
- `[CLOTHING]` period-correct clothing
- `[POSE]` neutral readable pose
- `[LIGHTING]` clean readable light
- `[BACKGROUND]` simple background
- `[NEGATIVE]` what must not appear

### Character rules
- isolated single subject
- fully visible
- centered
- no crop / no occlusion
- age should be visually legible
- clothing and physical features should be explicit
- no environment unless truly necessary
- no crowd unless the asset specifically requires it

### Example — main character variant

```text
[IDENTITY] Quraysh leader reference image.
[YEAR] Late 6th century CE.
[AGE] Man in his early forties.
[PHYSIQUE] Medium-tall build, upright posture, calm authority.
[FACE] Clear face, strong nose, dark eyes, trimmed beard.
[CLOTHING] Layered Arabian robes, wrapped headcloth, leather belt, period-correct textiles.
[POSE] Full body, centered, neutral standing pose.
[LIGHTING] Even soft light with clear facial readability.
[BACKGROUND] Plain clean background.
[NEGATIVE] No crowd, no environment, no modern materials, no dramatic action pose.
```

## 3) Prop prompts

Props should read like a **clean reference / product shot**.

### Prop structure

Use blocks like this:
- `[OBJECT]` what the prop is
- `[YEAR]` year or century
- `[MATERIAL]` what it is made from
- `[FORM]` shape / build details
- `[ANGLE]` readable viewing angle
- `[LIGHTING]` clean light
- `[BACKGROUND]` simple background
- `[NEGATIVE]` what must not appear

### Prop rules
- single object
- fully visible
- centered
- readable angle
- material detail explicit
- plain background by default
- no hand unless handling context is essential
- describe the **object identity**, not the full story beat
- avoid embedding scene-only context into `[OBJECT]`
- if a line sounds like “used in scene X / hidden in Y / found during Z”, move that to scene planning / scene prompt, not the main prop description

### Example — main prop variant

```text
[OBJECT] Arabian water skin reference image.
[YEAR] Late 6th century CE.
[MATERIAL] Aged leather body, rope binding, stitched seams.
[FORM] Rounded travel water skin with practical desert-use wear.
[ANGLE] Front three-quarter view, fully visible.
[LIGHTING] Soft even studio-style light for texture clarity.
[BACKGROUND] Plain clean background.
[NEGATIVE] No hand, no extra objects, no modern fasteners, no decorative fantasy styling.
```

### Example — do / don't for prop wording

**Don't**
```text
[OBJECT] Thick cash envelope hidden inside a wedding dress pocket.
```

**Do**
```text
[OBJECT] Thick cash envelope reference image.
```

Then carry the story usage elsewhere:
- scene spec: chapter 1 moral trigger prop, hidden inside the wedding dress pocket
- scene prompt: who finds it, where it is hidden, and how it is revealed

## 4) Edit-derived variant prompts

Edit prompts are **change instructions**, not full rewrites.
Say what stays locked, what changes, and what must still be avoided.

### Edit variant structure

Use blocks like this:
- `[SOURCE]` what image this edit is based on
- `[KEEP]` what must stay the same
- `[CHANGE]` what should change
- `[REMOVE]` what should be cleaned out
- `[NEGATIVE]` what must still not appear

### Example — edit variant

```text
[SOURCE] Existing Mecca valley main variant.
[KEEP] Keep the same settlement identity, terrain layout, architecture language, and overall readability.
[CHANGE] Make the environment cleaner, more neutral, and easier to reuse across scenes.
[REMOVE] Remove any crowd feeling or embedded human presence.
[NEGATIVE] No people, no animals, no modern elements, no fantasy additions.
```

---

# Scene Prompt Rules

## Use variant slugs directly

Use `@variant-slug` in the final scene prompt.
Do **not** write `@image1`, `@image2`, etc.
The compiler resolves that automatically.

### Core rules
- use the exact DB slug
- location first when present
- then characters
- then continuity-critical props
- max **7** references per scene
- every important referenced character must have an explicit action

### Bad

`@hz-ali-main and @ebu-cehil-main argue in a tense night scene.`

### Better

`@hz-ali-main stands firm at the doorway while @ebu-cehil-main steps closer and points toward the entrance.`

## Preferred compiled prompt shape

Use short labeled blocks instead of fuzzy prose.

### Example scene prompt

```text
[BACKGROUND] @mekke-vadisi-main open Mecca valley courtyard, readable empty base environment.
[SUBJECT] @kureys-lideri-main stands near the Kaaba area, watching the arriving caravan line.
[ACTION] Traders and pack movement stay secondary in the background while the leader remains the visual anchor.
[LIGHTING] Warm late afternoon light.
[CAMERA] Slow elevated push-in, mobile-friendly centered composition, clean depth separation.
[ATMOSPHERE] Order, authority, growing importance.
[NEGATIVE] No modern objects, no comedic motion, no overcrowded unreadable frame.
```

Important:
- the **asset slug is the reference anchor**
- the rest of the sentence explains the **scene use**
- do not turn the asset line into a random permanent identity rewrite

---

# Timing Rules

## Narrative mode

Narrative is **audio-first**.

1. Write `audio_text` first.
2. Generate or estimate audio duration.
3. Set scene `video_duration` to `ceil(audio_duration)`.
4. Clamp to **6–30 seconds**.
5. If the narration runs longer than 30 seconds, split the scene.

That is the duration rule.
Do not keep old 6s/10s logic in this workflow.

---

# Final Prompt Compilation

Final prompt is compiled **after** SceneSpec and AssetPlan are ready.

### Final prompt should carry
- clear subject attribution
- clear main action
- camera intent
- lighting
- atmosphere
- continuity-critical elements
- negative constraints
- only the assets that truly matter

### Do not do these
- do not write the final prompt before the scene is clear
- do not use vague mood-only prompts
- do not stuff every visual detail into assets
- do not describe one-off set dressing as if it needs its own reference image

---

# Scene Write / Generation Order

1. pull fresh chapter + asset state
2. validate every referenced slug
3. write / update scenes through app/API
4. generate TTS
5. generate video
6. wait for webhook/app state
7. review and feed back improvements

---

# Review Checklist

Before saving a scene, ask:

1. Is the scene understandable without extra explanation?
2. Does each major subject have a specific action?
3. Is the location readable and not overloaded?
4. Are only truly necessary assets referenced?
5. Is this visually distinct from the previous shot?
6. Is the prompt concrete enough that two runs would likely land in the same visual family?

If not, rewrite the scene spec first.

---

# Hard Rules

| Rule | Detail |
|------|--------|
| Provider access | Use Octupost app/API only |
| Source of truth | Webhook/app state |
| Duration rule | Narrative scenes use `ceil(audio_duration)` clamped to 6–30 |
| Prompt source | SceneSpec first, prompt last |
| Asset refs | Use exact `@variant-slug` |
| Reference cap | Max 7 per scene |
| Asset strategy | Variant-first |
| Live validation | Never write scenes against stale asset state |
| Project canon | Follow active `PROJECT.md` |

## TTS text safety

- Preserve native Unicode characters.
- Do not strip Turkish characters.
- Use safe JSON serialization when building payloads.

---

## API Reference

Use the active API cookbook for routes, payloads, and examples.

## App State

Use fresh runtime/app state through the app/API flow.
Never treat old notes or old IDs as authoritative when the current app/API can answer it.
