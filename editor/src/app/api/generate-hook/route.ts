import { type NextRequest, NextResponse } from 'next/server';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const HOOK_PRIMARY_MODEL = 'arcee-ai/trinity-large-preview:free';
const HOOK_BACKUP_MODEL = 'stepfun/step-3.5-flash:free';

const hookResultSchema = z.object({
  line1: z
    .string()
    .max(40)
    .describe('First line of the hook — short, attention-grabbing opener'),
  line2: z
    .string()
    .max(40)
    .describe('Second line of the hook — the main point or keyword'),
  line3: z
    .string()
    .max(40)
    .describe('Third line of the hook — context or payoff'),
});

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  tr: 'Turkish',
  ar: 'Arabic',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  it: 'Italian',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  hi: 'Hindi',
  nl: 'Dutch',
  pl: 'Polish',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  no: 'Norwegian',
  uk: 'Ukrainian',
  cs: 'Czech',
  ro: 'Romanian',
  hu: 'Hungarian',
  id: 'Indonesian',
  ms: 'Malay',
};

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { project_id, language } = await req.json();

    if (!project_id || typeof project_id !== 'string') {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    const lang = typeof language === 'string' ? language : 'en';

    // Fetch project name
    const { data: project } = await supabase
      .from('projects')
      .select('name')
      .eq('id', project_id)
      .eq('user_id', user.id)
      .single();

    // Fetch latest storyboard with voiceover and scenes
    const { data: storyboard } = await supabase
      .from('storyboards')
      .select('voiceover, plan, scenes(prompt, order)')
      .eq('project_id', project_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const projectName = project?.name || 'Untitled';
    const voiceoverText = storyboard?.voiceover || '';
    const plan = storyboard?.plan as Record<string, unknown> | null;
    const visualFlow = Array.isArray(plan?.visual_flow)
      ? (plan.visual_flow as string[])
      : [];

    const scenes =
      (storyboard?.scenes as Array<{ prompt: string; order: number }> | null)
        ?.sort((a, b) => a.order - b.order)
        .map((s) => s.prompt)
        .filter(Boolean) || [];

    const languageLabel = LANGUAGE_LABELS[lang] || 'English';

    const systemPrompt = `You are a video content expert specializing in social media hooks. Generate a compelling 3-line hook (title card) that appears at the very beginning of a video to grab the viewer's attention and tell them what they're about to watch.

CRITICAL LANGUAGE REQUIREMENT: You MUST write ALL three lines in ${languageLabel.toUpperCase()} ONLY. This is mandatory regardless of the language of the video script provided.

Rules:
- Each line should be SHORT — maximum 5-6 words per line.
- Line 1: A short opener that creates curiosity (e.g., "Sort of a", "The secret to", "10 ways to").
- Line 2: The main keyword or topic — this is the most impactful line (e.g., "HIDDEN TREASURE", "PERFECT MORNING", "VIRAL GROWTH").
- Line 3: Context or payoff (e.g., "in Istanbul", "nobody talks about", "that actually work").
- The hook should make viewers want to keep watching.
- Do NOT use hashtags or emojis.
- Keep it punchy and attention-grabbing.`;

    const visualFlowText =
      visualFlow.length > 0 ? `\nVisual Flow:\n${visualFlow.join('\n')}` : '';

    const userPrompt = `Project: "${projectName}"

Voiceover Script:
${voiceoverText || '(No voiceover available)'}

Scene Descriptions:
${scenes.length > 0 ? scenes.join('\n') : '(No scene descriptions available)'}
${visualFlowText}

Generate a 3-line hook for this video in ${languageLabel}.`;

    let result: z.infer<typeof hookResultSchema>;
    try {
      const { object } = await generateObject({
        model: openrouter.chat(HOOK_PRIMARY_MODEL),
        schema: hookResultSchema,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 200,
      });
      result = object;
    } catch (primaryError) {
      console.warn(
        '[Hook] Primary model failed, retrying with backup:',
        primaryError instanceof Error ? primaryError.message : primaryError
      );
      const { object } = await generateObject({
        model: openrouter.chat(HOOK_BACKUP_MODEL),
        schema: hookResultSchema,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: 200,
      });
      result = object;
    }

    return NextResponse.json({
      line1: result.line1,
      line2: result.line2,
      line3: result.line3,
    });
  } catch (error) {
    console.error('Generate hook error:', error);
    return NextResponse.json(
      { error: 'Failed to generate hook' },
      { status: 500 }
    );
  }
}
