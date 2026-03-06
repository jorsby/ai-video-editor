# Storyboard System — Ref-to-Video Pipeline (Kling O3 + WAN 2.6 Flash)

> Authoritative reference for the ref-to-video storyboard pipeline. Covers both Kling O3 and WAN 2.6 Flash video models. All prompts and schemas are copied verbatim from the source `.ts` files.

---

## Table of Contents

1. [Pipeline Overview](#1-pipeline-overview)
2. [Model Differences Summary](#2-model-differences-summary)
3. [LLM Plan Generation (Two-Pass)](#3-llm-plan-generation-two-pass)
4. [Zod Schemas](#4-zod-schemas)
5. [System Prompts (Verbatim)](#5-system-prompts-verbatim)
6. [Reviewer Prompts (Verbatim)](#6-reviewer-prompts-verbatim)
7. [Grid Prompt Prefixes (Verbatim)](#7-grid-prompt-prefixes-verbatim)
8. [Next.js API Routes](#8-nextjs-api-routes)
9. [Edge Functions](#9-edge-functions)
10. [Webhook Routing](#10-webhook-routing)
11. [Video Generation](#11-video-generation)
12. [TTS & SFX Generation](#12-tts--sfx-generation)
13. [Timeline Assembly](#13-timeline-assembly)
14. [Realtime Subscriptions](#14-realtime-subscriptions)
15. [State Machine](#15-state-machine)
16. [Database Tables](#16-database-tables)

---

## 1. Pipeline Overview

```
User writes voiceover script + selects video model (klingo3 | klingo3pro | wan26flash)
        │
        ▼
POST /api/storyboard  (mode = "ref_to_video")
  ├─ CALL 1: Content LLM → generateObject() with model-specific contentSchema
  │   ├─ Kling: klingO3ContentSchema
  │   └─ WAN: wan26FlashContentSchema
  ├─ Validates grid counts, index bounds, @Element references
  ├─ CALL 1.5: Reviewer LLM → fixes scene_prompts, indices
  │   ├─ Kling: klingO3ReviewerOutputSchema
  │   └─ WAN: wan26FlashReviewerOutputSchema
  ├─ Prefixes grid prompts with REF_OBJECTS_GRID_PREFIX / REF_BACKGROUNDS_GRID_PREFIX
  ├─ Wraps voiceover_list: string[] → Record<string, string[]>
  └─ Inserts storyboard record (plan_status = "draft", mode = "ref_to_video")
        │
        ▼
POST /api/storyboard/approve  (plan_status: draft → generating)
  └─ Calls edge function: start-ref-workflow
        │
        ▼
start-ref-workflow edge function
  ├─ Creates TWO grid_images records:
  │   ├─ type = "objects" (status = "generating")
  │   └─ type = "backgrounds" (status = "generating")
  └─ Sends TWO parallel fal.ai requests to "workflows/octupost/generategridimage"
        │
        ▼
Webhook (step = "GenGridImage") — fires TWICE (once per grid)
  ├─ Updates grid_images record with URL
  └─ When BOTH grids complete → sets plan_status = "grid_ready"
        │
        ▼
User reviews both grids → APPROVE
        │
        ▼
POST /api/storyboard/approve-ref-grid
  ├─ User can change objectsRows/Cols and bgRows/Cols (2–6)
  ├─ Adjusts plan arrays if dimensions changed
  ├─ Calls edge function: approve-ref-split
  │     ├─ Sets plan_status = "splitting"
  │     ├─ Creates scene records (with prompt/multi_prompt/multi_shots)
  │     ├─ Creates object records (per-scene, with grid_position)
  │     ├─ Creates background records (per-scene)
  │     ├─ Creates voiceover records
  │     └─ Sends TWO parallel split requests (objects grid + backgrounds grid)
  └─ Returns success
        │
        ▼
Webhook (step = "SplitGridImage") — fires TWICE
  ├─ Routes to handleObjectsSplit() or handleBackgroundsSplit() by grid type
  ├─ handleObjectsSplit(): updates scene_objects with cropped image URLs
  ├─ handleBackgroundsSplit(): updates scene_backgrounds with URLs, triggers outpaint
  └─ tryCompleteSplitting() → atomic gate
        │
        ▼
Webhook (step = "OutpaintImage") — for backgrounds with non-square aspect ratio
  └─ tryCompleteSplitting() → atomic gate
        │
        ▼
When all backgrounds ready:
  ├─ Sets plan_status = "scenes_ready"
  ├─ Triggers generate-video for each scene (with ref images)
  └─ Triggers generate-tts for each voiceover
        │
        ▼
Webhook (step = "GenerateVideo")
  └─ Updates scene video_url and video_status
        │
Webhook (step = "GenerateTTS")
  └─ Updates voiceover audio_url and status
        │
        ▼  (optional)
generate-sfx edge function
  └─ Generates sound effects, overwrites video_url
        │
        ▼
Client assembles timeline via addSceneToTimeline()
```

---

## 2. Model Differences Summary

| Feature | Kling O3 / O3 Pro | WAN 2.6 Flash |
|---------|-------------------|---------------|
| **Video model key** | `klingo3`, `klingo3pro` | `wan26flash` |
| **@Element syntax** | `@ElementN` = Nth object (1-indexed) | `@Element1` = background, `@Element2+` = objects |
| **Background ref** | `@Image1` | `@Element1` |
| **Scene prompt type** | `string \| string[]` (multi-shot inline) | `string` only |
| **Multi-shot control** | Array of 2-3 strings in scene_prompts | `scene_multi_shots: boolean[]` separate array |
| **Duration** | 3–15 seconds (flexible) | 5 or 10 seconds only |
| **Audio** | Native audio generation | `enable_audio: false` |
| **fal.ai elements** | `elements[]` with `frontal_image_url` + `reference_image_urls` | Flat `image_urls[]` array |
| **Max elements/scene** | 4 objects + 1 background = 5 | 4 objects + 1 background = 5 |
| **Grid size range** | 2–6 rows/cols | 2–6 rows/cols |

---

## 3. LLM Plan Generation (Two-Pass)

**File:** `editor/src/app/api/storyboard/route.ts` — `generateRefToVideoPlan()`

### Pass 1: Content Generation

```typescript
const isKling = videoModel === 'klingo3' || videoModel === 'klingo3pro';
const systemPrompt = isKling
  ? KLING_O3_SYSTEM_PROMPT
  : WAN26_FLASH_SYSTEM_PROMPT;
const contentSchemaForModel = isKling
  ? klingO3ContentSchema
  : wan26FlashContentSchema;

const userPrompt = `Voiceover Script:\n${voiceoverText}\n\nGenerate the storyboard.`;

const { object: content } = await generateObjectWithFallback({
  primaryModel: llmModel,
  primaryOptions: {
    plugins: [{ id: 'response-healing' }],
    ...(isOpus(llmModel) ? {} : { reasoning: { effort: 'high' } }),
  },
  system: systemPrompt,
  prompt: userPrompt,
  schema: contentSchemaForModel,
  label: 'ref_to_video/content',
});
```

### Post-Content Validation

```typescript
// Grid count validation
if (objectCount !== expectedObjects) {
  throw new Error(`Object count mismatch: grid is ${content.objects_rows}x${content.objects_cols}=${expectedObjects} but got ${objectCount} objects`);
}
if (content.background_names.length !== expectedBgs) {
  throw new Error(`Background count mismatch: grid is ${content.bg_rows}x${content.bg_cols}=${expectedBgs} but got ${content.background_names.length} backgrounds`);
}
```

### Pass 1.5: Reviewer (Fix & Improve)

```typescript
const reviewerSystemPrompt = isKling
  ? KLING_O3_REVIEWER_SYSTEM_PROMPT
  : WAN26_FLASH_REVIEWER_SYSTEM_PROMPT;
const reviewerSchema = isKling
  ? klingO3ReviewerOutputSchema
  : wan26FlashReviewerOutputSchema;
```

The reviewer receives FROZEN context (objects, backgrounds, voiceover_list) and MUTABLE fields (scene_prompts, scene_bg_indices, scene_object_indices, and scene_multi_shots for WAN):

```typescript
const reviewerUserPrompt = `Review and improve this ${isKling ? 'Kling O3' : 'WAN 2.6 Flash'} storyboard plan.

FROZEN (do not change):
${frozenContext}
- background_names (${expectedBgs} items): ${JSON.stringify(content.background_names)}
- voiceover_list (${sceneCount} segments): ${JSON.stringify(content.voiceover_list)}

MUTABLE (fix and improve):
- scene_prompts: ${JSON.stringify(content.scene_prompts)}
- scene_bg_indices: ${JSON.stringify(content.scene_bg_indices)}
- scene_object_indices: ${JSON.stringify(content.scene_object_indices)}${mutableMultiShots}

Return the corrected fields.`;
```

Reviewer uses `reasoning.effort: 'medium'` (vs `'high'` for content generation).

### Post-Reviewer Validation

After merging reviewed fields, validates:
1. Scene count consistency across all arrays
2. `scene_multi_shots` length (WAN only)
3. Index bounds: `scene_bg_indices[i] < expectedBgs` and `scene_object_indices[i][j] < objectCount`
4. **Kling @Element validation:** `@ElementN` where N must be <= `scene_object_indices[i].length`; only `@Image1` valid
5. **WAN @Element validation:** `@ElementN` where N must be <= `scene_object_indices[i].length + 1` (since @Element1 = background)

### Final Plan Assembly

```typescript
// Kling
return {
  objects_rows, objects_cols,
  objects_grid_prompt: `${REF_OBJECTS_GRID_PREFIX} ${klingContent.objects_grid_prompt}`,
  objects: klingContent.objects,
  bg_rows, bg_cols,
  backgrounds_grid_prompt: `${REF_BACKGROUNDS_GRID_PREFIX} ${klingContent.backgrounds_grid_prompt}`,
  background_names, scene_prompts, scene_bg_indices, scene_object_indices,
  voiceover_list,  // Record<string, string[]>
};

// WAN — same but adds:
  scene_multi_shots: wanContent.scene_multi_shots,
```

---

## 4. Zod Schemas

### Kling O3

**File:** `editor/src/lib/schemas/kling-o3-plan.ts`

#### Element Schema

```typescript
const klingElementSchema = z.object({
  name: z.string(),
  description: z.string(),
});
```

#### Scene Prompt Item (supports multi-shot)

```typescript
const scenePromptItem = z.union([
  z.string(),
  z.array(z.string()).min(2).max(3),
]);
```

#### Content Schema (LLM output)

```typescript
export const klingO3ContentSchema = z.object({
  objects_rows: z.number().int().min(2).max(6),
  objects_cols: z.number().int().min(2).max(6),
  objects_grid_prompt: z.string(),
  objects: z.array(klingElementSchema).min(1).max(36),

  bg_rows: z.number().int().min(2).max(6),
  bg_cols: z.number().int().min(2).max(6),
  backgrounds_grid_prompt: z.string(),
  background_names: z.array(z.string()).min(1).max(36),

  scene_prompts: z.array(scenePromptItem),
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(z.array(z.number().int().min(0)).max(4)),

  voiceover_list: z.array(z.string()),
});
```

#### Plan Schema (stored in DB)

```typescript
export const klingO3PlanSchema = z.object({
  objects_rows: z.number().int().min(2).max(6),
  objects_cols: z.number().int().min(2).max(6),
  objects_grid_prompt: z.string(),
  objects: z.array(klingElementSchema).min(1).max(36),

  bg_rows: z.number().int().min(2).max(6),
  bg_cols: z.number().int().min(2).max(6),
  backgrounds_grid_prompt: z.string(),
  background_names: z.array(z.string()).min(1).max(36),

  scene_prompts: z.array(scenePromptItem),
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(z.array(z.number().int().min(0)).max(4)),

  voiceover_list: z.record(z.string(), z.array(z.string())),
});
```

#### Reviewer Output Schema

```typescript
export const klingO3ReviewerOutputSchema = z.object({
  scene_prompts: z.array(scenePromptItem),
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(z.array(z.number().int().min(0)).max(4)),
});
```

### WAN 2.6 Flash

**File:** `editor/src/lib/schemas/wan26-flash-plan.ts`

#### Element Schema

```typescript
export const wan26FlashElementSchema = z.object({
  name: z.string(),
  description: z.string(),
});
```

#### Content Schema (LLM output)

```typescript
export const wan26FlashContentSchema = z.object({
  objects_rows: z.number().int().min(2).max(6),
  objects_cols: z.number().int().min(2).max(6),
  objects_grid_prompt: z.string(),
  objects: z.array(wan26FlashElementSchema).min(1).max(36),

  bg_rows: z.number().int().min(2).max(6),
  bg_cols: z.number().int().min(2).max(6),
  backgrounds_grid_prompt: z.string(),
  background_names: z.array(z.string()).min(1).max(36),

  scene_prompts: z.array(z.string()),
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(z.array(z.number().int().min(0)).max(4)),
  scene_multi_shots: z.array(z.boolean()),

  voiceover_list: z.array(z.string()),
});
```

#### Plan Schema (stored in DB)

```typescript
export const wan26FlashPlanSchema = z.object({
  objects_rows: z.number().int().min(2).max(6),
  objects_cols: z.number().int().min(2).max(6),
  objects_grid_prompt: z.string(),
  objects: z.array(wan26FlashElementSchema).min(1).max(36),

  bg_rows: z.number().int().min(2).max(6),
  bg_cols: z.number().int().min(2).max(6),
  backgrounds_grid_prompt: z.string(),
  background_names: z.array(z.string()).min(1).max(36),

  scene_prompts: z.array(z.string()),
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(z.array(z.number().int().min(0)).max(4)),
  scene_multi_shots: z.array(z.boolean()).optional(),

  voiceover_list: z.record(z.string(), z.array(z.string())),
});
```

**Key differences from content schema:**
- `voiceover_list`: `z.array(z.string())` → `z.record(z.string(), z.array(z.string()))`
- `scene_multi_shots`: required in content, `.optional()` in plan

#### Reviewer Output Schema

```typescript
export const wan26FlashReviewerOutputSchema = z.object({
  scene_prompts: z.array(z.string()),
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(z.array(z.number().int().min(0)).max(4)),
  scene_multi_shots: z.array(z.boolean()),
});
```

**Key schema differences between Kling and WAN:**
- Kling `scene_prompts`: `z.array(scenePromptItem)` — supports `string | string[]`
- WAN `scene_prompts`: `z.array(z.string())` — string only
- WAN has `scene_multi_shots: z.array(z.boolean())` — Kling does not
- Kling reviewer returns 3 fields; WAN reviewer returns 4 (includes `scene_multi_shots`)

---

## 5. System Prompts (Verbatim)

### Kling O3 System Prompt

**File:** `editor/src/lib/schemas/kling-o3-plan.ts`, line 56

```
You are a storyboard planner for AI video generation using Kling O3 (reference-to-video).

RULES:
1. Voiceover Splitting and Grid Planning
- Target 3-12 seconds of speech per voiceover segment.
- Adjust your splitting strategy so the total segment count matches one of the valid grid sizes below for scene count.

2. Elements (Characters/Objects)
- Each scene can use UP TO 4 tracked elements (characters/objects) + 1 background = 5 max. Try to fill all 5 objects for consistency that would avoid the random characters appearing in the video.
- Elements are reusable across scenes. Design distinct, recognizable characters/objects.
- For each element, provide:
  - "name": short label (e.g. "Ahmed", "Cat")
  - "description": detailed FULL-BODY visual description for AI tracking. For human characters, describe from HEAD TO FEET in order: face/hair, upper body clothing (style, color, neckline, sleeve length), lower body clothing (pants/skirt type, color), footwear (type, color), and accessories.
    Example: "A young boy with short brown hair, age 10, medium build, wearing a navy blue zip-up jacket over a white t-shirt, khaki cargo shorts, and gray sneakers with white soles, carrying a red backpack"
- Clothing specificity is critical for consistency. Generic descriptions like "wearing a shirt" or "casual clothes" cause the AI to generate different outfits across scenes. Always specify exact garment type, color, and style.
- Descriptions must be specific enough that the AI can consistently track the element across frames.
- Keep the same clothing for each character in ALL scenes unless the story explicitly requires a change.
- All elements must be front-facing with full body visible. Do NOT use multi-view or turnaround poses.
- Valid grid sizes for objects grid: 2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36).

3. Backgrounds
- Maximize background reuse: prefer fewer unique backgrounds used in many scenes over many unique backgrounds used once.
- Backgrounds represent the environment/location of each scene. They must contain NO people or characters — only the setting itself. The tracked element references will populate the scene during video generation.
- Describe backgrounds with specific atmospheric details: time of day, lighting conditions, weather, key architectural or natural features. Locations should feel lived-in (worn textures, personal objects, environmental details).
- Use varied cinematic camera angles (three-quarter view, slight low angle, wide establishing shot) — not flat straight-on views.
- Valid grid sizes for backgrounds grid: 2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36).

4. Scene Prompts
- Scene prompts use Kling native reference syntax:
  - @ElementN refers to the Nth element assigned to that scene (in order from scene_object_indices). @Element1 is the first object, @Element2 is the second, etc.
  - @Image1 refers to the background assigned to that scene.
- CRITICAL: Do NOT reference @ElementN where N > the number of objects in that scene's scene_object_indices.
  - Example: If scene_object_indices[i] = [0, 3], that scene has 2 objects. Use @Element1 and @Element2 ONLY. Do NOT use @Element3 or higher.
  - Example: If scene_object_indices[i] = [2], that scene has 1 object. Use @Element1 ONLY.
- CHARACTER ATTRIBUTION: When multiple characters appear in a scene, explicitly state which character performs which action. Kling confuses character-action relationships. BAD: "@Element1 and @Element2 argue, one throws a glass." GOOD: "@Element1 slams his fist on the table while @Element2 flinches and steps back."
- REFERENCE BINDING: Place @Element and @Image1 references at the specific narrative moment they appear, not just at the start. E.g., "Camera pans across @Image1, then @Element1 enters from the left and approaches @Element2 who is seated."
- FEWER REFERENCES FOR COMPLEX ACTIONS: For action-heavy scenes (running, fighting, falling), using 1-2 elements produces better motion quality than 3-4. Omit @Image1 when Kling should have creative freedom with the environment.
- DIALOGUE: When characters speak, include emotional delivery cues — tone of voice, facial expression, body language. Kling O3 generates native audio, so ambient sound cues (rain pattering, crowd murmur, footsteps echoing) improve output.

5. Multi-Shot Prompts
- When the voiceover describes multiple distinct actions, transitions, or camera changes, use an ARRAY of 2-3 shot prompts instead of a single string.
- When the voiceover describes a single continuous action or moment, use a single prompt string.
- Each shot uses @ElementN and @Image1 references.
- Shots should form a coherent visual sequence (establishing → action → reaction, or wide → medium → close-up).
- Use cinematic techniques: dolly zooms, tracking shots, rack focus, aerial reveals, close-ups, handheld feel.
- Max 3 shots per scene.

Example multi-shot prompts:
  ["Dolly zoom-in on @Element1 in @Image1, lighting shifts to blue, expression turns from worried to horrified"]
  ["Close-up of @Element1 talking on a train, natural window light, handheld camera feel, shallow depth of field", "@Element1 looks out the window as scenery passes, rack focus to reflection"]
  ["Aerial drone shot slowly revealing @Image1 at sunrise, lens flare, ultra-wide angle", "The camera descends as @Element1 walks into frame from the left", "Medium shot of @Element1 looking up at the sky in @Image1"]


6. Visual & Content Rules
DO:
- The prompts will be English but the texts and style on the image will depend on the language of the voiceover.
- Use modern islamic clothing styles if people are shown. For girls use modest clothing with NO Hijab. Modern muslim fashion styles like Turkey without religious symbols.
- If the voiceover mentions real people, brands, landmarks, or locations, use their actual names and recognizable features.
- Favor photorealistic, natural descriptions. Include subtle imperfections (weathered surfaces, natural skin texture, worn clothing details) to avoid an AI-rendered look.
- Vary camera angles across scenes — avoid repeating the same straight-on medium shot.
DO NOT:
- Do not add any extra text like a message or overlay text — no text will be seen on the grid cell.
- Do not add any violence.
- Do not describe characters with overly perfect or stylized features (no "porcelain skin", "perfectly symmetrical face", etc.).

OUTPUT FORMAT:
Return valid JSON matching this structure:
{
  "objects_rows": 3, "objects_cols": 3,
  "objects_grid_prompt": "A 3x3 Grid. Grid_1x1: A young boy with short brown hair, age 10, wearing a navy blue zip-up jacket over a white t-shirt, khaki cargo shorts, gray sneakers with white soles, carrying a red backpack, full body head to feet, on neutral white background, front-facing. Grid_1x2: A fluffy orange tabby cat with bright green eyes and a red collar with a small bell, full body showing all four paws, on neutral white background, front-facing. Grid_2x1: ..., Grid_2x2: ...",
  "objects": [
    { "name": "Ahmed", "description": "A young boy with short brown hair, age 10, medium build, wearing a navy blue zip-up jacket over a white t-shirt, khaki cargo shorts, and gray sneakers with white soles, carrying a red backpack" },
    { "name": "Cat", "description": "A fluffy orange tabby cat with bright green eyes and a red collar with a small bell" },
     ...
  ],
  "bg_rows": 2, "bg_cols": 2,
  "backgrounds_grid_prompt": "A 2x2 Grid. Grid_1x1: Three-quarter view of a city street at dusk, warm amber streetlights casting long shadows, no people. Grid_1x2: Low-angle view of a school courtyard with green trees and dappled sunlight on stone benches, no people. Grid_2x1: ..., Grid_2x2: ...",
  "background_names": ["City street at dusk", "School courtyard", "Living room", "Park"],
  "scene_prompts": [
    "@Element1 (Ahmed) walks through @Image1 while @Element2 (Cat) trots behind him, the sound of evening traffic in the background",
    ["Wide establishing shot of @Image1 as @Element1 arrives, golden hour light", "Medium shot of @Element1 kneeling down to pet @Element2 in @Image1, warm rim light on both", "Close-up of @Element1 smiling as @Element2 purrs"],
    "@Element1 sits alone in @Image1, leaning back with a tired expression, ambient hum of the room"
  ],
  "scene_bg_indices": [0, 1, 2, 0],
  "scene_object_indices": [[0, 1], [0, 1], [1], [0, 1]],
  "voiceover_list": ["segment 1 text", "segment 2 text", ...]
}
```

### WAN 2.6 Flash System Prompt

**File:** `editor/src/lib/schemas/wan26-flash-plan.ts`, line 60

```
You are a storyboard planner for AI video generation using WAN 2.6 Flash (reference-to-video).

RULES:
1. Voiceover Splitting and Grid Planning
- Target 5 or 10 seconds of speech per voiceover segment (video can only be 5s or 10s).

2. Elements (Characters/Objects)
- Each scene can use UP TO 4 tracked elements (characters/objects) + 1 background = 5 max. Try to fill all 5 elements for consistency that would avoid the random characters appearing in the video.
- Elements are reusable across scenes. Design distinct, recognizable characters/objects.
- For each element, provide:
  - "name": short label (e.g. "Ahmed", "Cat")
  - "description": detailed visual description for AI tracking (e.g. "A young boy with brown hair wearing a blue jacket and red backpack, medium build, age 10")
- Descriptions must be specific enough that the AI can consistently track the element across frames.
- All elements must be front-facing. Do NOT use multi-view or turnaround poses.
- Valid grid sizes for objects grid: 2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36).

3. Backgrounds
- Maximize background reuse: prefer fewer unique backgrounds used in many scenes over many unique backgrounds used once.
- This will be more like environment of the scene they should be empty in terms of human the references will fill the environment
- Valid grid sizes for backgrounds grid: 2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36).

4. Scene Prompts — @Element References
- @Element1 = the background assigned to that scene (from scene_bg_indices).
- @Element2, @Element3, etc. = the characters/objects assigned to that scene (from scene_object_indices), in order.
  - @Element2 = first object in scene_object_indices[i], @Element3 = second, etc.
- CRITICAL: Do NOT reference @ElementN where N > scene_object_indices[i].length + 1.
  - Example: If scene_object_indices[i] = [0, 3], that scene has 2 objects. Use @Element1 (bg), @Element2, @Element3 ONLY.
  - Example: If scene_object_indices[i] = [2], that scene has 1 object. Use @Element1 (bg), @Element2 ONLY.
- Write vivid, cinematic shot descriptions — not generic summaries.
- Include specific camera techniques: dolly zoom, tracking shot, close-up, aerial reveal, handheld feel, rack focus, push-in, crane shot, over-the-shoulder, whip pan.
- Include lighting details: golden hour, rim light, silhouette, chiaroscuro, neon glow, natural window light, dramatic shadows.
- Include character emotions, body language, specific actions, and movements.

5. Multi-Shot Assignment
- When the voiceover describes multiple distinct actions, transitions, or camera changes, use an ARRAY of 2-3 shot prompts instead of a single string.
- When the voiceover describes a single continuous action or moment, use a single prompt string.
- Each shot uses @Element1 (background), @Element2, @Element3, etc.
- Shots should form a coherent visual sequence (establishing → action → reaction, or wide → medium → close-up).
- Use cinematic techniques: dolly zooms, tracking shots, rack focus, aerial reveals, close-ups, handheld feel.
- Max 3 shots per scene.

6. Visual & Content Rules
DO:
- The prompts will be English but the texts and style on the image will depend on the language of the voiceover.
- Use modern islamic clothing styles if people are shown. For girls use modest clothing with NO Hijab. Modern muslim fashion styles like Turkey without religious symbols.
- If the voiceover mentions real people, brands, landmarks, or locations, use their actual names and recognizable features.
DO NOT:
- Do not add any extra text like a message or overlay text — no text will be seen on the grid cell.
- Do not add any violence.


OUTPUT FORMAT:
Return valid JSON matching this structure:
{
  "objects_rows": 2, "objects_cols": 2,
  "objects_grid_prompt": "With 2 A 2x2 Grids. Grid_1x1: A young boy named Ahmed on neutral white background, front-facing. Grid_1x2: A fluffy orange tabby cat on neutral white background. Grid_2x1: ..., Grid_2x2: ...",
  "objects": [
    { "name": "Ahmed", "description": "A young boy with brown hair, blue jacket, red backpack, age 10" },
    { "name": "Cat", "description": "A fluffy orange tabby cat with green eyes and a red collar" },
     ...
  ],  "bg_rows": 2, "bg_cols": 2,
  "backgrounds_grid_prompt": "With 2 A 2x2 Grids. Grid_1x1: City street at dusk with warm streetlights. Grid_1x2: School courtyard with green trees. Grid_2x1: ..., Grid_2x2: ...",
  "background_names": ["City street at dusk", "School courtyard", "Living room", "Park"],
  "scene_prompts": [
    "@Element2 and @Element3 are having a dinner at @Element1, @Element2 says 'Naber bro nasılsın?'",
    ...
  ],
  "scene_bg_indices": [0, 1, 2, 0],
  "scene_object_indices": [[0, 1], [0], [1], [0, 1]],
  "scene_multi_shots": [true, false, false, true],
  "voiceover_list": ["segment 1 text", "segment 2 text", ...]
}
```

---

## 6. Reviewer Prompts (Verbatim)

### Kling O3 Reviewer System Prompt

**File:** `editor/src/lib/schemas/kling-o3-plan.ts`, line 150

```
You are a storyboard reviewer for Kling O3 reference-to-video generation. You receive a generated storyboard plan and must fix errors and improve prompt quality.

YOUR TASKS:

1. Fix @ElementN references
   - For each scene i, check scene_object_indices[i] to know how many objects that scene has.
   - @Element1 = first object in the scene's list, @Element2 = second, etc.
   - NO @ElementN may exceed the count of objects in that scene. If scene_object_indices[i] has 2 items, only @Element1 and @Element2 are valid.
   - Fix any violations by either correcting the reference number or rewriting the prompt.

2. Fix @ImageN references
   - Only @Image1 is valid (one background per scene). Fix any @Image2, @Image3, etc.

3. Improve prompt quality
   - Background images must be empty environments with NO people or characters present.
   - Replace generic, summary-style, or executive-overview prompts with vivid, cinematic shot descriptions.
   - Include specific camera techniques: dolly zoom, tracking shot, close-up, aerial reveal, handheld feel, rack focus, push-in, crane shot, over-the-shoulder, whip pan.
   - Include lighting details: golden hour, rim light, silhouette, chiaroscuro, neon glow, natural window light, dramatic shadows.
   - Include character emotions, body language, specific actions, and movements.
   - Every prompt should read like a shot description from a professional film script.
   - Single-string prompts should describe one continuous shot. Array prompts (2-3 shots) should form a coherent visual sequence.

4. Verify character-action clarity
   - When multiple @ElementN references appear in the same prompt, each character MUST have an explicitly stated action. "They interact" is not acceptable.
   - BAD: "@Element1 and @Element2 talk" → GOOD: "@Element1 gestures animatedly while @Element2 nods and listens."
   - Add character name in parentheses after @ElementN for clarity: "@Element1 (Ahmed) hands the book to @Element2 (Sara)".

5. Check reference density
   - Scenes with @Image1 + 3-4 @Elements + complex physical actions may be over-constrained. Consider dropping @Image1 for action-heavy scenes to give Kling more creative freedom.
   - For dialogue scenes, ensure emotional delivery cues are present (facial expression, body language, tone).

6. Verify multi-shot vs single-shot
   - Use arrays of 2-3 strings for voiceover segments with multiple distinct actions, transitions, or camera changes.
   - Use a single string for continuous moments or single actions.

7. Verify scene assignments
   - Check if object/background assignments make narrative sense for each scene.
   - Reassign scene_bg_indices or scene_object_indices if needed (you can change these).
   - Ensure every scene has at least one object assigned.

DO NOT CHANGE:
- The number of scenes (array lengths must stay the same)
- Object definitions, background definitions, voiceover_list, grid dimensions
- The total set of available object indices or background indices

Return ONLY the corrected scene_prompts, scene_bg_indices, and scene_object_indices.
```

### WAN 2.6 Flash Reviewer System Prompt

**File:** `editor/src/lib/schemas/wan26-flash-plan.ts`, line 133

```
You are a storyboard reviewer for WAN 2.6 Flash reference-to-video generation. You receive a generated storyboard plan and must fix errors and improve prompt quality.

YOUR TASKS:

1. Fix @ElementN references
   - @Element1 = background (one per scene, from scene_bg_indices).
   - @Element2 = first object in scene_object_indices[i], @Element3 = second, etc.
   - Max valid N = scene_object_indices[i].length + 1.
   - If scene_object_indices[i] has 2 items, only @Element1, @Element2, and @Element3 are valid.
   - Fix any violations by either correcting the reference number or rewriting the prompt.

2. Improve prompt quality
   - Backgorund images should be empty places like no human etc.
   - Replace generic, summary-style, or executive-overview prompts with vivid, cinematic shot descriptions.
   - Include specific camera techniques: dolly zoom, tracking shot, close-up, aerial reveal, handheld feel, rack focus, push-in, crane shot, over-the-shoulder, whip pan.
   - Include lighting details: golden hour, rim light, silhouette, chiaroscuro, neon glow, natural window light, dramatic shadows.
   - Include character emotions, body language, specific actions, and movements.
   - Every prompt should read like a shot description from a professional film script.
   - Single-string prompts should describe one continuous shot. Array prompts (2-3 shots) should form a coherent visual sequence.
   - For scenes with scene_multi_shots = true, write prompts that contain multiple distinct actions or transitions suitable for multi-shot rendering.
   - For scenes with scene_multi_shots = false, write prompts that describe one continuous shot or single moment.

3. Decide scene_multi_shots per scene
   - Set scene_multi_shots[i] = true for dynamic scenes with multiple distinct actions, transitions, or camera changes.
   - Set scene_multi_shots[i] = false for simple, continuous moments or single actions.
   - Use arrays of 2-3 strings for voiceover segments with multiple distinct actions, transitions, or camera changes.
   - Use a single string for continuous moments or single actions.

4. Verify scene assignments
   - Check if object/background assignments make narrative sense for each scene.
   - Reassign scene_bg_indices or scene_object_indices if needed (you can change these).
   - Ensure every scene has at least one object assigned.

DO NOT CHANGE:
- The number of scenes (array lengths must stay the same)
- Object definitions, background definitions, voiceover_list, grid dimensions
- The total set of available object indices or background indices

Return ONLY the corrected scene_prompts, scene_bg_indices, scene_object_indices, and scene_multi_shots.
```

---

## 7. Grid Prompt Prefixes (Verbatim)

**File:** `editor/src/lib/schemas/kling-o3-plan.ts`, lines 197-199

### Objects Grid Prefix (shared by Kling and WAN)

```typescript
export const REF_OBJECTS_GRID_PREFIX = `Photorealistic cinematic style with natural skin texture. Grid image with each cell in the same size with 1px black grid lines. Each cell shows one character/object on a neutral white background, front-facing, full body visible from head to shoes, clearly separated. Each character must show their complete outfit clearly visible. Grid cells should be in the same size `;
```

### Backgrounds Grid Prefix (shared by Kling and WAN)

```typescript
export const REF_BACKGROUNDS_GRID_PREFIX = `Photorealistic cinematic style. Grid image with each cell in the same size with 1px black grid lines. Each cell shows one empty environment/location with no people, with varied cinematic camera angles (eye-level, low angle, three-quarter view, wide establishing shot). Locations should feel lived-in and atmospheric with natural lighting and environmental details. Grid cells should be in the same size `;
```

**Usage:** `objects_grid_prompt: \`${REF_OBJECTS_GRID_PREFIX} ${content.objects_grid_prompt}\``

---

## 8. Next.js API Routes

### POST `/api/storyboard` — Create Ref Plan

**File:** `editor/src/app/api/storyboard/route.ts`

- **Input:** `{ voiceoverText, model, projectId, aspectRatio, mode: 'ref_to_video', videoModel, sourceLanguage? }`
- `videoModel` required for ref mode: `'klingo3' | 'klingo3pro' | 'wan26flash'`
- Calls `generateRefToVideoPlan()` (two-pass LLM)
- Inserts storyboard with `mode: 'ref_to_video'`, `model: videoModel`
- **Returns:** full plan + `storyboard_id` + `mode` + `model`

### PATCH `/api/storyboard` — Update Draft

- Validates plan against `klingO3PlanSchema` or `wan26FlashPlanSchema` based on `storyboard.model`

### POST `/api/storyboard/approve` — Start Ref Workflow

**File:** `editor/src/app/api/storyboard/approve/route.ts`

For ref mode, calls edge function `start-ref-workflow` with:

```json
{
  "storyboard_id": "<uuid>",
  "project_id": "<uuid>",
  "objects_rows": 3,
  "objects_cols": 3,
  "objects_grid_prompt": "<prefixed prompt>",
  "object_names": ["Ahmed", "Cat", ...],
  "bg_rows": 2,
  "bg_cols": 2,
  "backgrounds_grid_prompt": "<prefixed prompt>",
  "background_names": ["City street", ...],
  "scene_prompts": [...],
  "scene_bg_indices": [...],
  "scene_object_indices": [...],
  "voiceover_list": { "en": ["..."] },
  "width": 1080,
  "height": 1920,
  "voiceover": "<original script>",
  "aspect_ratio": "9:16"
}
```

**Note:** `object_names` is derived from `plan.objects?.map(o => o.name) ?? plan.object_names` (supports both new and legacy plan shapes).

### POST `/api/storyboard/approve-ref-grid` — Approve Ref Grids & Split

**File:** `editor/src/app/api/storyboard/approve-ref-grid/route.ts`

- Requires `plan_status === 'grid_ready'` and `mode === 'ref_to_video'`
- User can change `objectsRows`, `objectsCols`, `bgRows`, `bgCols` (range 2–6)
- **Grid constraint:** rows must equal cols or cols + 1
- If dimensions changed, adjusts:
  - **objects array:** truncate or pad with `{ name: "Object N", description: "" }`
  - **object_names array** (legacy): truncate or pad with `"Object N"`
  - **scene_object_indices:** filters out indices >= new object count
  - **background_names:** truncate or pad with `"Background N"`
  - **scene_bg_indices:** clamps to `Math.min(idx, newBgCount - 1)`
- Fetches both grid_images (type='objects' and type='backgrounds')
- Builds `objectNames` and `objectDescriptions` from plan
- Calls edge function `approve-ref-split` with:
  ```json
  {
    "storyboard_id": "<uuid>",
    "objects_grid_image_id": "<uuid>",
    "objects_grid_image_url": "<url>",
    "objects_rows": 3, "objects_cols": 3,
    "bg_grid_image_id": "<uuid>",
    "bg_grid_image_url": "<url>",
    "bg_rows": 2, "bg_cols": 2,
    "object_names": ["Ahmed", ...],
    "object_descriptions": ["A young boy...", ...],
    "background_names": ["City street", ...],
    "scene_prompts": [...],
    "scene_bg_indices": [...],
    "scene_object_indices": [...],
    "scene_multi_shots": [true, false, ...],
    "voiceover_list": { "en": ["..."] },
    "width": 1080, "height": 1920
  }
  ```

---

## 9. Edge Functions

### start-ref-workflow

**File:** `supabase/functions/start-ref-workflow/index.ts`

1. Creates TWO `grid_images` records:
   - `{ storyboard_id, status: 'generating', type: 'objects' }`
   - `{ storyboard_id, status: 'generating', type: 'backgrounds' }`
2. Sends TWO parallel fal.ai requests to `workflows/octupost/generategridimage`
   - Objects grid: uses `objects_grid_prompt`, `objects_rows`, `objects_cols`
   - Backgrounds grid: uses `backgrounds_grid_prompt`, `bg_rows`, `bg_cols`
3. Each request has its own webhook URL with the corresponding `grid_image_id`
4. Returns `{ success: true, objects_grid_id, bg_grid_id }`

### approve-ref-split

**File:** `supabase/functions/approve-ref-split/index.ts`

1. Sets `plan_status = 'splitting'`
2. Creates `scenes` records — one per voiceover segment:
   - For Kling multi-shot: stores `prompt` (single string) or `multi_prompt` (string array) based on scene_prompts type
   - For WAN multi-shot: stores `prompt` (string) + `multi_shots` (boolean) from `scene_multi_shots`
   - `scene_index`, `video_status: 'pending'`
3. Creates `scene_objects` records — per-scene, per-object:
   - `scene_id`, `object_index` (from scene_object_indices), `grid_position` (row/col in objects grid)
   - `name` and `description` from object_names/object_descriptions
4. Creates `scene_backgrounds` records — one per scene:
   - `scene_id`, `bg_index` (from scene_bg_indices), `grid_position`
   - `name` from background_names
5. Creates `voiceovers` records — one per scene per language
6. Sends TWO parallel split requests to `comfy/octupost/splitgridimage`:
   - Objects grid split: `objects_grid_image_url`, `objects_rows`, `objects_cols`
   - Backgrounds grid split: `bg_grid_image_url`, `bg_rows`, `bg_cols`
7. Returns `{ success: true }`

---

## 10. Webhook Routing

**File:** `supabase/functions/webhook/index.ts`

### GenGridImage (Ref mode)

- Same handler as I2V — updates grid_images record with URL
- For ref mode, fires TWICE (once per grid)
- Sets `plan_status = 'grid_ready'` only when BOTH grids are complete (checks count)

### SplitGridImage (Ref mode)

Routes by grid type (from grid_images.type):
- **type = 'objects'** → `handleObjectsSplit()`
- **type = 'backgrounds'** → `handleBackgroundsSplit()`

#### handleObjectsSplit()

- Extracts split images from ComfyUI node 30
- Updates `scene_objects` records with cropped reference image URLs
- Maps grid_position (row, col) to the correct split image index

#### handleBackgroundsSplit()

- Extracts split images from ComfyUI node 30 and padded images from node 11
- Updates `scene_backgrounds` records with URLs
- If aspect ratio is non-square: triggers outpaint for each background
- If square (1:1): marks backgrounds as ready immediately
- Calls `tryCompleteSplitting()`

### tryCompleteSplitting() — Atomic Gate

Same pattern as I2V. When all backgrounds are ready:
1. Sets `plan_status = 'scenes_ready'`
2. Triggers `generate-video` for each scene
3. Triggers `generate-tts` for each voiceover

### GenerateVideo / GenerateTTS / GenerateSFX

Same handlers as I2V (see I2V doc sections 9-10).

---

## 11. Video Generation

**File:** `supabase/functions/generate-video/index.ts`

### Ref Model Configuration

| Model Key | fal.ai Endpoint | Duration | Notes |
|-----------|----------------|----------|-------|
| `wan26flash` | `fal-ai/wan/v2.6/image-to-video` | `5` or `10` | `enable_audio: false` |
| `klingo3` | `kling-video/v2.1/master/image-to-video` | `5` (default) | Native audio, elements API |
| `klingo3pro` | `kling-video/v2.1/master/image-to-video` | `5` (default) | Same as klingo3 but pro tier |

### Kling Video Context — `getRefVideoContext()` for Kling

Builds fal.ai request with:
```json
{
  "prompt": "<resolved scene prompt>",
  "image_url": "<background image URL>",
  "elements": [
    {
      "frontal_image_url": "<object cropped image>",
      "reference_image_urls": ["<same object image>"]
    }
  ],
  "duration": 5,
  "aspect_ratio": "9:16"
}
```

- `elements[]` array maps to objects from `scene_objects`
- Each element has `frontal_image_url` (the cropped reference image) and `reference_image_urls` (same image, for Kling's tracking)
- `image_url` is the background image (from `scene_backgrounds`)

### WAN Video Context — `getRefVideoContext()` for WAN

Builds fal.ai request with:
```json
{
  "prompt": "<resolved scene prompt>",
  "image_urls": ["<bg_url>", "<obj1_url>", "<obj2_url>", ...],
  "enable_audio": false,
  "duration": 5
}
```

- `image_urls` is a flat array: `[background, ...objects]` — matching `@Element1` = bg, `@Element2+` = objects
- Duration is 5 or 10 only

### Multi-Shot Handling

#### Kling Multi-Shot

- `scene.multi_prompt` (string array) triggers multi-shot
- `splitMultiPromptDurations(totalDuration, shotCount)` splits duration evenly
- Each shot is a separate fal.ai request, concatenated in post

#### WAN Multi-Shot

- `scene.multi_shots === true` triggers multi-shot
- Prompt is split by sentence/clause boundaries
- Same duration splitting logic

### `resolvePrompt(scene)`

For ref scenes, resolves `@ElementN` and `@Image1` references into the actual prompt text. The references remain as-is in the prompt — they're interpreted by the fal.ai/Kling/WAN APIs natively.

---

## 12. TTS & SFX Generation

### TTS

Same as I2V pipeline. See I2V document section 10.

```
Endpoint: workflows/octupost/tts (via fal.ai)
Default voice: pNInz6obpgDQGcFmaJgB
Speed: 0.7–1.2
Stability: 0.5, Similarity boost: 0.75
Context: previous_text / next_text for natural prosody
```

### SFX (Sound Effects)

**File:** `supabase/functions/generate-sfx/index.ts`

- Only runs when `video_status === 'success'`
- Endpoint: `workflows/octupost/sfx` (via fal.ai)
- Takes the generated video as input
- **Overwrites `video_url`** with the SFX-enhanced version
- Webhook step: `GenerateSFX`

---

## 13. Timeline Assembly

**File:** `editor/src/lib/scene-timeline-utils.ts`

Same `addSceneToTimeline()` function as I2V. See I2V document section 11.

Key behaviors:
- **MAX_SPEED = 2.0** cap on video playback rate
- Uses `Video.fromUrl()` and `Audio.fromUrl()` from OpenVideo library
- Adjusts playbackRate to match voiceover duration to video duration
- Clips placed sequentially on timeline

---

## 14. Realtime Subscriptions

**File:** `editor/src/lib/supabase/workflow-service.ts`

Same subscription system as I2V. Additionally subscribes to:
- **`scene_objects`** — reference image URLs
- **`scene_backgrounds`** — background image URLs

All subscriptions filter by `storyboard_id` and use Supabase Realtime `postgres_changes`.

---

## 15. State Machine

### `plan_status` Transitions

```
draft
  │
  ▼  (POST /api/storyboard/approve)
generating
  │
  ▼  (webhook: GenGridImage × 2 — both grids must complete)
grid_ready
  │
  ▼  (POST /api/storyboard/approve-ref-grid)
splitting
  │
  ▼  (webhook: SplitGridImage × 2 + OutpaintImage × N → tryCompleteSplitting)
scenes_ready
  │
  ▼  (all videos + TTS complete)
complete  (derived in useWorkflow hook)
```

### Key Differences from I2V

- `grid_ready` requires BOTH grids (objects + backgrounds) to be generated
- No `approved` intermediate state — goes directly from `grid_ready` → `splitting`
- `splitting` involves TWO parallel splits (objects grid + backgrounds grid)
- `tryCompleteSplitting()` waits for all backgrounds to be ready (objects don't need outpainting)

---

## 16. Database Tables

### `storyboards` (ref-specific fields)

| Column | Type | Description |
|--------|------|-------------|
| mode | text | `'ref_to_video'` |
| model | text | `'klingo3'`, `'klingo3pro'`, or `'wan26flash'` |
| plan | jsonb | KlingO3Plan or Wan26FlashPlan shape |

### `grid_images` (ref mode creates two)

| Column | Type | Description |
|--------|------|-------------|
| type | text | `'objects'` or `'backgrounds'` (vs `'grid'` for I2V) |

### `scenes` (ref-specific fields)

| Column | Type | Description |
|--------|------|-------------|
| prompt | text | Scene prompt (single string) |
| multi_prompt | jsonb | Array of strings (Kling multi-shot only) |
| multi_shots | boolean | Whether this is a multi-shot scene (WAN only) |

### `scene_objects`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| scene_id | uuid | FK to scenes |
| storyboard_id | uuid | FK to storyboards |
| object_index | integer | Index into plan.objects array |
| grid_position | jsonb | `{ row, col }` position in objects grid |
| name | text | Object name (e.g., "Ahmed") |
| description | text | Object visual description |
| image_url | text | Cropped reference image URL (set after split) |

### `scene_backgrounds`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| scene_id | uuid | FK to scenes |
| storyboard_id | uuid | FK to storyboards |
| bg_index | integer | Index into plan.background_names array |
| grid_position | jsonb | `{ row, col }` position in backgrounds grid |
| name | text | Background name |
| image_url | text | Cropped/outpainted background image URL |
| status | text | `'pending'`, `'outpainting'`, `'ready'` |

### Other tables

Same as I2V: `first_frames`, `voiceovers`, `debug_logs`. See I2V document section 14.

---

*End of Ref-to-Video Pipeline Reference*
