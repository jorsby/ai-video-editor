import { type NextRequest, NextResponse } from 'next/server';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import { detectAll } from 'tinyld';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
import {
  klingO3PlanSchema,
  klingO3ContentSchema,
  KLING_O3_SYSTEM_PROMPT,
  klingO3ReviewerOutputSchema,
  KLING_O3_REVIEWER_SYSTEM_PROMPT,
  REF_OBJECTS_GRID_PREFIX,
  REF_BACKGROUNDS_GRID_PREFIX,
} from '@/lib/schemas/kling-o3-plan';
import {
  wan26FlashPlanSchema,
  wan26FlashContentSchema,
  WAN26_FLASH_SYSTEM_PROMPT,
  wan26FlashReviewerOutputSchema,
  WAN26_FLASH_REVIEWER_SYSTEM_PROMPT,
} from '@/lib/schemas/wan26-flash-plan';
import {
  skyreelsPlanSchema,
  skyreelsContentSchema,
  SKYREELS_SYSTEM_PROMPT,
  skyreelsReviewerOutputSchema,
  SKYREELS_REVIEWER_SYSTEM_PROMPT,
} from '@/lib/schemas/skyreels-plan';
import {
  i2vPlanSchema,
  i2vContentSchema,
  I2V_SYSTEM_PROMPT,
  I2V_GRID_PROMPT_PREFIX,
} from '@/lib/schemas/i2v-plan';
import { SUPPORTED_LANGUAGES } from '@/lib/constants/languages';
import { logWorkflowEvent } from '@/lib/logger';
import {
  applyStoryboardTemplateToSystemPrompt,
  DEFAULT_STORYBOARD_CONTENT_TEMPLATE,
  isStoryboardContentTemplate,
  type StoryboardContentTemplate,
} from '@/lib/storyboard-content-template';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// StepFun rejects the response_format used by generateObject (json schema),
// so keep a backup model that supports structured output reliably.
const STORYBOARD_BACKUP_MODEL = 'openai/gpt-5.4';

const SUPPORTED_LANGUAGE_CODES = new Set<string>(
  SUPPORTED_LANGUAGES.map((lang) => lang.code)
);

const LANGUAGE_CODE_ALIASES: Record<string, string> = {
  'pt-br': 'pt',
  'pt-pt': 'pt',
  'zh-cn': 'zh',
  'zh-tw': 'zh',
  'zh-hans': 'zh',
  'zh-hant': 'zh',
  nb: 'no',
  nn: 'no',
};

function normalizeLanguageCode(code: string): string {
  return code.trim().toLowerCase().replace(/_/g, '-');
}

function resolveSupportedLanguageCode(code?: string): string | null {
  if (!code) return null;

  const normalized = normalizeLanguageCode(code);
  const direct = LANGUAGE_CODE_ALIASES[normalized] ?? normalized;
  if (SUPPORTED_LANGUAGE_CODES.has(direct)) return direct;

  const base = direct.split('-')[0] ?? direct;
  return SUPPORTED_LANGUAGE_CODES.has(base) ? base : null;
}

function detectSourceLanguageFromText(voiceoverText: string): string {
  for (const candidate of detectAll(voiceoverText)) {
    const resolved = resolveSupportedLanguageCode(candidate.lang);
    if (resolved) return resolved;
  }
  return 'en';
}

async function generateObjectWithFallback<T>(params: {
  primaryModel: string;
  primaryOptions?: Parameters<ReturnType<typeof createOpenRouter>['chat']>[1];
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  label: string;
}): Promise<{ object: T }> {
  const { primaryModel, primaryOptions, schema, system, prompt, label } =
    params;
  try {
    return await generateObject({
      model: openrouter.chat(primaryModel, primaryOptions),
      schema,
      system,
      prompt,
    });
  } catch (primaryError) {
    console.warn(
      `[Storyboard][${label}] Primary model "${primaryModel}" failed, retrying with backup:`,
      primaryError instanceof Error ? primaryError.message : primaryError
    );
    return await generateObject({
      model: openrouter.chat(STORYBOARD_BACKUP_MODEL, {
        plugins: [{ id: 'response-healing' }],
      }),
      schema,
      system,
      prompt,
    });
  }
}

const VALID_MODELS = [
  'google/gemini-3.1-pro-preview',
  'anthropic/claude-opus-4.6',
  'openai/gpt-5.2-pro',
  'z-ai/glm-5',
] as const;

const VALID_VIDEO_MODELS = [
  'klingo3',
  'klingo3pro',
  'wan26flash',
  'skyreels',
] as const;

const VALID_REF_WORKFLOW_VARIANTS = [
  'i2v_from_refs',
  'direct_ref_to_video',
] as const;

const VALID_REF_VIDEO_MODES = ['narrative', 'dialogue_scene'] as const;
type RefVideoMode = (typeof VALID_REF_VIDEO_MODES)[number];

const isOpus = (model: string) => model.includes('claude-opus');

function isRefVideoMode(value: unknown): value is RefVideoMode {
  return (
    typeof value === 'string' &&
    (VALID_REF_VIDEO_MODES as readonly string[]).includes(value)
  );
}

function buildWanModeSystemPrompt(videoMode: RefVideoMode): string {
  if (videoMode === 'dialogue_scene') {
    return `

MODE: dialogue_scene
- This is a dialogue scene mode. Characters are in conversation, with separate audio track added later.
- Generate scene prompts that visually stage conversation (two-shots, over-the-shoulder, reaction framing, gestures, eye contact).
- Do NOT mention lip-sync, mouth-sync, phonemes, or exact mouth movement matching.
- You MUST include scene_dialogue with EXACTLY one array per scene.
- Each scene_dialogue[i] must include 1-3 lines using objects like {"speaker":"Name","line":"Text"}.

SCENE DURATIONS (dialogue mode only):
- You MUST include "scene_durations" — an array of integers (one per scene), each 5 or 10 seconds (WAN only supports 5s or 10s).
- 5s for short exchanges (1-2 lines) or quick reaction beats.
- 10s for longer conversations (3+ lines), dramatic moments, or scenes with significant action.
- scene_durations.length MUST equal scene_prompts.length.
`;
  }

  return `

MODE: narrative
- This is narrative mode. No character speaking is rendered in-scene.
- Scene prompts must avoid explicit speech wording like "says", "talks", quoted dialogue, or conversation staging.
- Keep focus on action, emotion, body language, framing, and environment.
- scene_dialogue should be omitted or empty for all scenes.
`;
}

function buildWanModeReviewerConstraint(videoMode: RefVideoMode): string {
  return videoMode === 'dialogue_scene'
    ? `- Keep dialogue_scene constraints: conversation framing allowed, no lip-sync language, preserve scene_dialogue as generated.`
    : `- Keep narrative constraints: no explicit speaking/talking/quoted dialogue in scene prompts.`;
}

function buildKlingModeSystemPrompt(videoMode: RefVideoMode): string {
  if (videoMode === 'dialogue_scene') {
    return `

MODE: dialogue_scene
- This is a dialogue scene mode. Characters are in conversation. Kling O3 will generate native audio including dialogue.
- Generate scene prompts that visually stage conversation (two-shots, over-the-shoulder, reaction framing, gestures, eye contact).
- Include emotional delivery cues in prompts: tone of voice, facial expressions, body language.
- Include ambient sound cues (crowd murmur, rain, footsteps) to enrich the native audio.
- Characters should be shown speaking with natural lip movement and gestures.

SCENE DURATIONS (dialogue mode only):
- You MUST include "scene_durations" — an array of integers (one per scene), each between 3 and 15 seconds.
- Estimate duration based on the cinematic needs of each scene:
  - Short exchange (1-2 lines), quick reaction, or a beat: 3-5 seconds
  - Medium conversation (2-4 lines), emotional moment with pauses: 6-10 seconds
  - Long dialogue (5+ lines), dramatic confrontation, or scene with significant physical action: 10-15 seconds
- Think cinematically: a tense silent stare-down deserves more time than a quick "hello". Pacing matters.
- scene_durations.length MUST equal scene_prompts.length.
`;
  }

  return `

MODE: narrative
- This is narrative mode. A separate voiceover narrates over the video.
- Characters must NOT appear to be speaking, talking, or having dialogue on screen.
- Scene prompts must avoid speech wording like "says", "talks", "tells", quoted dialogue, or conversation staging.
- Focus on action, emotion, body language, environmental storytelling, and cinematic framing.
- Kling will generate ambient audio (wind, traffic, nature sounds) which enhances the narrative. Do NOT include dialogue audio cues.
- DIALOGUE section in scene prompts should be omitted entirely.
`;
}

function buildKlingModeReviewerConstraint(videoMode: RefVideoMode): string {
  return videoMode === 'dialogue_scene'
    ? `- Keep dialogue_scene constraints: conversation framing, emotional delivery cues, and character speech allowed.`
    : `- Keep narrative constraints: no speaking, talking, quoted dialogue, or conversation staging in scene prompts. Characters must not appear to be having dialogue.`;
}

function normalizeDialogueLine(
  line: unknown
): { speaker: string; line: string } | null {
  if (!line || typeof line !== 'object') return null;

  const speakerRaw = (line as { speaker?: unknown }).speaker;
  const textRaw = (line as { line?: unknown }).line;

  const speaker = typeof speakerRaw === 'string' ? speakerRaw.trim() : '';
  const text = typeof textRaw === 'string' ? textRaw.trim() : '';

  if (!speaker || !text) return null;

  return { speaker, line: text };
}

function toDialogueVoiceoverText(
  lines: Array<{ speaker: string; line: string }>
): string {
  return lines.map((entry) => `${entry.speaker}: ${entry.line}`).join(' ');
}

// --- Ref-to-Video plan generation ---
async function generateRefToVideoPlan(
  voiceoverText: string,
  llmModel: string,
  videoModel: string,
  sourceLanguage: string,
  contentTemplate: StoryboardContentTemplate,
  videoMode: RefVideoMode,
  seriesContext?: string
) {
  const isKling = videoModel === 'klingo3' || videoModel === 'klingo3pro';
  const isSkyReels = videoModel === 'skyreels';
  const baseSystemPrompt = isSkyReels
    ? SKYREELS_SYSTEM_PROMPT
    : isKling
      ? `${KLING_O3_SYSTEM_PROMPT}${buildKlingModeSystemPrompt(videoMode)}`
      : `${WAN26_FLASH_SYSTEM_PROMPT}${buildWanModeSystemPrompt(videoMode)}`;
  const templatePrompt = applyStoryboardTemplateToSystemPrompt(
    baseSystemPrompt,
    contentTemplate
  );
  const systemPrompt = seriesContext
    ? `${templatePrompt}\n\n--- SERIES CONTEXT ---\nThis episode is part of a series. Use the following context to maintain consistency:\n${seriesContext}\n--- END SERIES CONTEXT ---`
    : templatePrompt;
  const contentSchemaForModel = isSkyReels
    ? skyreelsContentSchema
    : isKling
      ? klingO3ContentSchema
      : wan26FlashContentSchema;

  const userPrompt = `Voiceover Script:\n${voiceoverText}\n\nSelected content template: ${contentTemplate}\nVideo mode: ${videoMode}\n\nGenerate the storyboard.`;

  // --- Call 1: Content generation ---
  console.log('[Storyboard][ref_to_video] Content LLM request:', {
    model: llmModel,
    videoModel,
  });

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

  console.log(
    '[Storyboard][ref_to_video] Content LLM response:',
    JSON.stringify(content, null, 2)
  );

  // Compute counts from frozen fields
  const expectedObjects = content.objects_rows * content.objects_cols;
  const objectCount = isSkyReels
    ? (content as z.infer<typeof skyreelsContentSchema>).objects.length
    : isKling
      ? (content as z.infer<typeof klingO3ContentSchema>).objects.length
      : (content as z.infer<typeof wan26FlashContentSchema>).objects.length;
  const expectedBgs = content.bg_rows * content.bg_cols;
  const sceneCount = content.voiceover_list.length;

  // Validate frozen grid counts (reviewer cannot fix these)
  if (objectCount !== expectedObjects) {
    throw new Error(
      `Object count mismatch: grid is ${content.objects_rows}x${content.objects_cols}=${expectedObjects} but got ${objectCount} objects`
    );
  }
  if (content.background_names.length !== expectedBgs) {
    throw new Error(
      `Background count mismatch: grid is ${content.bg_rows}x${content.bg_cols}=${expectedBgs} but got ${content.background_names.length} backgrounds`
    );
  }

  // --- Call 1.5: Review & Fix (both Kling and WAN) ---
  {
    const reviewerSystemPrompt = isSkyReels
      ? SKYREELS_REVIEWER_SYSTEM_PROMPT
      : isKling
        ? KLING_O3_REVIEWER_SYSTEM_PROMPT
        : WAN26_FLASH_REVIEWER_SYSTEM_PROMPT;
    const reviewerSchema = isSkyReels
      ? skyreelsReviewerOutputSchema
      : isKling
        ? klingO3ReviewerOutputSchema
        : wan26FlashReviewerOutputSchema;

    const frozenContext = isSkyReels
      ? `- objects (${objectCount} items): ${JSON.stringify((content as z.infer<typeof skyreelsContentSchema>).objects)}`
      : isKling
        ? `- objects (${objectCount} items): ${JSON.stringify((content as z.infer<typeof klingO3ContentSchema>).objects)}`
        : `- objects (${objectCount} items): ${JSON.stringify((content as z.infer<typeof wan26FlashContentSchema>).objects)}`;

    const mutableMultiShots =
      isKling || isSkyReels
        ? ''
        : `\n- scene_multi_shots: ${JSON.stringify((content as z.infer<typeof wan26FlashContentSchema>).scene_multi_shots)}`;

    const modelLabel = isSkyReels
      ? 'SkyReels'
      : isKling
        ? 'Kling O3'
        : 'WAN 2.6 Flash';
    const modeConstraint = isSkyReels
      ? ''
      : isKling
        ? `\nMODE CONSTRAINT:\n${buildKlingModeReviewerConstraint(videoMode)}\n`
        : `\nMODE CONSTRAINT:\n${buildWanModeReviewerConstraint(videoMode)}\n`;

    const reviewerUserPrompt = `Review and improve this ${modelLabel} storyboard plan.

Selected content template: ${contentTemplate}
Keep style and tone aligned with the selected template while applying technical fixes.${modeConstraint}
FROZEN (do not change):
${frozenContext}
- background_names (${expectedBgs} items): ${JSON.stringify(content.background_names)}
- voiceover_list (${sceneCount} segments): ${JSON.stringify(content.voiceover_list)}

MUTABLE (fix and improve):
- scene_prompts: ${JSON.stringify(content.scene_prompts)}
- scene_bg_indices: ${JSON.stringify(content.scene_bg_indices)}
- scene_object_indices: ${JSON.stringify(content.scene_object_indices)}${mutableMultiShots}

FROZEN (keep as generated):
- scene_first_frame_prompts: ${JSON.stringify(content.scene_first_frame_prompts)}

Return the corrected fields.`;

    console.log('[Storyboard][ref_to_video] Reviewer LLM request');

    const { object: reviewed } = await generateObjectWithFallback({
      primaryModel: llmModel,
      primaryOptions: {
        plugins: [{ id: 'response-healing' }],
        ...(isOpus(llmModel) ? {} : { reasoning: { effort: 'medium' } }),
      },
      system: reviewerSystemPrompt,
      prompt: reviewerUserPrompt,
      schema: reviewerSchema,
      label: 'ref_to_video/reviewer',
    });

    console.log(
      '[Storyboard][ref_to_video] Reviewer LLM response:',
      JSON.stringify(reviewed, null, 2)
    );

    // Merge reviewed fields back into content
    content.scene_prompts = reviewed.scene_prompts;
    content.scene_bg_indices = reviewed.scene_bg_indices;
    content.scene_object_indices = reviewed.scene_object_indices;

    // Merge scene_multi_shots for WAN (not for Kling or SkyReels)
    if (!isKling && !isSkyReels && 'scene_multi_shots' in reviewed) {
      (content as z.infer<typeof wan26FlashContentSchema>).scene_multi_shots = (
        reviewed as z.infer<typeof wan26FlashReviewerOutputSchema>
      ).scene_multi_shots;
    }
  }

  // Validate scene counts match (safety net after reviewer)
  if (
    content.scene_prompts.length !== sceneCount ||
    content.scene_first_frame_prompts.length !== sceneCount ||
    content.scene_bg_indices.length !== sceneCount ||
    content.scene_object_indices.length !== sceneCount
  ) {
    throw new Error(
      `Scene count mismatch: scene_prompts=${content.scene_prompts.length}, scene_first_frame_prompts=${content.scene_first_frame_prompts.length}, scene_bg_indices=${content.scene_bg_indices.length}, scene_object_indices=${content.scene_object_indices.length}, voiceover_list=${sceneCount}`
    );
  }

  // Validate scene_durations length if present (LLM-planned for dialogue mode)
  if (
    'scene_durations' in content &&
    Array.isArray((content as any).scene_durations) &&
    (content as any).scene_durations.length !== sceneCount
  ) {
    // Length mismatch — drop it rather than crash, fallback will handle it
    console.warn(
      `[Storyboard] scene_durations length mismatch: got ${(content as any).scene_durations.length} but expected ${sceneCount}. Dropping scene_durations.`
    );
    delete (content as any).scene_durations;
  }

  // Validate scene_multi_shots length for WAN (not for Kling or SkyReels)
  let normalizedSceneDialogue:
    | Array<Array<{ speaker: string; line: string }>>
    | undefined;

  if (!isKling && !isSkyReels) {
    const wanContent = content as z.infer<typeof wan26FlashContentSchema>;
    if (wanContent.scene_multi_shots.length !== sceneCount) {
      throw new Error(
        `scene_multi_shots length mismatch: got ${wanContent.scene_multi_shots.length} but expected ${sceneCount}`
      );
    }

    if (videoMode === 'dialogue_scene') {
      normalizedSceneDialogue = Array.from({ length: sceneCount }, (_, i) => {
        const rawSceneLines = Array.isArray(wanContent.scene_dialogue?.[i])
          ? wanContent.scene_dialogue[i]
          : [];
        const normalizedLines = rawSceneLines
          .map(normalizeDialogueLine)
          .filter(
            (line): line is { speaker: string; line: string } => line !== null
          )
          .slice(0, 3);

        if (normalizedLines.length > 0) return normalizedLines;

        const fallbackVoiceover = String(
          wanContent.voiceover_list[i] ?? ''
        ).trim();
        if (!fallbackVoiceover) {
          throw new Error(
            `Scene ${i} in dialogue mode must have at least one dialogue line`
          );
        }

        return [{ speaker: 'Narrator', line: fallbackVoiceover }];
      });

      // Keep TTS source text aligned with dialogue metadata in V1.
      wanContent.voiceover_list = normalizedSceneDialogue.map(
        toDialogueVoiceoverText
      );
    } else {
      normalizedSceneDialogue = undefined;
    }
  }

  // Validate indices are within bounds
  for (let i = 0; i < sceneCount; i++) {
    if (content.scene_bg_indices[i] >= expectedBgs) {
      throw new Error(
        `Scene ${i} references background index ${content.scene_bg_indices[i]} but only ${expectedBgs} backgrounds exist`
      );
    }
    for (const objIdx of content.scene_object_indices[i]) {
      if (objIdx >= objectCount) {
        throw new Error(
          `Scene ${i} references object index ${objIdx} but only ${objectCount} objects exist`
        );
      }
    }
  }

  // Validate @ElementN references for Kling plans
  if (isKling) {
    for (let i = 0; i < sceneCount; i++) {
      const prompts = Array.isArray(content.scene_prompts[i])
        ? (content.scene_prompts[i] as string[])
        : [content.scene_prompts[i] as string];
      const maxElement = content.scene_object_indices[i].length;

      for (const p of prompts) {
        // Validate @ElementN references
        const elementRefs = [...p.matchAll(/@Element(\d+)/g)];
        for (const match of elementRefs) {
          const n = parseInt(match[1], 10);
          if (n > maxElement) {
            throw new Error(
              `Scene ${i} references @Element${n} but only has ${maxElement} object(s) (scene_object_indices: [${content.scene_object_indices[i].join(', ')}]). Use @Element1 to @Element${maxElement} only.`
            );
          }
        }
        // Validate only @Image1 is used
        const imageRefs = [...p.matchAll(/@Image(\d+)/g)];
        for (const match of imageRefs) {
          const n = parseInt(match[1], 10);
          if (n !== 1) {
            throw new Error(
              `Scene ${i} references @Image${n} but only @Image1 is valid (one background per scene).`
            );
          }
        }
      }
    }
  }

  // Validate max 3 objects per scene for SkyReels
  if (isSkyReels) {
    for (let i = 0; i < sceneCount; i++) {
      if (content.scene_object_indices[i].length > 3) {
        throw new Error(
          `Scene ${i} has ${content.scene_object_indices[i].length} objects but SkyReels max is 3`
        );
      }
    }
  }

  // Validate @ElementN references for WAN plans
  // @Element1 = background, @Element2+ = characters from scene_object_indices
  if (!isKling && !isSkyReels) {
    for (let i = 0; i < sceneCount; i++) {
      const prompt = content.scene_prompts[i] as string;
      const maxElement = content.scene_object_indices[i].length + 1; // +1 for background as @Element1

      const elementRefs = [...prompt.matchAll(/@Element(\d+)/g)];
      for (const match of elementRefs) {
        const n = parseInt(match[1], 10);
        if (n < 1 || n > maxElement) {
          throw new Error(
            `Scene ${i} references @Element${n} but max is @Element${maxElement} (1 bg + ${content.scene_object_indices[i].length} object(s)). Use @Element1 to @Element${maxElement} only.`
          );
        }
      }
    }
  }

  // Build voiceover_list with source language only
  const voiceover_list: Record<string, string[]> = {
    [sourceLanguage]: content.voiceover_list,
  };

  // Build final plan — shape depends on video model
  if (isSkyReels) {
    const skyContent = content as z.infer<typeof skyreelsContentSchema>;
    return {
      objects_rows: skyContent.objects_rows,
      objects_cols: skyContent.objects_cols,
      objects_grid_prompt: `${REF_OBJECTS_GRID_PREFIX} ${skyContent.objects_grid_prompt}`,
      objects: skyContent.objects,
      bg_rows: skyContent.bg_rows,
      bg_cols: skyContent.bg_cols,
      backgrounds_grid_prompt: `${REF_BACKGROUNDS_GRID_PREFIX} ${skyContent.backgrounds_grid_prompt}`,
      background_names: skyContent.background_names,
      scene_prompts: skyContent.scene_prompts,
      scene_first_frame_prompts: skyContent.scene_first_frame_prompts,
      scene_bg_indices: skyContent.scene_bg_indices,
      scene_object_indices: skyContent.scene_object_indices,
      voiceover_list,
      content_template: contentTemplate,
    };
  } else if (isKling) {
    const klingContent = content as z.infer<typeof klingO3ContentSchema>;
    return {
      objects_rows: klingContent.objects_rows,
      objects_cols: klingContent.objects_cols,
      objects_grid_prompt: `${REF_OBJECTS_GRID_PREFIX} ${klingContent.objects_grid_prompt}`,
      objects: klingContent.objects,
      bg_rows: klingContent.bg_rows,
      bg_cols: klingContent.bg_cols,
      backgrounds_grid_prompt: `${REF_BACKGROUNDS_GRID_PREFIX} ${klingContent.backgrounds_grid_prompt}`,
      background_names: klingContent.background_names,
      scene_prompts: klingContent.scene_prompts,
      scene_first_frame_prompts: klingContent.scene_first_frame_prompts,
      scene_bg_indices: klingContent.scene_bg_indices,
      scene_object_indices: klingContent.scene_object_indices,
      voiceover_list,
      video_mode: videoMode,
      ...(klingContent.scene_durations
        ? { scene_durations: klingContent.scene_durations }
        : {}),
      content_template: contentTemplate,
    };
  } else {
    const wanContent = content as z.infer<typeof wan26FlashContentSchema>;
    return {
      objects_rows: wanContent.objects_rows,
      objects_cols: wanContent.objects_cols,
      objects_grid_prompt: `${REF_OBJECTS_GRID_PREFIX} ${wanContent.objects_grid_prompt}`,
      objects: wanContent.objects,
      bg_rows: wanContent.bg_rows,
      bg_cols: wanContent.bg_cols,
      backgrounds_grid_prompt: `${REF_BACKGROUNDS_GRID_PREFIX} ${wanContent.backgrounds_grid_prompt}`,
      background_names: wanContent.background_names,
      scene_prompts: wanContent.scene_prompts,
      scene_first_frame_prompts: wanContent.scene_first_frame_prompts,
      scene_bg_indices: wanContent.scene_bg_indices,
      scene_object_indices: wanContent.scene_object_indices,
      scene_multi_shots: wanContent.scene_multi_shots,
      voiceover_list,
      video_mode: videoMode,
      ...(normalizedSceneDialogue
        ? { scene_dialogue: normalizedSceneDialogue }
        : {}),
      ...(wanContent.scene_durations
        ? { scene_durations: wanContent.scene_durations }
        : {}),
      content_template: contentTemplate,
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const {
      voiceoverText,
      model,
      projectId,
      aspectRatio,
      mode = 'image_to_video',
      videoModel,
      workflowVariant,
      videoMode: videoModeInput,
      sourceLanguage: sourceLanguageInput,
      contentTemplate,
    } = await req.json();

    if (!voiceoverText) {
      return NextResponse.json(
        { error: 'Voiceover text is required' },
        { status: 400 }
      );
    }

    if (!model || !(VALID_MODELS as readonly string[]).includes(model)) {
      return NextResponse.json(
        { error: `Invalid model. Must be one of: ${VALID_MODELS.join(', ')}` },
        { status: 400 }
      );
    }

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    if (!aspectRatio) {
      return NextResponse.json(
        { error: 'Aspect ratio is required' },
        { status: 400 }
      );
    }

    const resolvedInputSourceLanguage =
      typeof sourceLanguageInput === 'string' && sourceLanguageInput.trim()
        ? resolveSupportedLanguageCode(sourceLanguageInput)
        : null;

    if (
      typeof sourceLanguageInput === 'string' &&
      sourceLanguageInput.trim() &&
      !resolvedInputSourceLanguage
    ) {
      return NextResponse.json(
        { error: 'Invalid sourceLanguage' },
        { status: 400 }
      );
    }

    const resolvedSourceLanguage =
      resolvedInputSourceLanguage ??
      detectSourceLanguageFromText(voiceoverText);

    if (contentTemplate && !isStoryboardContentTemplate(contentTemplate)) {
      return NextResponse.json(
        {
          error: 'Invalid contentTemplate. Must be one of: ahlak, dizi_hikaye',
        },
        { status: 400 }
      );
    }

    const resolvedContentTemplate =
      contentTemplate && isStoryboardContentTemplate(contentTemplate)
        ? contentTemplate
        : DEFAULT_STORYBOARD_CONTENT_TEMPLATE;

    if (
      mode === 'ref_to_video' &&
      (!videoModel ||
        !(VALID_VIDEO_MODELS as readonly string[]).includes(videoModel))
    ) {
      return NextResponse.json(
        {
          error: `Video model is required for ref_to_video. Must be one of: ${VALID_VIDEO_MODELS.join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (
      mode === 'ref_to_video' &&
      workflowVariant &&
      !(VALID_REF_WORKFLOW_VARIANTS as readonly string[]).includes(
        workflowVariant
      )
    ) {
      return NextResponse.json(
        {
          error: `workflowVariant must be one of: ${VALID_REF_WORKFLOW_VARIANTS.join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (
      mode === 'ref_to_video' &&
      videoModeInput !== undefined &&
      !isRefVideoMode(videoModeInput)
    ) {
      return NextResponse.json(
        {
          error: `videoMode must be one of: ${VALID_REF_VIDEO_MODES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const supabase = await createClient('studio');
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    const apiKeyResult = !sessionUser ? validateApiKey(req) : { valid: false };
    const user =
      sessionUser ??
      (apiKeyResult.valid && apiKeyResult.userId
        ? { id: apiKeyResult.userId }
        : null);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');

    // We need a supabase client that can write to debug_logs (service role not needed, user supabase works)
    const logSupabase = dbClient;

    // --- Ref-to-Video mode ---
    if (mode === 'ref_to_video') {
      const resolvedWorkflowVariant =
        workflowVariant === 'i2v_from_refs'
          ? 'i2v_from_refs'
          : 'direct_ref_to_video';

      const resolvedVideoMode: RefVideoMode =
        (videoModel === 'wan26flash' ||
          videoModel === 'klingo3' ||
          videoModel === 'klingo3pro') &&
        isRefVideoMode(videoModeInput)
          ? videoModeInput
          : 'narrative';

      await logWorkflowEvent(logSupabase, {
        storyboardId: projectId,
        step: 'GeneratePlan',
        status: 'start',
        data: {
          mode,
          videoModel,
          model,
          workflowVariant: resolvedWorkflowVariant,
          videoMode: resolvedVideoMode,
          contentTemplate: resolvedContentTemplate,
        },
      });

      // --- Check if project belongs to a series and build context ---
      let seriesContext: string | undefined;
      try {
        const { data: episodeLink } = await dbClient
          .from('series_episodes')
          .select('series_id, episode_number, title, synopsis')
          .eq('project_id', projectId)
          .single();

        if (episodeLink) {
          const { data: series } = await dbClient
            .from('series')
            .select('name, genre, tone, bible')
            .eq('id', episodeLink.series_id)
            .single();

          const { data: allEpisodes } = (await dbClient
            .from('series_episodes')
            .select('episode_number, title, synopsis')
            .eq('series_id', episodeLink.series_id)
            .order('episode_number')) as {
            data: Array<{
              episode_number: number;
              title: string | null;
              synopsis: string | null;
            }> | null;
          };

          const { data: assets } = (await dbClient
            .from('series_assets')
            .select('type, name, description')
            .eq('series_id', episodeLink.series_id)
            .order('sort_order')) as {
            data: Array<{
              type: string;
              name: string;
              description: string | null;
            }> | null;
          };

          if (series) {
            const parts: string[] = [];
            parts.push(
              `Series: "${series.name}" (${series.genre || 'unspecified genre'})`
            );
            if (series.tone) parts.push(`Tone: ${series.tone}`);
            if (series.bible) parts.push(`Series Bible:\n${series.bible}`);

            if (assets?.length) {
              const characters = assets.filter((a) => a.type === 'character');
              const locations = assets.filter((a) => a.type === 'location');
              if (characters.length) {
                parts.push(
                  `Characters:\n${characters.map((c) => `- ${c.name}: ${c.description || 'No description'}`).join('\n')}`
                );
              }
              if (locations.length) {
                parts.push(
                  `Locations:\n${locations.map((l) => `- ${l.name}: ${l.description || 'No description'}`).join('\n')}`
                );
              }
            }

            parts.push(
              `\nThis is Episode ${episodeLink.episode_number}: "${episodeLink.title || 'Untitled'}"`
            );
            if (episodeLink.synopsis)
              parts.push(`Episode Synopsis: ${episodeLink.synopsis}`);

            if (allEpisodes?.length) {
              const otherEps = allEpisodes
                .filter((e) => e.episode_number !== episodeLink.episode_number)
                .map(
                  (e) =>
                    `  Ep ${e.episode_number}: ${e.title || 'Untitled'} — ${e.synopsis || 'No synopsis'}`
                )
                .join('\n');
              if (otherEps)
                parts.push(`Other episodes in the series:\n${otherEps}`);
            }

            seriesContext = parts.join('\n\n');
            console.log(
              '[Storyboard] Series context injected for episode',
              episodeLink.episode_number
            );
          }
        }
      } catch (err) {
        // No series link — that's fine, standalone project
        console.log('[Storyboard] No series context (standalone project)');
      }

      const finalPlan = await generateRefToVideoPlan(
        voiceoverText,
        model,
        videoModel,
        resolvedSourceLanguage,
        resolvedContentTemplate,
        resolvedVideoMode,
        seriesContext
      );
      const finalPlanWithVariant = {
        ...finalPlan,
        workflow_variant: resolvedWorkflowVariant,
      };

      const { data: storyboard, error: dbError } = await dbClient
        .from('storyboards')
        .insert({
          project_id: projectId,
          voiceover: voiceoverText,
          aspect_ratio: aspectRatio,
          plan: finalPlanWithVariant,
          plan_status: 'draft',
          mode: 'ref_to_video',
          model: videoModel,
        })
        .select()
        .single();

      if (dbError || !storyboard) {
        console.error('Failed to create ref_to_video storyboard:', dbError);
        return NextResponse.json(
          { error: 'Failed to save storyboard draft' },
          { status: 500 }
        );
      }

      await logWorkflowEvent(logSupabase, {
        storyboardId: storyboard.id,
        step: 'GeneratePlan',
        status: 'success',
        data: { mode, storyboardId: storyboard.id },
      });

      return NextResponse.json({
        ...finalPlanWithVariant,
        storyboard_id: storyboard.id,
        mode: 'ref_to_video',
        model: videoModel,
        workflow_variant: resolvedWorkflowVariant,
      });
    }

    // --- Image-to-Video mode ---
    await logWorkflowEvent(logSupabase, {
      storyboardId: projectId,
      step: 'GeneratePlan',
      status: 'start',
      data: {
        mode: 'image_to_video',
        model,
        contentTemplate: resolvedContentTemplate,
      },
    });

    const userPrompt = `Voiceover Script:
${voiceoverText}

Selected content template: ${resolvedContentTemplate}

Generate the storyboard.`;

    const i2vSystemPrompt = applyStoryboardTemplateToSystemPrompt(
      I2V_SYSTEM_PROMPT,
      resolvedContentTemplate
    );

    console.log('[Storyboard] Content LLM request:', {
      model,
      system: i2vSystemPrompt,
      prompt: userPrompt,
    });

    const { object: content } = await generateObjectWithFallback({
      primaryModel: model,
      primaryOptions: {
        plugins: [{ id: 'response-healing' }],
        ...(isOpus(model) ? {} : { reasoning: { effort: 'high' } }),
      },
      system: i2vSystemPrompt,
      prompt: userPrompt,
      schema: i2vContentSchema,
      label: 'i2v/content',
    });

    console.log(
      '[Storyboard] Content LLM response:',
      JSON.stringify(content, null, 2)
    );

    // Validate grid bounds
    if (
      content.rows < 2 ||
      content.rows > 8 ||
      content.cols < 2 ||
      content.cols > 8
    ) {
      return NextResponse.json(
        {
          error: `LLM returned out-of-range grid: ${content.rows}x${content.cols}. rows and cols must be between 2 and 8.`,
        },
        { status: 500 }
      );
    }

    // Validate grid constraint: rows must equal cols or cols + 1
    if (content.rows !== content.cols && content.rows !== content.cols + 1) {
      return NextResponse.json(
        {
          error: `LLM returned invalid grid: ${content.rows}x${content.cols}. rows must equal cols or cols + 1.`,
        },
        { status: 500 }
      );
    }

    // Validate array lengths match grid dimensions
    const expectedScenes = content.rows * content.cols;
    if (
      content.voiceover_list.length !== expectedScenes ||
      content.visual_flow.length !== expectedScenes
    ) {
      return NextResponse.json(
        {
          error: `Scene count mismatch: grid is ${content.rows}x${content.cols}=${expectedScenes} but voiceover_list has ${content.voiceover_list.length} and visual_flow has ${content.visual_flow.length} items`,
        },
        { status: 500 }
      );
    }

    // Build final plan with source language only
    const finalPlan = {
      rows: content.rows,
      cols: content.cols,
      grid_image_prompt: `${I2V_GRID_PROMPT_PREFIX} ${content.grid_image_prompt}`,
      voiceover_list: { [resolvedSourceLanguage]: content.voiceover_list },
      visual_flow: content.visual_flow,
      content_template: resolvedContentTemplate,
    };

    // Create draft storyboard record with the generated plan
    const { data: storyboard, error: dbError } = await dbClient
      .from('storyboards')
      .insert({
        project_id: projectId,
        voiceover: voiceoverText,
        aspect_ratio: aspectRatio,
        plan: finalPlan,
        plan_status: 'draft',
      })
      .select()
      .single();

    if (dbError || !storyboard) {
      console.error('Failed to create draft storyboard:', dbError);
      return NextResponse.json(
        { error: 'Failed to save storyboard draft' },
        { status: 500 }
      );
    }

    await logWorkflowEvent(logSupabase, {
      storyboardId: storyboard.id,
      step: 'GeneratePlan',
      status: 'success',
      data: { mode: 'image_to_video', storyboardId: storyboard.id },
    });

    return NextResponse.json({
      ...finalPlan,
      storyboard_id: storyboard.id,
    });
  } catch (error) {
    console.error('Storyboard generation error:', error);
    // Extract detailed info from AI SDK APICallError (properties are on the error itself)
    const apiErr = error as {
      statusCode?: number;
      responseBody?: string;
      data?: unknown;
      cause?: { message?: string };
    };
    if (apiErr.statusCode || apiErr.responseBody || apiErr.data) {
      console.error('Provider error details:', {
        statusCode: apiErr.statusCode,
        responseBody: apiErr.responseBody,
        data: apiErr.data,
      });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid response structure from AI', details: error.issues },
        { status: 500 }
      );
    }
    // Build a useful error message from available details
    let message =
      error instanceof Error ? error.message : 'Internal server error';
    if (apiErr.data && typeof apiErr.data === 'object') {
      const dataMsg = (apiErr.data as { message?: string }).message;
      if (dataMsg && dataMsg !== message) {
        message = `${message}: ${dataMsg}`;
      }
    }
    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 }
    );
  }
}

// DELETE - Remove storyboard by ID
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Storyboard ID is required' },
        { status: 400 }
      );
    }

    // RLS policies handle authorization - storyboards link to users via project_id
    const { error } = await supabase.from('storyboards').delete().eq('id', id);

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to delete storyboard' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete storyboard error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH - Update draft storyboard plan
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { storyboardId, plan } = await req.json();

    if (!storyboardId) {
      return NextResponse.json(
        { error: 'Storyboard ID is required' },
        { status: 400 }
      );
    }

    if (!plan) {
      return NextResponse.json({ error: 'Plan is required' }, { status: 400 });
    }

    // Fetch storyboard to check status and mode
    const { data: storyboard, error: fetchError } = await supabase
      .from('storyboards')
      .select('plan_status, mode, model, plan')
      .eq('id', storyboardId)
      .single();

    if (fetchError || !storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    if (storyboard.plan_status !== 'draft') {
      return NextResponse.json(
        { error: 'Can only update storyboards with draft status' },
        { status: 400 }
      );
    }

    // Validate plan structure based on mode
    let normalizedPlan = plan;

    if (storyboard.mode === 'ref_to_video') {
      const schema =
        storyboard.model === 'skyreels'
          ? skyreelsPlanSchema
          : storyboard.model === 'klingo3' || storyboard.model === 'klingo3pro'
            ? klingO3PlanSchema
            : wan26FlashPlanSchema;
      const planValidation = schema.safeParse(plan);
      if (!planValidation.success) {
        return NextResponse.json(
          {
            error: 'Invalid ref_to_video plan structure',
            details: planValidation.error.issues,
          },
          { status: 400 }
        );
      }

      const validatedPlan = planValidation.data;
      const existingPlan =
        storyboard.plan && typeof storyboard.plan === 'object'
          ? (storyboard.plan as {
              scene_first_frame_prompts?: string[];
              workflow_variant?: 'i2v_from_refs' | 'direct_ref_to_video';
              content_template?: StoryboardContentTemplate;
              video_mode?: RefVideoMode;
              scene_dialogue?: Array<Array<{ speaker: string; line: string }>>;
              scene_durations?: number[];
            })
          : null;

      const resolvedWorkflowVariant =
        validatedPlan.workflow_variant ?? existingPlan?.workflow_variant;
      const resolvedContentTemplate =
        validatedPlan.content_template ?? existingPlan?.content_template;
      const resolvedVideoMode =
        ('video_mode' in validatedPlan
          ? (validatedPlan as { video_mode?: RefVideoMode }).video_mode
          : undefined) ?? existingPlan?.video_mode;
      const resolvedSceneDialogue =
        ('scene_dialogue' in validatedPlan
          ? (
              validatedPlan as {
                scene_dialogue?: Array<
                  Array<{ speaker: string; line: string }>
                >;
              }
            ).scene_dialogue
          : undefined) ?? existingPlan?.scene_dialogue;

      const resolvedSceneDurations =
        ('scene_durations' in validatedPlan
          ? (validatedPlan as { scene_durations?: number[] }).scene_durations
          : undefined) ?? existingPlan?.scene_durations;

      // Kling generates native dialogue audio from prompts — no scene_dialogue needed.
      // Only WAN requires scene_dialogue for dialogue_scene mode.
      const isKlingModel =
        storyboard.model === 'klingo3' || storyboard.model === 'klingo3pro';
      if (resolvedVideoMode === 'dialogue_scene' && !isKlingModel) {
        if (
          !Array.isArray(resolvedSceneDialogue) ||
          resolvedSceneDialogue.length !== validatedPlan.scene_prompts.length
        ) {
          return NextResponse.json(
            {
              error:
                'dialogue_scene mode requires scene_dialogue with one entry per scene',
            },
            { status: 400 }
          );
        }
      }

      if (!Array.isArray(validatedPlan.scene_first_frame_prompts)) {
        const existingPrompts = existingPlan?.scene_first_frame_prompts;
        const fallbackPrompts = validatedPlan.scene_prompts.map((prompt) =>
          Array.isArray(prompt)
            ? String(prompt[0] ?? '').trim()
            : String(prompt).trim()
        );

        normalizedPlan = {
          ...validatedPlan,
          scene_first_frame_prompts:
            Array.isArray(existingPrompts) &&
            existingPrompts.length === validatedPlan.scene_prompts.length
              ? existingPrompts
              : fallbackPrompts,
          ...(resolvedWorkflowVariant
            ? { workflow_variant: resolvedWorkflowVariant }
            : {}),
          ...(resolvedContentTemplate
            ? { content_template: resolvedContentTemplate }
            : {}),
          ...(resolvedVideoMode ? { video_mode: resolvedVideoMode } : {}),
          ...(resolvedSceneDialogue
            ? { scene_dialogue: resolvedSceneDialogue }
            : {}),
          ...(resolvedSceneDurations
            ? { scene_durations: resolvedSceneDurations }
            : {}),
        };
      } else {
        normalizedPlan = {
          ...validatedPlan,
          ...(resolvedWorkflowVariant
            ? { workflow_variant: resolvedWorkflowVariant }
            : {}),
          ...(resolvedContentTemplate
            ? { content_template: resolvedContentTemplate }
            : {}),
          ...(resolvedVideoMode ? { video_mode: resolvedVideoMode } : {}),
          ...(resolvedSceneDialogue
            ? { scene_dialogue: resolvedSceneDialogue }
            : {}),
          ...(resolvedSceneDurations
            ? { scene_durations: resolvedSceneDurations }
            : {}),
        };
      }
    } else {
      const planValidation = i2vPlanSchema.safeParse(plan);
      if (!planValidation.success) {
        return NextResponse.json(
          {
            error: 'Invalid plan structure',
            details: planValidation.error.issues,
          },
          { status: 400 }
        );
      }

      const validatedPlan = planValidation.data;

      // Validate grid constraint: rows must equal cols or cols + 1
      if (
        validatedPlan.rows !== validatedPlan.cols &&
        validatedPlan.rows !== validatedPlan.cols + 1
      ) {
        return NextResponse.json(
          {
            error: `Invalid grid: ${validatedPlan.rows}x${validatedPlan.cols}. rows must equal cols or cols + 1.`,
          },
          { status: 400 }
        );
      }

      // Validate array lengths match grid dimensions
      const expectedScenes = validatedPlan.rows * validatedPlan.cols;
      const { voiceover_list, visual_flow } = validatedPlan;
      const langArrays = Object.values(voiceover_list) as string[][];
      if (
        langArrays.length === 0 ||
        !langArrays.every((arr) => arr.length === expectedScenes) ||
        visual_flow.length !== expectedScenes
      ) {
        return NextResponse.json(
          {
            error: `Scene count mismatch: grid is ${validatedPlan.rows}x${validatedPlan.cols}=${expectedScenes} but voiceover arrays don't match`,
          },
          { status: 400 }
        );
      }

      const existingPlan =
        storyboard.plan && typeof storyboard.plan === 'object'
          ? (storyboard.plan as {
              content_template?: StoryboardContentTemplate;
            })
          : null;

      const resolvedContentTemplate =
        validatedPlan.content_template ?? existingPlan?.content_template;

      normalizedPlan = {
        ...validatedPlan,
        ...(resolvedContentTemplate
          ? { content_template: resolvedContentTemplate }
          : {}),
      };
    }

    const { error: updateError } = await supabase
      .from('storyboards')
      .update({ plan: normalizedPlan })
      .eq('id', storyboardId);

    if (updateError) {
      console.error('Failed to update storyboard plan:', updateError);
      return NextResponse.json(
        { error: 'Failed to update storyboard' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update storyboard error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
