# Octupost Video Editor — Workflow

Complete funnel for creating AI video series. Follow this order. Don't skip steps.

---

## Table of Contents

- [1. Onboarding](#1-onboarding)
- [2. Bible & Episodes](#2-bible--episodes)
- [3. Assets](#3-assets)
- [4. Scene Prompts](#4-scene-prompts)
- [5. Approve & Generate](#5-approve--generate)
- [6. Review & Publish](#6-review--publish)
- [Checkpoints & One-Way Gates](#checkpoints--one-way-gates)
- [General Rules](#general-rules)
- [Prompt Rules](#prompt-rules)
- [Stale Data Policy](#stale-data-policy)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)

---

## 1. Onboarding

**Goal:** Understand what the user wants, collect metadata, create series + project in Supabase.

### What to ask

```
1. What's the series about? (topic, story)
2. How many episodes?
3. Scene mode: Narrative (TTS voiceover) or Cinematic (music only)?
4. Platform: TikTok/Reels/Shorts (9:16) or YouTube (16:9)?
5. Language?
6. Tone/style? (documentary, dramatic, educational, etc.)
7. Any special rules? (e.g. "never show faces", "historical accuracy only")
```

### What to do

1. Confirm metadata with user
2. Create series via API: `POST /api/series`
3. Save metadata to `series.metadata`:
   ```json
   {
     "scene_mode": "narrative",
     "episode_count": 12,
     "aspect_ratio": "9:16",
     "language": "tr",
     "video_model": "klingo3",
     "image_model": "fal-ai/nano-banana-2",
     "onboarding_complete": true,
     "style": {
       "visual_style": "...",
       "setting": "...",
       "time_period": "...",
       "color_palette": "...",
       "mood": "...",
       "custom_notes": "..."
     }
   }
   ```
4. Create project via API: `POST /api/projects`
5. Save `series_id` and `project_id` to `docs/projects/<project-name>/PROJECT.md`

### Done when
- `series.metadata.onboarding_complete = true` in Supabase
- `PROJECT.md` exists with both IDs

---

## 2. Bible & Episodes

**Goal:** Write series bible (tone, world, characters), outline all episodes, get user approval.

### Steps

1. **Write series bible** — tone, visual style, world rules, character descriptions
   - Save to `series.metadata.bible` (or `series.bible` column if exists)
   - Present to user → get approval

2. **Outline episodes** — title + 1-2 sentence synopsis per episode
   - Save each to `series_episodes` table: `title`, `synopsis`, `episode_number`
   - Present to user → get approval

3. **Create storyboards** — one per episode
   - `POST /api/storyboard` for each episode
   - Link to episode via `series_episodes.storyboard_id`

### Done when
- User approved bible and episode outlines
- All episodes exist in `series_episodes` table with synopsis
- All storyboards created and linked

### ⚠️ Checkpoint
Bible and episodes can be freely edited at this stage — no cost incurred yet.

---

## 3. Assets

**Goal:** Create character and location images for the series.

### Steps

1. **List all characters and locations** across all episodes
   - Characters: transparent PNG, consistent across episodes
   - Locations: full background, 9:16 format
   - Present list to user → approval

2. **Generate asset images** via `POST /api/series/{id}/generate-images`
   - Use nano-banana-2 for image generation
   - Each asset gets a `series_asset` record + `series_asset_variant` + `series_asset_variant_images`

3. **User reviews assets** in the editor UI
   - Feedback → regenerate individual assets
   - Continue until all assets approved

### Image Prompt Rules
- Characters: describe appearance, clothing, age, pose. Add "transparent background, full body, character sheet style"
- Locations: describe setting, time of day, atmosphere, architecture. No characters in background.
- Always add period-specific details (e.g., "7th century Arabian", "mud-brick buildings")

### Done when
- All characters and locations have `status: 'success'` images
- User approved visual consistency

---

## 4. Scene Prompts

**Goal:** Write video prompts and voiceover scripts for each scene, episode by episode.

### Steps

1. **Read the episode's VO script** from `storyboard.plan.voiceover_list`
2. **For each scene:**
   - Count words → calculate VO duration (words / 2.2 for Turkish)
   - Calculate shot count: `ceil(VO_duration / 6)`
   - Write shots (each shot = one video clip, 5-7 seconds)
3. **Save to storyboard plan:**
   ```json
   {
     "scene_prompts": [["shot1", "shot2"], ["shot1", "shot2", "shot3"], ...],
     "scene_durations": [9, 15, 9, ...],
     "scene_object_indices": [[], [0], [], ...],
     "scene_bg_indices": [0, 0, 1, ...],
     "objects": [{"name": "Character A"}, ...],
     "background_names": ["Location A", "Location B", ...],
     "voiceover_list": {"tr": ["VO text scene 1", "VO text scene 2", ...]}
   }
   ```
4. **Present to user → get feedback → iterate**
5. **Move to next episode only after current one is approved**

### ⚠️ Work episode by episode
Do NOT write all episodes at once. Quality drops. Write EP1 → feedback → approve → EP2 → ...

### Done when
- User approved all scene prompts for the episode
- `plan.scene_prompts` saved to storyboard

---

## 5. Approve & Generate

**Goal:** Create scene records, generate videos and voiceovers.

### 5a. Approve Storyboard

1. Set `plan_status = 'approved'`
2. Create scene records from `plan.scene_prompts`
3. Create voiceover records from `plan.voiceover_list`
4. Create background/object records for each scene (link to series assets)

### 5b. Generate Videos

**Read [docs/VIDEO_GENERATION_WORKFLOW.md](VIDEO_GENERATION_WORKFLOW.md) for the full step-by-step.**

Summary:
1. **Dry run:** `POST /api/v2/storyboard/{id}/generate-video` with `confirm: false`
2. **Review cost** — verify `total_estimated_cost_usd` is reasonable
3. **Confirm:** Same endpoint with `confirm: true`
4. **Wait for webhook** — fal.ai processes and calls back
5. **Verify** — check `video_status = 'success'` in DB

### 5c. Generate TTS

1. `POST /api/workflow/tts` for each scene's voiceover
2. Wait for webhook callback
3. Verify `voiceover.status = 'success'` and `audio_url` is set

### ⚠️ Checkpoint — MONEY GATE
Once videos are generated, going back costs real money. Always:
- Dry run first
- Review cost with user
- Get explicit confirmation before `confirm: true`

---

## 6. Review & Publish

**Goal:** Final review of generated videos, fix issues, export.

### Steps

1. **Review each scene's video** in the editor
2. **Feedback loop:**
   - User: "Scene 3 is too dark"
   - Update prompt → regenerate (costs money again)
   - Log feedback in project's `FEEDBACK_LOG` section
3. **Final export** when all scenes approved
4. **Publish** to platforms

---

## Checkpoints & One-Way Gates

```
Onboarding → Bible → Episodes → Assets → Prompts → Approve → Generate
    ✏️         ✏️        ✏️         ✏️        ✏️        🔒        💰🔒
```

| Symbol | Meaning |
|--------|---------|
| ✏️ | Freely editable, no cost |
| 🔒 | Approve creates DB records. Changing = delete + redo |
| 💰🔒 | Video generated. Changing = new generation = new cost |

**Rules:**
- Bible/episode changes only affect **episodes not yet generated**
- Each episode is independent — changing EP10 doesn't affect EP1-9
- Reverting an approved storyboard: delete scenes → set `plan_status = 'draft'` → edit → re-approve

---

## General Rules

These apply to EVERY project, always.

| Rule | Detail |
|------|--------|
| **Max 15s per scene** | If VO exceeds 15s, split into two scenes |
| **Dry run mandatory** | Always `confirm: false` before `confirm: true` |
| **No meta in prompts** | No `9:16`, `@Element`, `@Image`, `cinematic`, `vertical` in prompt text |
| **Episode by episode** | Don't write all prompts at once. Quality drops |
| **Prove everything** | Build passes? Show output. Video generated? Show the URL |
| **Live query always** | Never cache Supabase IDs. Always query fresh |
| **Endpoint over manual** | Never bypass API endpoints to call fal.ai directly |
| **Cost awareness** | Always show cost estimate before generating |

---

## Prompt Rules

### Video Prompts (scene_prompts)

**Good prompt:**
```
Hz. Bilal kızgın çöl kumuna sırtüstü yatırılmış. Göğsünde devasa bir kaya.
Öğle güneşi acımasız. Alnında ter damlaları.
```

**Bad prompt:**
```
@Element1 kızgın çöl kumuna sırtüstü yatırılmış. @Image1 çöl kenarı arka plan. 9:16 dikey. cinematic.
```

**Why:** `@Element`/`@Image` are resolved by the endpoint from DB records. `9:16` is the `aspect_ratio` API parameter. Prompts describe **what you see**, nothing else.

### Rules
- Language: whatever the series language is (e.g., Turkish for Hicret)
- Describe the scene — what's happening, what's the emotion
- No technical camera instructions (unless specifically needed)
- No aspect ratio, resolution, or format tags
- Each shot should tell a mini-story

### Shot Duration
- Turkish narration: ~2.2 words/second
- VO duration = word_count / 2.2
- Shot count = ceil(VO_duration / 6)
- Each shot: 5-7 seconds (Kling max ~10s)
- Scene total: max 15 seconds

### Validation Checklist (per episode)
- [ ] No scene exceeds 15 seconds
- [ ] Shot count matches ceil(VO_duration / 6)
- [ ] `scene_object_indices` correctly maps characters to scenes
- [ ] `scene_bg_indices` correctly maps backgrounds to scenes
- [ ] `scene_durations` array matches scene count
- [ ] Transition from previous episode's last scene is smooth
- [ ] No banned content in prompts (project-specific rules)

---

## Stale Data Policy

**Never cache IDs.** Always query Supabase fresh.

### What to store in PROJECT.md
- `series_id` — never changes
- `project_id` — never changes

### What to query live
- Storyboard IDs: `SELECT * FROM storyboards WHERE project_id = X`
- Scene IDs: `SELECT * FROM scenes WHERE storyboard_id = X`
- Asset IDs: `SELECT * FROM series_assets WHERE series_id = X`
- Episode data: `SELECT * FROM series_episodes WHERE series_id = X`

### If a query returns empty/unexpected
1. Don't assume — ask the user: "Expected X storyboards, found Y. Has something changed?"
2. If IDs in PROJECT.md are stale, ask user for updated IDs
3. Never silently use stale data

---

## API Reference

### Series
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/series` | POST | Create series |
| `/api/series/{id}` | PATCH | Update series metadata |
| `/api/series/{id}/generate-images` | POST | Generate asset images |

### Storyboard
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/storyboard` | POST | Create storyboard |
| `/api/storyboard/approve` | POST | Approve → create scenes + voiceovers |
| `/api/v2/storyboard/{id}/generate-video` | POST | Generate videos (dry run or confirm) |

### Auth
All endpoints require `Authorization: Bearer <OCTUPOST_API_KEY>` or Supabase session.

### Supabase Direct (for queries)
- URL: value from `.env` `SUPABASE_URL`
- Headers: `apikey` + `Authorization: Bearer <service_role_key>` + `Accept-Profile: studio`
- Schema: `studio`

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| 0 jobs from generate-video | Scenes missing `backgrounds` records | Create background records linking to series assets |
| Webhook never arrives | WEBHOOK_BASE_URL is localhost | Set to tunnel or production URL |
| 401 on API calls | Wrong auth header | Use `Authorization: Bearer <OCTUPOST_API_KEY>` |
| Prompt has @Element tags | Tags weren't cleaned | Endpoint should handle this, but clean prompts before saving |
| Video too short | Only first shot sent | Verify `multi_prompt` array is populated |
| Scene > 15s | VO too long for single scene | Split scene into two |
| Approve returns 401 | Endpoint uses session auth | Use service key for direct DB updates, or call from browser |
