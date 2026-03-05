import { type NextRequest, NextResponse } from 'next/server';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { SUPPORTED_LANGUAGES } from '@/lib/constants/languages';

export const maxDuration = 120;

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const TRANSLATION_MODEL = 'google/gemini-3.1-pro-preview';
const MAX_LANGS_PER_CALL = 5;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

type Scene = {
  id: string;
  order: number;
  voiceovers: { id: string; text: string | null; language: string; status: string }[];
};

export async function POST(req: NextRequest) {
  const supabase = await createClient('studio');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { storyboard_id, target_languages } = await req.json();

  if (!storyboard_id || !Array.isArray(target_languages) || target_languages.length === 0) {
    return NextResponse.json({ error: 'storyboard_id and target_languages[] are required' }, { status: 400 });
  }

  // Validate all language codes
  const invalidCodes = target_languages.filter(
    (code: string) => !SUPPORTED_LANGUAGES.find((l) => l.code === code)
  );
  if (invalidCodes.length > 0) {
    return NextResponse.json({ error: `Invalid language codes: ${invalidCodes.join(', ')}` }, { status: 400 });
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

  const typedScenes = scenes as Scene[];

  // Detect source language
  const sourceLang = typedScenes[0].voiceovers?.find((v) => v.status === 'success')?.language ?? 'en';
  const sourceLangName = SUPPORTED_LANGUAGES.find((l) => l.code === sourceLang)?.name ?? sourceLang;

  // Pre-filter: skip languages that already have voiceovers
  const existingLanguages = new Set(
    typedScenes[0].voiceovers?.map((v) => v.language) ?? []
  );

  const failed: { code: string; reason: string }[] = [];
  const langsToTranslate = target_languages.filter((code: string) => {
    if (existingLanguages.has(code)) {
      failed.push({ code, reason: 'already exists' });
      return false;
    }
    return true;
  });

  if (langsToTranslate.length === 0) {
    return NextResponse.json({ translated: [], failed, scene_count: typedScenes.length });
  }

  // Build segment list from source voiceovers
  const segments = typedScenes.map((scene) =>
    scene.voiceovers?.find((v) => v.language === sourceLang && v.status === 'success')?.text ?? ''
  );

  const prompt = segments.map((s, i) => `${i + 1}. ${s}`).join('\n');

  // Chunk languages and translate
  const chunks = chunkArray(langsToTranslate, MAX_LANGS_PER_CALL);

  const chunkResults = await Promise.allSettled(
    chunks.map(async (chunk: string[]) => {
      const langNames = chunk.map(
        (code) => `${SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code} (${code})`
      );

      const schemaShape: Record<string, z.ZodArray<z.ZodString>> = {};
      for (const lang of chunk) {
        schemaShape[lang] = z.array(z.string());
      }
      const translationSchema = z.object(schemaShape);

      const systemPrompt = `You are a professional translator for video voiceovers.
Translate the following ${segments.length} segments from ${sourceLangName} into ${langNames.join(', ')}.
Use cultural nuances and idiomatic expressions. Keep the same segment count and order for each language.
Return ONLY valid JSON with keys: ${chunk.map((c) => `"${c}"`).join(', ')}. Each key maps to an array of ${segments.length} translated strings.`;

      const { object: translation } = await generateObject({
        model: openrouter.chat(TRANSLATION_MODEL, { plugins: [{ id: 'response-healing' }] }),
        schema: translationSchema,
        system: systemPrompt,
        prompt,
      });

      // Validate and insert per language
      const chunkTranslated: string[] = [];
      const chunkFailed: { code: string; reason: string }[] = [];

      for (const lang of chunk) {
        const translated = translation[lang];
        if (!translated || translated.length !== typedScenes.length) {
          chunkFailed.push({ code: lang, reason: 'segment count mismatch' });
          continue;
        }

        const inserts = typedScenes.map((scene, i) => ({
          scene_id: scene.id,
          text: translated[i],
          language: lang,
          status: 'success' as const,
        }));

        const { error: insertError } = await supabase.from('voiceovers').insert(inserts);
        if (insertError) {
          chunkFailed.push({ code: lang, reason: 'database insert failed' });
          continue;
        }

        chunkTranslated.push(lang);
      }

      return { translated: chunkTranslated, failed: chunkFailed };
    })
  );

  // Aggregate results
  const translated: string[] = [];

  for (const result of chunkResults) {
    if (result.status === 'fulfilled') {
      translated.push(...result.value.translated);
      failed.push(...result.value.failed);
    } else {
      // Entire chunk failed — find which languages were in this chunk
      const chunkIndex = chunkResults.indexOf(result);
      for (const code of chunks[chunkIndex]) {
        failed.push({ code, reason: 'translation failed' });
      }
    }
  }

  if (translated.length === 0 && langsToTranslate.length > 0) {
    return NextResponse.json({ error: 'All translation chunks failed', failed }, { status: 500 });
  }

  return NextResponse.json({ translated, failed, scene_count: typedScenes.length });
}
