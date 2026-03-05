import { type NextRequest, NextResponse } from 'next/server';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const CAPTION_PRIMARY_MODEL = 'arcee-ai/trinity-large-preview:free';
const CAPTION_BACKUP_MODEL = 'stepfun/step-3.5-flash:free';

const captionResultSchema = z.object({
  caption: z
    .string()
    .describe(
      'The social media caption text, engaging and concise. Do NOT include hashtags here.'
    ),
  youtube_title: z
    .string()
    .describe(
      'A YouTube video title (max 100 chars), or empty string if YouTube is not a target platform.'
    ),
  hashtags: z
    .array(z.string().max(50))
    .min(3)
    .max(15)
    .describe(
      'Relevant hashtags without the # symbol, 5-10 tags mixing popular and niche. Maximum 15 tags.'
    ),
});

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English', tr: 'Turkish', ar: 'Arabic', es: 'Spanish',
  fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian',
  ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
  hi: 'Hindi', nl: 'Dutch', pl: 'Polish', sv: 'Swedish',
  da: 'Danish', fi: 'Finnish', no: 'Norwegian', uk: 'Ukrainian',
  cs: 'Czech', ro: 'Romanian', hu: 'Hungarian', id: 'Indonesian',
  ms: 'Malay',
};

const LENGTH_PROMPTS: Record<string, string> = {
  short:
    'Keep the caption very short and punchy. 1-2 sentences maximum. Optimized for quick-scroll platforms like TikTok and X/Twitter.',
  medium:
    'Keep the caption concise but impactful. Aim for 2-4 sentences. Good balance of information and brevity.',
  long: 'Write a longer, storytelling-style caption. 4-8 sentences. Include context, narrative, and a call to action. Suitable for educational or in-depth content.',
};

const TONE_PROMPTS: Record<string, string> = {
  professional:
    'Use a professional, authoritative tone. Sound knowledgeable and credible. Avoid slang or overly casual language.',
  casual:
    'Use a casual, friendly tone. Sound approachable and relatable. Conversational language is encouraged.',
  witty: 'Use a witty, clever tone. Include wordplay, humor, or unexpected angles. Be entertaining while still informative.',
  inspirational:
    'Use an inspirational, motivational tone. Evoke emotion, aspiration, and positive energy. Encourage the audience to take action or feel empowered.',
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

    const { project_id, language, selected_providers, duration, caption_style } =
      await req.json();

    if (!project_id || typeof project_id !== 'string') {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    const lang = typeof language === 'string' ? language : 'en';
    const providers: string[] = Array.isArray(selected_providers)
      ? selected_providers
      : [];
    const videoDuration =
      typeof duration === 'number' ? Math.round(duration) : null;

    // Fetch project name
    const { data: project } = await supabase
      .from('projects')
      .select('name')
      .eq('id', project_id)
      .eq('user_id', user.id)
      .single();

    // Fetch latest storyboard with scenes
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

    const scenes = (
      storyboard?.scenes as Array<{ prompt: string; order: number }> | null
    )
      ?.sort((a, b) => a.order - b.order)
      .map((s) => s.prompt)
      .filter(Boolean) || [];

    // Build prompts
    const hasYouTube = providers.includes('youtube');
    const languageLabel = LANGUAGE_LABELS[lang] || 'English';
    const platformList =
      providers.length > 0
        ? providers
            .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
            .join(', ')
        : 'social media';

    const lengthInstruction =
      LENGTH_PROMPTS[caption_style?.length] || LENGTH_PROMPTS.medium;
    const toneInstruction =
      TONE_PROMPTS[caption_style?.tone] || TONE_PROMPTS.casual;

    const systemPrompt = `You are a social media content expert. Generate engaging social media content for a video that will be posted to: ${platformList}.

CRITICAL LANGUAGE REQUIREMENT: You MUST write the caption${hasYouTube ? ', YouTube title,' : ''} and hashtags in ${languageLabel.toUpperCase()} ONLY. This is mandatory regardless of the language of the video script or scene descriptions provided. Do NOT write in any other language under any circumstances.

Rules:
- LANGUAGE: ${languageLabel} only. Every word of the caption${hasYouTube ? ', title,' : ''} and hashtags must be in ${languageLabel}.
- The caption should be engaging, hook the reader, and encourage interaction (likes, comments, shares).
- ${lengthInstruction}
- ${toneInstruction}
- Do NOT include hashtags in the caption text itself. Hashtags are generated separately.
${hasYouTube ? `- Generate a compelling YouTube title (max 100 characters) in ${languageLabel} that is SEO-friendly and attention-grabbing.` : '- Set youtube_title to an empty string since YouTube is not a target platform.'}
${videoDuration ? `- The video is ${videoDuration} seconds long.` : ''}
- Generate 5-10 relevant hashtags in ${languageLabel} where appropriate. Mix popular broad hashtags with niche-specific ones.
- Do NOT include the # symbol in hashtag strings.`;

    const visualFlowText =
      visualFlow.length > 0
        ? `\nVisual Flow:\n${visualFlow.join('\n')}`
        : '';

    const userPrompt = `Project: "${projectName}"

Voiceover Script:
${voiceoverText || '(No voiceover available)'}

Scene Descriptions:
${scenes.length > 0 ? scenes.join('\n') : '(No scene descriptions available)'}
${visualFlowText}

Generate the social media caption, ${hasYouTube ? 'YouTube title, ' : ''}and hashtags.`;

    let result: z.infer<typeof captionResultSchema>;
    try {
      const { object } = await generateObject({
        model: openrouter.chat(CAPTION_PRIMARY_MODEL),
        schema: captionResultSchema,
        system: systemPrompt,
        prompt: userPrompt,
        maxTokens: 1000,
      });
      result = object;
    } catch (primaryError) {
      console.warn(
        '[Caption] Primary model failed, retrying with backup:',
        primaryError instanceof Error ? primaryError.message : primaryError
      );
      const { object } = await generateObject({
        model: openrouter.chat(CAPTION_BACKUP_MODEL),
        schema: captionResultSchema,
        system: systemPrompt,
        prompt: userPrompt,
        maxTokens: 1000,
      });
      result = object;
    }

    return NextResponse.json({
      caption: result.caption,
      youtube_title: result.youtube_title,
      hashtags: result.hashtags.slice(0, 15),
    });
  } catch (error) {
    console.error('Generate caption error:', error);
    return NextResponse.json(
      { error: 'Failed to generate caption' },
      { status: 500 }
    );
  }
}
