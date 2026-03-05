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

export async function POST(req: NextRequest) {
  const supabase = await createClient('studio');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { scene_id, source_text, source_language, target_languages } = await req.json();

  if (!scene_id || !source_text || !source_language || !Array.isArray(target_languages) || target_languages.length === 0) {
    return NextResponse.json(
      { error: 'scene_id, source_text, source_language, and target_languages[] are required' },
      { status: 400 }
    );
  }

  // Validate all language codes
  const invalidCodes = target_languages.filter(
    (code: string) => !SUPPORTED_LANGUAGES.find((l) => l.code === code)
  );
  if (invalidCodes.length > 0) {
    return NextResponse.json({ error: `Invalid language codes: ${invalidCodes.join(', ')}` }, { status: 400 });
  }

  const sourceLangName = SUPPORTED_LANGUAGES.find((l) => l.code === source_language)?.name ?? source_language;

  // Fetch existing voiceovers for this scene to determine update vs insert
  const { data: existingVoiceovers } = await supabase
    .from('voiceovers')
    .select('id, language')
    .eq('scene_id', scene_id);

  const existingByLang = new Map(
    (existingVoiceovers ?? []).map((v) => [v.language, v.id])
  );

  // Chunk languages and translate
  const chunks = chunkArray(target_languages, MAX_LANGS_PER_CALL);
  const failed: { code: string; reason: string }[] = [];

  const chunkResults = await Promise.allSettled(
    chunks.map(async (chunk: string[]) => {
      const langNames = chunk.map(
        (code) => `${SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code} (${code})`
      );

      const schemaShape: Record<string, z.ZodString> = {};
      for (const lang of chunk) {
        schemaShape[lang] = z.string();
      }
      const translationSchema = z.object(schemaShape);

      const systemPrompt = `You are a professional translator for video voiceovers.
Translate the following text from ${sourceLangName} into ${langNames.join(', ')}.
Use cultural nuances and idiomatic expressions. Maintain the same tone and style.
Return ONLY valid JSON with keys: ${chunk.map((c) => `"${c}"`).join(', ')}. Each key maps to the translated string.`;

      const { object: translation } = await generateObject({
        model: openrouter.chat(TRANSLATION_MODEL, { plugins: [{ id: 'response-healing' }] }),
        schema: translationSchema,
        system: systemPrompt,
        prompt: source_text,
      });

      // Upsert per language
      const chunkTranslated: string[] = [];
      const chunkFailed: { code: string; reason: string }[] = [];

      for (const lang of chunk) {
        const translatedText = translation[lang];
        if (!translatedText) {
          chunkFailed.push({ code: lang, reason: 'empty translation' });
          continue;
        }

        const existingId = existingByLang.get(lang);

        if (existingId) {
          // Update existing voiceover: set new text, clear stale audio
          const { error: updateError } = await supabase
            .from('voiceovers')
            .update({
              text: translatedText,
              status: 'success',
              audio_url: null,
              duration: null,
            })
            .eq('id', existingId);

          if (updateError) {
            chunkFailed.push({ code: lang, reason: 'database update failed' });
            continue;
          }
        } else {
          // Insert new voiceover record
          const { error: insertError } = await supabase
            .from('voiceovers')
            .insert({
              scene_id,
              text: translatedText,
              language: lang,
              status: 'success',
            });

          if (insertError) {
            chunkFailed.push({ code: lang, reason: 'database insert failed' });
            continue;
          }
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
      const chunkIndex = chunkResults.indexOf(result);
      for (const code of chunks[chunkIndex]) {
        failed.push({ code, reason: 'translation failed' });
      }
    }
  }

  if (translated.length === 0 && target_languages.length > 0) {
    return NextResponse.json({ error: 'All translation chunks failed', failed }, { status: 500 });
  }

  return NextResponse.json({ success: true, translated, failed });
}
