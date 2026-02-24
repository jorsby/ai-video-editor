import { type NextRequest, NextResponse } from 'next/server';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { SUPPORTED_LANGUAGES } from '@/lib/constants/languages';

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const TRANSLATION_MODEL = 'google/gemini-3.1-pro-preview';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { storyboard_id, target_language } = await req.json();

  if (!storyboard_id || !target_language) {
    return NextResponse.json({ error: 'storyboard_id and target_language are required' }, { status: 400 });
  }
  if (!SUPPORTED_LANGUAGES.find((l) => l.code === target_language)) {
    return NextResponse.json({ error: 'Invalid target_language' }, { status: 400 });
  }

  // Fetch all scenes and their source voiceovers
  const { data: scenes } = await supabase
    .from('scenes')
    .select('id, order, voiceovers(id, text, language, status)')
    .eq('storyboard_id', storyboard_id)
    .order('order');

  if (!scenes?.length) {
    return NextResponse.json({ error: 'No scenes found' }, { status: 404 });
  }

  // Detect source language: the language of existing voiceovers with status 'success'
  const sourceLang = scenes[0].voiceovers?.find((v: { status: string }) => v.status === 'success')?.language ?? 'en';

  // Check target language doesn't already exist
  const alreadyExists = scenes[0].voiceovers?.some((v: { language: string }) => v.language === target_language);
  if (alreadyExists) {
    return NextResponse.json({ error: `${target_language} voiceovers already exist` }, { status: 409 });
  }

  // Build segment list from source voiceovers (one per scene, ordered)
  const segments = scenes.map((scene: { voiceovers: { language: string; text: string | null; status: string }[] }) =>
    scene.voiceovers?.find((v) => v.language === sourceLang && v.status === 'success')?.text ?? ''
  );

  const targetLangName = SUPPORTED_LANGUAGES.find((l) => l.code === target_language)?.name ?? target_language;
  const sourceLangName = SUPPORTED_LANGUAGES.find((l) => l.code === sourceLang)?.name ?? sourceLang;

  const systemPrompt = `You are a professional translator for video voiceovers.
Translate the following ${segments.length} segments from ${sourceLangName} into ${targetLangName}.
Use cultural nuances and idiomatic expressions. Keep the same segment count and order.
Return ONLY valid JSON: { "${target_language}": ["segment1", "segment2", ...] }`;

  const prompt = segments.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const translationSchema = z.object({ [target_language]: z.array(z.string()) });

  try {
    const { object: translation } = await generateObject({
      model: openrouter.chat(TRANSLATION_MODEL, { plugins: [{ id: 'response-healing' }] }),
      schema: translationSchema,
      system: systemPrompt,
      prompt,
    });

    const translated = translation[target_language];
    if (translated.length !== scenes.length) {
      return NextResponse.json({ error: 'Translation segment count mismatch' }, { status: 500 });
    }

    // Insert voiceover records
    const inserts = scenes.map((scene: { id: string }, i: number) => ({
      scene_id: scene.id,
      text: translated[i],
      language: target_language,
      status: 'success' as const,
    }));

    const { error: insertError } = await supabase.from('voiceovers').insert(inserts);
    if (insertError) {
      return NextResponse.json({ error: 'Failed to save translations' }, { status: 500 });
    }

    return NextResponse.json({ success: true, scene_count: scenes.length });
  } catch (err) {
    console.error('Translation error:', err);
    return NextResponse.json({ error: 'Translation failed' }, { status: 500 });
  }
}
