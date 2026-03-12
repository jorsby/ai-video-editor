import { type NextRequest, NextResponse } from 'next/server';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { SUPPORTED_LANGUAGES } from '@/lib/constants/languages';

export const maxDuration = 120;

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const TRANSLATION_MODEL = 'google/gemini-3.1-pro-preview';
const MAX_LANGS_PER_CALL = 3;

type SceneVoiceover = {
  id: string;
  text: string | null;
  language: string;
  status: string;
  audio_url?: string | null;
};

type Scene = {
  id: string;
  order: number;
  voiceovers: SceneVoiceover[];
};

type TranslationJobStatus =
  | 'processing'
  | 'translated_text_ready'
  | 'failed'
  | 'skipped_idempotent';

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function isSupportedLanguage(code: string): boolean {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

function languageName(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

function buildIdempotencyKey(input: {
  projectId: string;
  storyboardId: string;
  sourceLanguage: string;
  targetLanguage: string;
  scriptHash: string;
  voiceProfileHash: string;
}) {
  return createHash('sha256')
    .update(
      [
        input.projectId,
        input.storyboardId,
        input.sourceLanguage,
        input.targetLanguage,
        input.scriptHash,
        input.voiceProfileHash,
      ].join(':')
    )
    .digest('hex');
}

async function safeUpsertTranslationJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  payload: {
    user_id: string;
    project_id: string;
    storyboard_id: string;
    source_language: string;
    target_language: string;
    idempotency_key: string;
    script_hash: string;
    voice_profile_hash: string;
    status: TranslationJobStatus;
    error_message?: string | null;
  }
) {
  try {
    await supabase.from('translation_jobs').upsert(payload, {
      onConflict: 'idempotency_key',
      ignoreDuplicates: false,
    });
  } catch {
    // Table may not exist yet in some environments. Keep translation flow working.
  }
}

async function safeGetTranslationJobByKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  idempotencyKey: string
): Promise<{ status: TranslationJobStatus } | null> {
  try {
    const { data } = await supabase
      .from('translation_jobs')
      .select('status')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    return (data as { status: TranslationJobStatus } | null) ?? null;
  } catch {
    return null;
  }
}

async function translateChunk(
  sourceLanguage: string,
  segments: string[],
  targetChunk: string[]
): Promise<Record<string, string[]>> {
  const sourceLangName = languageName(sourceLanguage);
  const targetNames = targetChunk.map(
    (code) => `${languageName(code)} (${code})`
  );

  const schemaShape: Record<string, z.ZodArray<z.ZodString>> = {};
  for (const lang of targetChunk) {
    schemaShape[lang] = z.array(z.string());
  }
  const translationSchema = z.object(schemaShape);

  const systemPrompt = `You are a professional translator for narrative video voiceovers.
Translate the following ${segments.length} segments from ${sourceLangName} into ${targetNames.join(', ')}.
Rules:
- Keep exact segment count and order for each language.
- Keep placeholders/tokens unchanged (e.g., {object_1}, Character1, @name, URLs, hashtags, numbers).
- Keep tone natural and idiomatic.
Return ONLY valid JSON with keys: ${targetChunk.map((c) => `"${c}"`).join(', ')}.`;

  const prompt = segments.map((s, i) => `${i + 1}. ${s}`).join('\n');

  const { object } = await generateObject({
    model: openrouter.chat(TRANSLATION_MODEL, {
      plugins: [{ id: 'response-healing' }],
    }),
    schema: translationSchema,
    system: systemPrompt,
    prompt,
  });

  return object as Record<string, string[]>;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient('studio');
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const {
    storyboard_id,
    target_languages,
    source_language,
  }: {
    storyboard_id?: string;
    target_languages?: string[];
    source_language?: string;
  } = await req.json();

  if (
    !storyboard_id ||
    !Array.isArray(target_languages) ||
    target_languages.length === 0
  ) {
    return NextResponse.json(
      { error: 'storyboard_id and target_languages[] are required' },
      { status: 400 }
    );
  }

  const requestedSourceLanguage = (source_language ?? '').trim();
  if (
    !requestedSourceLanguage ||
    !isSupportedLanguage(requestedSourceLanguage)
  ) {
    return NextResponse.json(
      { error: 'source_language is required and must be valid' },
      { status: 400 }
    );
  }

  const invalidCodes = target_languages.filter(
    (code) => !isSupportedLanguage(code)
  );
  if (invalidCodes.length > 0) {
    return NextResponse.json(
      { error: `Invalid language codes: ${invalidCodes.join(', ')}` },
      { status: 400 }
    );
  }

  const uniqueTargets = [...new Set(target_languages)].filter(
    (code) => code !== requestedSourceLanguage
  );

  if (uniqueTargets.length === 0) {
    return NextResponse.json({
      translated: [],
      failed: target_languages.map((code) => ({
        code,
        reason:
          code === requestedSourceLanguage
            ? 'same as source language'
            : 'duplicate',
      })),
      tts_retry_languages: [],
      scene_count: 0,
      scene_ids: [],
    });
  }

  const { data: storyboard, error: storyboardError } = await supabase
    .from('storyboards')
    .select('id, project_id')
    .eq('id', storyboard_id)
    .maybeSingle();

  if (storyboardError || !storyboard) {
    return NextResponse.json(
      { error: 'Storyboard not found' },
      { status: 404 }
    );
  }

  const { data: scenes } = await supabase
    .from('scenes')
    .select('id, order, voiceovers(id, text, language, status, audio_url)')
    .eq('storyboard_id', storyboard_id)
    .order('order');

  if (!scenes?.length) {
    return NextResponse.json({ error: 'No scenes found' }, { status: 404 });
  }

  const typedScenes = scenes as Scene[];
  const sceneIds = typedScenes.map((scene) => scene.id);

  const sourceSegments = typedScenes.map((scene, index) => {
    const sourceVoiceover = (scene.voiceovers ?? []).find(
      (v) => v.language === requestedSourceLanguage && Boolean(v.text?.trim())
    );

    if (!sourceVoiceover?.text?.trim()) {
      throw new Error(
        `Missing source voiceover text for scene ${index + 1} (${requestedSourceLanguage})`
      );
    }

    return sourceVoiceover.text.trim();
  });

  const scriptHash = createHash('sha256')
    .update(sourceSegments.join('\n---\n'))
    .digest('hex');
  const voiceProfileHash = 'default';

  const translated: string[] = [];
  const failed: { code: string; reason: string }[] = [];
  const ttsRetryLanguages: string[] = [];

  // Idempotency pre-check: if translated text already exists for every scene,
  // skip re-translation so duplicate requests don't rewrite rows.
  // If those rows have missing/failed audio, signal toolbar to rerun TTS.
  const targetsToProcess = uniqueTargets.filter((lang) => {
    const languageRows = typedScenes.map((scene) =>
      (scene.voiceovers ?? []).find((v) => v.language === lang)
    );

    const hasCompleteTranslatedText = languageRows.every((row) =>
      Boolean(row?.text?.trim())
    );

    if (hasCompleteTranslatedText) {
      const hasCompleteAudio = languageRows.every(
        (row) => Boolean(row?.audio_url) && row?.status === 'success'
      );

      if (!hasCompleteAudio) {
        ttsRetryLanguages.push(lang);
      }

      failed.push({ code: lang, reason: 'idempotent skip' });
      return false;
    }

    return true;
  });

  const chunks = chunkArray(targetsToProcess, MAX_LANGS_PER_CALL);

  for (const chunk of chunks) {
    let translationBatch: Record<string, string[]>;

    try {
      translationBatch = await translateChunk(
        requestedSourceLanguage,
        sourceSegments,
        chunk
      );
    } catch {
      for (const lang of chunk) {
        failed.push({ code: lang, reason: 'translation failed' });
      }
      continue;
    }

    for (const lang of chunk) {
      const translatedSegments = translationBatch[lang];
      if (
        !translatedSegments ||
        translatedSegments.length !== typedScenes.length
      ) {
        failed.push({ code: lang, reason: 'segment count mismatch' });
        continue;
      }

      const idempotencyKey = buildIdempotencyKey({
        projectId: storyboard.project_id,
        storyboardId: storyboard_id,
        sourceLanguage: requestedSourceLanguage,
        targetLanguage: lang,
        scriptHash,
        voiceProfileHash,
      });

      const existingJob = await safeGetTranslationJobByKey(
        supabase,
        idempotencyKey
      );
      if (existingJob && existingJob.status !== 'failed') {
        failed.push({ code: lang, reason: 'idempotent skip' });
        continue;
      }

      await safeUpsertTranslationJob(supabase, {
        user_id: user.id,
        project_id: storyboard.project_id,
        storyboard_id,
        source_language: requestedSourceLanguage,
        target_language: lang,
        idempotency_key: idempotencyKey,
        script_hash: scriptHash,
        voice_profile_hash: voiceProfileHash,
        status: 'processing',
        error_message: null,
      });

      try {
        for (let i = 0; i < typedScenes.length; i++) {
          const scene = typedScenes[i];
          const translatedText = translatedSegments[i]?.trim() ?? '';

          const existingVoiceover = (scene.voiceovers ?? []).find(
            (v) => v.language === lang
          );

          if (existingVoiceover) {
            const { error: updateError } = await supabase
              .from('voiceovers')
              .update({
                text: translatedText,
                status: 'pending',
                audio_url: null,
                duration: null,
                request_id: null,
                error_message: null,
              })
              .eq('id', existingVoiceover.id);

            if (updateError) {
              throw updateError;
            }
          } else {
            const { error: insertError } = await supabase
              .from('voiceovers')
              .insert({
                scene_id: scene.id,
                text: translatedText,
                language: lang,
                status: 'pending',
              });

            if (insertError) {
              throw insertError;
            }
          }
        }

        await safeUpsertTranslationJob(supabase, {
          user_id: user.id,
          project_id: storyboard.project_id,
          storyboard_id,
          source_language: requestedSourceLanguage,
          target_language: lang,
          idempotency_key: idempotencyKey,
          script_hash: scriptHash,
          voice_profile_hash: voiceProfileHash,
          status: 'translated_text_ready',
          error_message: null,
        });

        translated.push(lang);
      } catch {
        await safeUpsertTranslationJob(supabase, {
          user_id: user.id,
          project_id: storyboard.project_id,
          storyboard_id,
          source_language: requestedSourceLanguage,
          target_language: lang,
          idempotency_key: idempotencyKey,
          script_hash: scriptHash,
          voice_profile_hash: voiceProfileHash,
          status: 'failed',
          error_message: 'database write failed',
        });

        failed.push({ code: lang, reason: 'database write failed' });
      }
    }
  }

  if (translated.length === 0 && targetsToProcess.length > 0) {
    const nonFatalReasons = new Set([
      'idempotent skip',
      'already translated with audio',
      'same as source language',
      'duplicate',
    ]);

    const hasHardFailure = failed.some(
      (entry) => !nonFatalReasons.has(entry.reason)
    );

    if (hasHardFailure) {
      return NextResponse.json(
        {
          error: 'All translation chunks failed',
          failed,
          tts_retry_languages: ttsRetryLanguages,
          scene_count: typedScenes.length,
          scene_ids: sceneIds,
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    translated,
    failed,
    tts_retry_languages: ttsRetryLanguages,
    scene_count: typedScenes.length,
    scene_ids: sceneIds,
  });
}
