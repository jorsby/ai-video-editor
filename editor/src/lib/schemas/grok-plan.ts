import { z } from 'zod';

const planElementSchema = z.object({
  name: z.string(),
  description: z.string(),
});

const scenePromptItem = z.union([
  z.string(),
  z.array(z.string()).min(2).max(3),
]);

<<<<<<< Updated upstream:editor/src/lib/schemas/grok-plan.ts
export const grokPlanSchema = z.object({
  // Objects grid
  objects_rows: z.number().int().min(2).max(6),
  objects_cols: z.number().int().min(2).max(6),
  objects_grid_prompt: z.string(),
  objects: z.array(planElementSchema).min(1).max(36),
=======
export const klingO3PlanSchema = z.object({
  // Objects grid — @deprecated: grid fields optional, assets created separately now
  objects_rows: z.number().int().min(2).max(6).optional(),
  objects_cols: z.number().int().min(2).max(6).optional(),
  objects_grid_prompt: z.string().optional(),
  objects: z.array(klingElementSchema).min(1).max(36).optional(),
>>>>>>> Stashed changes:editor/src/lib/schemas/kling-o3-plan.ts

  // Backgrounds grid — @deprecated: grid fields optional, assets created separately now
  bg_rows: z.number().int().min(2).max(6).optional(),
  bg_cols: z.number().int().min(2).max(6).optional(),
  backgrounds_grid_prompt: z.string().optional(),
  background_names: z.array(z.string()).min(1).max(36).optional(),

  // Scene mapping
  scene_prompts: z.array(scenePromptItem),
  scene_first_frame_prompts: z.array(z.string()).optional(),
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(z.array(z.number().int().min(0)).max(4)),

  // Voiceovers
  voiceover_list: z.record(z.string(), z.array(z.string())),

  // Per-scene duration (seconds) — used for single-prompt scenes
  scene_durations: z.array(z.number().int().min(3).max(30)).optional(),

  // Per-shot durations for multi-prompt scenes — array of arrays
  // null for single-prompt scenes, [duration1, duration2, ...] for multi-shot
  scene_shot_durations: z
    .array(z.union([z.null(), z.array(z.number().int().min(3).max(30))]))
    .optional(),

  // Workflow metadata
  workflow_variant: z.enum(['i2v_from_refs', 'direct_ref_to_video']).optional(),
  video_mode: z.enum(['narrative', 'dialogue_scene']).optional(),
  content_template: z.string().optional(), // deprecated, kept for v1 compat
});

export type GrokPlan = z.infer<typeof grokPlanSchema>;

// Content schema (before translation — voiceover_list is a flat array)
<<<<<<< Updated upstream:editor/src/lib/schemas/grok-plan.ts
export const grokContentSchema = z.object({
  objects_rows: z.number().int().min(2).max(6),
  objects_cols: z.number().int().min(2).max(6),
  objects_grid_prompt: z.string(),
  objects: z.array(planElementSchema).min(1).max(36),
=======
export const klingO3ContentSchema = z.object({
  // @deprecated — grid fields optional, assets created separately
  objects_rows: z.number().int().min(2).max(6).optional(),
  objects_cols: z.number().int().min(2).max(6).optional(),
  objects_grid_prompt: z.string().optional(),
  objects: z.array(klingElementSchema).min(1).max(36).optional(),
>>>>>>> Stashed changes:editor/src/lib/schemas/kling-o3-plan.ts

  // @deprecated — grid fields optional
  bg_rows: z.number().int().min(2).max(6).optional(),
  bg_cols: z.number().int().min(2).max(6).optional(),
  backgrounds_grid_prompt: z.string().optional(),
  background_names: z.array(z.string()).min(1).max(36).optional(),

  scene_prompts: z.array(scenePromptItem),
  scene_first_frame_prompts: z.array(z.string()).optional(),
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(z.array(z.number().int().min(0)).max(4)),

  voiceover_list: z.array(z.string()),

  scene_durations: z.array(z.number().int().min(3).max(30)).optional(),
  scene_shot_durations: z
    .array(z.union([z.null(), z.array(z.number().int().min(3).max(30))]))
    .optional(),
});

export const GROK_SYSTEM_PROMPT = `You are a storyboard planner for AI video generation using Grok Imagine (reference-to-video).

RULES:
1. Voiceover Splitting and Grid Planning
- Target 3-12 seconds of speech per voiceover segment.
- Adjust your splitting strategy so the total segment count matches one of the valid grid sizes below for scene count.

2. Elements (Characters/Objects)
- Each scene can use UP TO 4 tracked elements (characters/objects) + 1 background = 5 max. Try to fill all 5 objects for consistency that would avoid the random characters appearing in the video.
- Elements are reusable across scenes. Design distinct, recognizable characters/objects.
- For each element, provide:
  - "name": short label (e.g. "Elena", "Key Card")
  - "description": detailed FULL-BODY visual description for AI tracking. For human characters, describe from HEAD TO FEET in order: face/hair, upper body clothing (style, color, neckline, sleeve length), lower body clothing (pants/skirt type, color), footwear (type, color), and accessories.
    Example: "A young woman with shoulder-length dark brown hair, late 20s, wearing a charcoal wool coat over a cream turtleneck, dark fitted jeans, and black leather ankle boots, carrying a worn leather travel bag"
- Clothing specificity is critical for consistency. Generic descriptions like "wearing a shirt" or "casual clothes" cause the AI to generate different outfits across scenes. Always specify exact garment type, color, and style.
- Descriptions must be specific enough that the AI can consistently track the element across frames.
- Keep the same clothing for each character in ALL scenes unless the story explicitly requires a change.
- All elements must be front-facing with full body visible. Do NOT use multi-view or turnaround poses.
- Valid grid sizes for objects grid: 2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36).

3. Backgrounds
- Maximize background reuse: prefer fewer unique backgrounds used in many scenes over many unique backgrounds used once.
- Backgrounds represent the environment/location of each scene. They must contain NO people or characters — only the setting itself. The tracked element references will populate the scene during video generation.
- background_names must be canonical location identities only (e.g. "Meccan Alley", "Council Room"). Do NOT encode time of day, lighting, or weather in background_names.
- Put time-of-day, lighting, weather, and mood in scene_prompts (per scene), not in reusable location names.
- backgrounds_grid_prompt should describe the location structure/details in neutral baseline lighting so the same location can be reused across many scenes.
- Use varied cinematic camera angles (three-quarter view, slight low angle, wide establishing shot) — not flat straight-on views.
- Valid grid sizes for backgrounds grid: 2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36).

4. Scene Prompts
- Scene prompts use Grok Imagine reference syntax:
  - @image1 = the background (from scene_bg_indices).
  - @image2..@imageN = objects in the order of scene_object_indices.
- CRITICAL: Do NOT reference @imageN beyond the number of images available.
  - Example: If scene_object_indices[i] = [0, 3], that scene has 2 objects. Use @image1 (bg), @image2 and @image3 ONLY.
  - Example: If scene_object_indices[i] = [2], that scene has 1 object. Use @image1 (bg) and @image2 ONLY.
- CHARACTER ATTRIBUTION: When multiple characters appear in a scene, explicitly state which character performs which action. Grok Imagine confuses character-action relationships. BAD: "@image2 and @image3 argue, one throws a glass." GOOD: "@image2 slams his fist on the table while @image3 flinches and steps back."
- REFERENCE BINDING: Place @image references at the specific narrative moment they appear, not just at the start. E.g., "Camera pans across @image1, then @image2 enters from the left and approaches @image3 who is seated."
- FEWER REFERENCES FOR COMPLEX ACTIONS: For action-heavy scenes (running, fighting, falling), using 1-2 elements produces better motion quality than 3-4. Omit @image1 when Grok Imagine should have creative freedom with the environment.
- DIALOGUE: When characters speak, include emotional delivery cues — tone of voice, facial expression, body language. Grok Imagine generates native audio, so ambient sound cues (rain pattering, crowd murmur, footsteps echoing) improve output.
- ONE ACTION PER SINGLE-PROMPT SCENE: Each single prompt should describe ONE clear action or moment. Don't chain "enters room, sets bag, touches wall, camera pans to mirror" — pick the money shot.

5. Multi-Shot vs Single-Prompt Decision
Grok Imagine supports multi-shot video generation: multiple prompts in one API call, each with its own duration (3-30s per shot), producing a single video with cuts between shots.

USE MULTI-SHOT (array of 2-3 prompts) when:
- The scene has a camera angle change (wide → close-up, establishing → detail)
- There's a shot/reverse-shot pattern (dialogue, reaction)
- The voiceover covers a sequence of actions with natural pauses
- You want a before → after reveal or setup → payoff structure

USE SINGLE PROMPT when:
- The scene is one continuous action (a character walks, a camera pans)
- The moment is atmospheric/ambient (mood shot, landscape)
- The scene is a sustained reaction or emotion close-up

SHOT DURATION GUIDELINES:
- Establishing/wide shots: 5-8 seconds (let the viewer absorb the environment)
- Medium action shots: 4-6 seconds (standard narrative pacing)
- Close-ups and reactions: 3-5 seconds (quick emotional beats)
- Reveals/payoff shots: 5-7 seconds (hold for impact)
- Total multi-shot scene: 6-30 seconds (sum of all shot durations)

Each shot uses the same @image references as the parent scene.
Shots should form a coherent visual sequence with varied framing.

Example multi-shot:
  ["Wide tracking shot following @image2 walking down @image1, flickering lights, 7s establishing tension",
   "Close-up of @image2 glancing up nervously, quickening pace, 4s quick beat"]

Example single:
  "Slow dolly push-in on @image2 in @image1, dim fluorescent light, guarded expression"

6. Visual & Content Rules
DO:
- Prompts are always in English. Visual style adapts to the video bible and style metadata.
- If the voiceover mentions real people, brands, landmarks, or locations, use their actual names and recognizable features.
- Favor photorealistic, natural descriptions. Include subtle imperfections (weathered surfaces, natural skin texture, worn clothing details) to avoid an AI-rendered look.
- Vary camera angles across scenes — avoid repeating the same straight-on medium shot.
- Use cinematic techniques: dolly zoom, tracking shot, close-up, aerial reveal, handheld feel, rack focus, push-in, crane shot, over-the-shoulder, whip pan.
DO NOT:
- Do not add any extra text like a message or overlay text — no text will be seen on the grid cell.
- Do not add any violence.
- Do not describe characters with overly perfect or stylized features (no "porcelain skin", "perfectly symmetrical face", etc.).

OUTPUT FORMAT:
Return valid JSON matching this structure:
{
  "objects_rows": 3, "objects_cols": 3,
  "objects_grid_prompt": "A 3x3 Grid. Grid_1x1: [full body character description], front-facing, neutral white background. Grid_1x2: ...",
  "objects": [
    { "name": "Elena", "description": "A young woman with shoulder-length dark brown hair..." },
    ...
  ],
  "bg_rows": 2, "bg_cols": 2,
  "backgrounds_grid_prompt": "A 2x2 Grid. Grid_1x1: [atmospheric location description, no people]. Grid_1x2: ...",
  "background_names": ["Hotel Lobby", "Room 4B", "Hallway", "Exterior"],
  "scene_prompts": [
    "Single continuous shot: @image2 walks through @image1, dim lighting, guarded expression",
    ["Wide tracking shot of @image2 in @image1, tension building", "Close-up of @image2 reacting with widening eyes"],
    "@image2 sits alone in @image1, slow dolly push-in"
  ],
  "scene_bg_indices": [0, 2, 1],
  "scene_object_indices": [[0], [0], [0, 1]],
  "voiceover_list": {"en": ["segment 1", "segment 2", "segment 3"]},
  "scene_durations": [8, 11, 6],
  "scene_shot_durations": [null, [7, 4], null]
}

IMPORTANT:
- scene_durations[i] = total seconds for single-prompt scenes OR sum of shot durations for multi-shot
- scene_shot_durations[i] = null for single-prompt scenes, [d1, d2, ...] for multi-shot (must match scene_prompts[i] array length)
- scene_shot_durations array length must equal scene_prompts length`;

export const grokReviewerOutputSchema = z.object({
  scene_prompts: z.array(scenePromptItem),
  scene_bg_indices: z.array(z.number().int().min(0)),
  scene_object_indices: z.array(z.array(z.number().int().min(0)).max(4)),
});

export const GROK_REVIEWER_SYSTEM_PROMPT = `You are a storyboard reviewer for Grok Imagine reference-to-video generation. You receive a generated storyboard plan and must fix errors and improve prompt quality.

YOUR TASKS:

1. Fix @image references
   - For each scene i, check scene_object_indices[i] to know how many objects that scene has.
   - @image1 = background, @image2.. = objects in order.
   - NO @imageN may exceed the count of images available. If scene_object_indices[i] has 2 items, only @image1, @image2, @image3 are valid.
   - Fix any violations by either correcting the reference number or rewriting the prompt.

2. Improve prompt quality
   - Background images must be empty environments with NO people or characters present.
   - Replace generic, summary-style, or executive-overview prompts with vivid, cinematic shot descriptions.
   - Include specific camera techniques: dolly zoom, tracking shot, close-up, aerial reveal, handheld feel, rack focus, push-in, crane shot, over-the-shoulder, whip pan.
   - Include lighting details: golden hour, rim light, silhouette, chiaroscuro, neon glow, natural window light, dramatic shadows.
   - Include character emotions, body language, specific actions, and movements.
   - Every prompt should read like a shot description from a professional film script.
   - Single-string prompts should describe one continuous shot. Array prompts (2-3 shots) should form a coherent visual sequence.

4. Verify character-action clarity
   - When multiple @image references appear in the same prompt, each character MUST have an explicitly stated action. "They interact" is not acceptable.
   - BAD: "@image2 and @image3 talk" → GOOD: "@image2 gestures animatedly while @image3 nods and listens."
   - Add character name in parentheses after @image references for clarity: "@image2 (Ahmed) hands the book to @image3 (Sara)".

5. Check reference density
   - Scenes with @image1 + 3-4 object images + complex physical actions may be over-constrained. Consider dropping @image1 for action-heavy scenes to give Grok Imagine more creative freedom.
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

Return ONLY the corrected scene_prompts, scene_bg_indices, and scene_object_indices.`;

/** @deprecated Grid-based asset generation replaced by per-asset generation in Step 3. Kept for backward compat with old storyboards. */
export const REF_OBJECTS_GRID_PREFIX = `Photorealistic cinematic style with natural skin texture. Grid image with each cell in the same size with 1px black grid lines. Each cell shows one character/object on a neutral white background, front-facing, full body visible from head to shoes, clearly separated. Each character must show their complete outfit clearly visible. Grid cells should be in the same size `;

/** @deprecated Grid-based asset generation replaced by per-asset generation in Step 3. Kept for backward compat with old storyboards. */
export const REF_BACKGROUNDS_GRID_PREFIX = `Photorealistic cinematic style. Grid image with each cell in the same size with 1px black grid lines. Each cell shows one empty environment/location with no people, with varied cinematic camera angles (eye-level, low angle, three-quarter view, wide establishing shot). Locations should feel lived-in and atmospheric with natural lighting and environmental details. Grid cells should be in the same size `;
