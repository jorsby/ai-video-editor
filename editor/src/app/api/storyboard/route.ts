import { type NextRequest, NextResponse } from 'next/server';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
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

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

// --- Image-to-Video schemas ---
const i2vPlanSchema = z.object({
  rows: z.number(),
  cols: z.number(),
  grid_image_prompt: z.string(),
  voiceover_list: z.object({
    en: z.array(z.string()),
    tr: z.array(z.string()),
    ar: z.array(z.string()),
  }),
  visual_flow: z.array(z.string()),
});

const i2vContentSchema = z.object({
  rows: z.number(),
  cols: z.number(),
  grid_image_prompt: z.string(),
  voiceover_list: z.array(z.string()),
  visual_flow: z.array(z.string()),
});

const translationSchema = z.object({
  en: z.array(z.string()),
  tr: z.array(z.string()),
  ar: z.array(z.string()),
});

const I2V_SYSTEM_PROMPT = `You are a professional storyboard generator for moral stories video production. Given a voiceover script, generate a realistic storyboard breakdown.

Rules:
1. Voiceover Splitting and Grid Planning
Target 4-12 seconds of speech per segment.
Adjust your splitting strategy so the total segment count matches one of the valid grid sizes below. The squarest possible grid like  4x4(16), 5x5(25) that fits the segment count is preferred, but you can choose any valid grid size as long as it matches the segment count exactly.
Valid grid sizes are: 2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36)
Grid Image Prompt Format: "With 2 A [Rows]x[Cols] Grids. Grid_1x1: [Full description], Grid_1x2: [Full description]..."
Describe EVERY cell with
DO:
- The prompts will be english but the the texts and style on the iamge will be depeding on the language of the voiceover.
- If there is a human in the scene the face must be shown in the grid cell.
- Use modern islamic clothing styles if people are shown in the scenes.
- For girls use modest clothing with NO Hijab.
- The clothing should be modern muslim fashion styles like Turkey without any religious symbols.
DO NOT DO:
- Do not add any extra text like a message or overlay text no text will be seen on the grid cell,
- Do not add any violence ex: blood.

2. Visual Flow (Image-to-Video Prompts)
One prompt per cell describing how to animate that static frame into video.
Reference what is visible in the first frame and describe the action/movement from there.
When you create grid first frame and visual flow consider it will start first frame and do tha action.
The flow will be english for better prompting but if there is conversation add those in the language of the voiceover and indicate which character is saying what in the visual flow prompt.

3. Real References
If the voiceover mentions real people, brands, landmarks, or locations, use their actual names and recognizable features.

Output:
Return ONLY valid JSON:
{
"rows": <number>,
"cols": <number>,
"grid_image_prompt": "<string>",
"voiceover_list": ["<string>", ...],
"visual_flow": ["<string>", ...]
}`;

const I2V_GRID_PROMPT_PREFIX = `
Cinematic realistic style.
Grid image with each cell will be in the same size with 1px black grid lines.
`;

const TRANSLATION_SYSTEM_PROMPT = `You are a professional translator for video voiceovers.
Given voiceover segments in any language, translate ALL segments into English, Turkish, and Arabic.
Use cultural nuances and idiomatic expressions — do not translate word-for-word.
If the source is already in one of the target languages, still include it as-is in that language's array.
Return exactly the same number of segments for each language.

Important: Do not change the order
Output:
Return ONLY valid JSON:
{
"en": ["<string>", ...],
"tr": ["<string>", ...],
"ar": ["<string>", ...]
}`;

const VALID_MODELS = [
  'google/gemini-3-pro-preview',
  'anthropic/claude-opus-4.6',
  'openai/gpt-5.2-pro',
  'z-ai/glm-5',
] as const;

const VALID_VIDEO_MODELS = ['klingo3', 'klingo3pro', 'wan26flash'] as const;

const isOpus = (model: string) => model.includes('claude-opus');

// --- Ref-to-Video plan generation ---
async function generateRefToVideoPlan(
  voiceoverText: string,
  llmModel: string,
  videoModel: string
) {
  const isKling = videoModel === 'klingo3' || videoModel === 'klingo3pro';
  const systemPrompt = isKling
    ? KLING_O3_SYSTEM_PROMPT
    : WAN26_FLASH_SYSTEM_PROMPT;
  const contentSchemaForModel = isKling
    ? klingO3ContentSchema
    : wan26FlashContentSchema;

  const userPrompt = `Voiceover Script:\n${voiceoverText}\n\nGenerate the storyboard.`;

  // --- Call 1: Content generation ---
  console.log('[Storyboard][ref_to_video] Content LLM request:', {
    model: llmModel,
    videoModel,
  });

  const { object: content } = await generateObject({
    model: openrouter.chat(llmModel, {
      plugins: [{ id: 'response-healing' }],
      ...(isOpus(llmModel) ? {} : { reasoning: { effort: 'high' } }),
    }),
    system: systemPrompt,
    prompt: userPrompt,
    schema: contentSchemaForModel,
  });

  console.log(
    '[Storyboard][ref_to_video] Content LLM response:',
    JSON.stringify(content, null, 2)
  );

  // Compute counts from frozen fields
  const expectedObjects = content.objects_rows * content.objects_cols;
  const objectCount = isKling
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
    const reviewerSystemPrompt = isKling
      ? KLING_O3_REVIEWER_SYSTEM_PROMPT
      : WAN26_FLASH_REVIEWER_SYSTEM_PROMPT;
    const reviewerSchema = isKling
      ? klingO3ReviewerOutputSchema
      : wan26FlashReviewerOutputSchema;

    const frozenContext = isKling
      ? `- objects (${objectCount} items): ${JSON.stringify((content as z.infer<typeof klingO3ContentSchema>).objects)}`
      : `- objects (${objectCount} items): ${JSON.stringify((content as z.infer<typeof wan26FlashContentSchema>).objects)}`;

    const mutableMultiShots = isKling
      ? ''
      : `\n- scene_multi_shots: ${JSON.stringify((content as z.infer<typeof wan26FlashContentSchema>).scene_multi_shots)}`;

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

    console.log('[Storyboard][ref_to_video] Reviewer LLM request');

    const { object: reviewed } = await generateObject({
      model: openrouter.chat(llmModel, {
        plugins: [{ id: 'response-healing' }],
        ...(isOpus(llmModel) ? {} : { reasoning: { effort: 'medium' } }),
      }),
      system: reviewerSystemPrompt,
      prompt: reviewerUserPrompt,
      schema: reviewerSchema,
    });

    console.log(
      '[Storyboard][ref_to_video] Reviewer LLM response:',
      JSON.stringify(reviewed, null, 2)
    );

    // Merge reviewed fields back into content
    content.scene_prompts = reviewed.scene_prompts;
    content.scene_bg_indices = reviewed.scene_bg_indices;
    content.scene_object_indices = reviewed.scene_object_indices;

    // Merge scene_multi_shots for WAN
    if (!isKling && 'scene_multi_shots' in reviewed) {
      (content as z.infer<typeof wan26FlashContentSchema>).scene_multi_shots = (
        reviewed as z.infer<typeof wan26FlashReviewerOutputSchema>
      ).scene_multi_shots;
    }
  }

  // Validate scene counts match (safety net after reviewer)
  if (
    content.scene_prompts.length !== sceneCount ||
    content.scene_bg_indices.length !== sceneCount ||
    content.scene_object_indices.length !== sceneCount
  ) {
    throw new Error(
      `Scene count mismatch: scene_prompts=${content.scene_prompts.length}, scene_bg_indices=${content.scene_bg_indices.length}, scene_object_indices=${content.scene_object_indices.length}, voiceover_list=${sceneCount}`
    );
  }

  // Validate scene_multi_shots length for WAN
  if (!isKling) {
    const wanContent = content as z.infer<typeof wan26FlashContentSchema>;
    if (wanContent.scene_multi_shots.length !== sceneCount) {
      throw new Error(
        `scene_multi_shots length mismatch: got ${wanContent.scene_multi_shots.length} but expected ${sceneCount}`
      );
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

  // Validate @ElementN references for WAN plans
  // @Element1 = background, @Element2+ = characters from scene_object_indices
  if (!isKling) {
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

  // --- Call 2: Translation ---
  const numberedSegments = content.voiceover_list
    .map((seg: string, i: number) => `${i + 1}. ${seg}`)
    .join('\n');

  const translationPrompt = `Translate the following ${sceneCount} voiceover segments:\n\n${numberedSegments}`;

  console.log('[Storyboard][ref_to_video] Translation LLM request');

  const { object: translation } = await generateObject({
    model: openrouter.chat(llmModel, {
      plugins: [{ id: 'response-healing' }],
      ...(isOpus(llmModel) ? {} : { reasoning: { effort: 'medium' } }),
    }),
    system: TRANSLATION_SYSTEM_PROMPT,
    prompt: translationPrompt,
    schema: translationSchema,
  });

  console.log(
    '[Storyboard][ref_to_video] Translation LLM response:',
    JSON.stringify(translation, null, 2)
  );

  const { en, tr, ar } = translation;
  if (
    en.length !== sceneCount ||
    tr.length !== sceneCount ||
    ar.length !== sceneCount
  ) {
    throw new Error(
      `Translation count mismatch: expected ${sceneCount} segments but got en=${en.length}, tr=${tr.length}, ar=${ar.length}`
    );
  }

  // Build final plan — shape depends on video model
  if (isKling) {
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
      scene_bg_indices: klingContent.scene_bg_indices,
      scene_object_indices: klingContent.scene_object_indices,
      voiceover_list: translation,
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
      scene_bg_indices: wanContent.scene_bg_indices,
      scene_object_indices: wanContent.scene_object_indices,
      scene_multi_shots: wanContent.scene_multi_shots,
      voiceover_list: translation,
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

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // --- Ref-to-Video mode ---
    if (mode === 'ref_to_video') {
      const finalPlan = await generateRefToVideoPlan(
        voiceoverText,
        model,
        videoModel
      );

      const { data: storyboard, error: dbError } = await supabase
        .from('storyboards')
        .insert({
          project_id: projectId,
          voiceover: voiceoverText,
          aspect_ratio: aspectRatio,
          plan: finalPlan,
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

      return NextResponse.json({
        ...finalPlan,
        storyboard_id: storyboard.id,
        mode: 'ref_to_video',
        model: videoModel,
      });
    }

    // --- Image-to-Video mode (existing) ---
    const userPrompt = `Voiceover Script:
${voiceoverText}

Generate the storyboard.`;

    console.log('[Storyboard] Content LLM request:', {
      model,
      system: I2V_SYSTEM_PROMPT,
      prompt: userPrompt,
    });

    const { object: content } = await generateObject({
      model: openrouter.chat(model, {
        plugins: [{ id: 'response-healing' }],
        ...(isOpus(model) ? {} : { reasoning: { effort: 'high' } }),
      }),
      system: I2V_SYSTEM_PROMPT,
      prompt: userPrompt,
      schema: i2vContentSchema,
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

    // --- Call 2: Translation ---
    const numberedSegments = content.voiceover_list
      .map((seg, i) => `${i + 1}. ${seg}`)
      .join('\n');

    const translationPrompt = `Translate the following ${expectedScenes} voiceover segments:\n\n${numberedSegments}`;

    console.log('[Storyboard] Translation LLM request:', {
      model,
      system: TRANSLATION_SYSTEM_PROMPT,
      prompt: translationPrompt,
    });

    const { object: translation } = await generateObject({
      model: openrouter.chat(model, {
        plugins: [{ id: 'response-healing' }],
        ...(isOpus(model) ? {} : { reasoning: { effort: 'medium' } }),
      }),
      system: TRANSLATION_SYSTEM_PROMPT,
      prompt: translationPrompt,
      schema: translationSchema,
    });

    console.log(
      '[Storyboard] Translation LLM response:',
      JSON.stringify(translation, null, 2)
    );

    // Validate all 3 language arrays match expected count
    const { en, tr, ar } = translation;
    if (
      en.length !== expectedScenes ||
      tr.length !== expectedScenes ||
      ar.length !== expectedScenes
    ) {
      return NextResponse.json(
        {
          error: `Translation count mismatch: expected ${expectedScenes} segments but got en=${en.length}, tr=${tr.length}, ar=${ar.length}`,
        },
        { status: 500 }
      );
    }

    // Combine into final plan (identical shape to previous output)
    const finalPlan = {
      rows: content.rows,
      cols: content.cols,
      grid_image_prompt: `${I2V_GRID_PROMPT_PREFIX} ${content.grid_image_prompt}`,
      voiceover_list: translation,
      visual_flow: content.visual_flow,
    };

    // Create draft storyboard record with the generated plan
    const { data: storyboard, error: dbError } = await supabase
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
    const supabase = await createClient();
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
    const supabase = await createClient();
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
      .select('plan_status, mode, model')
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
    if (storyboard.mode === 'ref_to_video') {
      const schema =
        storyboard.model === 'klingo3' || storyboard.model === 'klingo3pro'
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

      // Validate grid constraint: rows must equal cols or cols + 1
      if (plan.rows !== plan.cols && plan.rows !== plan.cols + 1) {
        return NextResponse.json(
          {
            error: `Invalid grid: ${plan.rows}x${plan.cols}. rows must equal cols or cols + 1.`,
          },
          { status: 400 }
        );
      }

      // Validate array lengths match grid dimensions
      const expectedScenes = plan.rows * plan.cols;
      const { voiceover_list, visual_flow } = plan;
      if (
        voiceover_list.en.length !== expectedScenes ||
        voiceover_list.tr.length !== expectedScenes ||
        voiceover_list.ar.length !== expectedScenes ||
        visual_flow.length !== expectedScenes
      ) {
        return NextResponse.json(
          {
            error: `Scene count mismatch: grid is ${plan.rows}x${plan.cols}=${expectedScenes} but voiceover_list has en=${voiceover_list.en.length}, tr=${voiceover_list.tr.length}, ar=${voiceover_list.ar.length} and visual_flow has ${visual_flow.length} items`,
          },
          { status: 400 }
        );
      }
    }

    const { error: updateError } = await supabase
      .from('storyboards')
      .update({ plan })
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
