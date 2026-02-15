import { type NextRequest, NextResponse } from 'next/server';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const storyboardSchema = z.object({
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

const contentSchema = z.object({
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

const CONTENT_PROMPT = `You are a professional storyboard generator for video production. Given a voiceover script, generate a realistic storyboard breakdown.

Rules:
1. Voiceover Splitting and Grid Planning
Target 2-8 seconds of speech per segment.
Adjust your splitting strategy so the total segment count matches one of the valid grid sizes below. The squarest possible grid like  4x4(16), 5x5(25) that fits the segment count is preferred, but you can choose any valid grid size as long as it matches the segment count exactly.
Valid grid sizes are: 2x2(4), 3x2(6), 3x3(9), 4x3(12), 4x4(16), 5x4(20), 5x5(25), 6x5(30), 6x6(36), 7x6(42), 7x7(49), 8x7(56), 8x8(64)
Grid Image Prompt Format: "With 2 A [Rows]x[Cols] Grids. Grid_1x1: [Full description], Grid_1x2: [Full description]..."
Describe EVERY cell with 
DO: 
- If the voiceover is in Turkish, the grid image prompt and descriptions must also be in Turkish.
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
The flow can be english for better prompting but if there is conversation add those in the language of the voiceover and indicate which character is saying what in the visual flow prompt. 

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

const GRID_IMAGE_PROMPT_PREFIX = `
Cinematic realistic style. 
Grid image with each cell will be in the same size with 1px black grid lines. 
`;

const TRANSLATION_PROMPT = `You are a professional translator for video voiceovers.
Given voiceover segments in any language, translate ALL segments into English, Turkish, and Arabic.
Use cultural nuances and idiomatic expressions — do not translate word-for-word.
If the source is already in one of the target languages, still include it as-is in that language's array.
Return exactly the same number of segments for each language.

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

export async function POST(req: NextRequest) {
  try {
    const { voiceoverText, model, projectId, aspectRatio } = await req.json();

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

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userPrompt = `Voiceover Script:
${voiceoverText}

Generate the storyboard.`;

    // --- Call 1: Content generation (source language only) ---
    console.log('[Storyboard] Content LLM request:', {
      model,
      system: CONTENT_PROMPT,
      prompt: userPrompt,
    });

    const { object: content } = await generateObject({
      model: openrouter.chat(model, {
        plugins: [{ id: 'response-healing' }],
      }),
      system: CONTENT_PROMPT,
      prompt: userPrompt,
      schema: contentSchema,
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
      system: TRANSLATION_PROMPT,
      prompt: translationPrompt,
    });

    const { object: translation } = await generateObject({
      model: openrouter.chat(model, {
        plugins: [{ id: 'response-healing' }],
      }),
      system: TRANSLATION_PROMPT,
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
      grid_image_prompt: `${GRID_IMAGE_PROMPT_PREFIX} ${content.grid_image_prompt}`,
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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid response structure from AI', details: error.issues },
        { status: 500 }
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
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

    // Validate plan structure
    const planValidation = storyboardSchema.safeParse(plan);
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

    // Only update if plan_status is 'draft'
    const { data: storyboard, error: fetchError } = await supabase
      .from('storyboards')
      .select('plan_status')
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
