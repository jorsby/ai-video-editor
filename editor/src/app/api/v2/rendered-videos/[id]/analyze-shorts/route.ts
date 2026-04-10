import { type NextRequest, NextResponse } from 'next/server';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/admin';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const PRIMARY_MODEL = 'x-ai/grok-4.1-fast';
const BACKUP_MODEL = 'arcee-ai/trinity-large-preview:free';

const segmentSchema = z.object({
  title: z
    .string()
    .max(80)
    .describe('Catchy, attention-grabbing title for this short clip'),
  start_time: z
    .number()
    .describe('Start time in seconds from the beginning of the full video'),
  end_time: z
    .number()
    .describe('End time in seconds from the beginning of the full video'),
  virality_score: z
    .number()
    .min(1)
    .max(10)
    .describe('Virality potential score from 1 (low) to 10 (extremely viral)'),
  reason: z
    .string()
    .max(200)
    .describe('Brief explanation of why this segment would perform well'),
});

const analyzeResultSchema = z.object({
  segments: z
    .array(segmentSchema)
    .min(1)
    .max(10)
    .describe('Identified viral segments sorted by virality_score descending'),
});

interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
}

interface VoiceoverTranscription {
  text?: string;
  words?: TranscriptWord[];
  duration?: number | null;
}

interface SceneRow {
  order: number;
  audio_text: string | null;
  video_duration: number | null;
  audio_duration: number | null;
  voiceover_transcription: VoiceoverTranscription | null;
}

const SYSTEM_PROMPT = `You are a viral short-form video strategist specializing in TikTok, Instagram Reels, and YouTube Shorts.

Given a full video transcript with word-level timestamps, identify the most compelling segments that would perform well as standalone short-form videos.

Rules:
- Each segment MUST be between 15 and 90 seconds long
- Segments MUST NOT overlap
- Start and end on natural sentence boundaries (use the timestamps to find clean cut points)
- Prioritize segments with: strong hooks or surprising statements, emotional peaks, actionable advice or tips, controversial or thought-provoking takes, humor or relatability
- Assign a virality score from 1 to 10 based on standalone viral potential
- Return segments sorted by virality_score in descending order (most viral first)
- Aim for 2-5 segments depending on the total video length
- Each segment should be self-contained and make sense without the rest of the video
- Do NOT include intro/outro segments unless they contain genuinely compelling content`;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = createServiceClient('studio');

    // 1. Fetch the rendered video to get project_id
    const { data: renderedVideo, error: rvError } = await supabase
      .from('rendered_videos')
      .select('id, project_id, duration')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (rvError || !renderedVideo) {
      return NextResponse.json(
        { error: 'Rendered video not found' },
        { status: 404 }
      );
    }

    // 2. Get video for this project
    const { data: video } = await supabase
      .from('videos')
      .select('id')
      .eq('project_id', renderedVideo.project_id)
      .limit(1)
      .maybeSingle();

    if (!video) {
      return NextResponse.json(
        { error: 'No video found for this project' },
        { status: 404 }
      );
    }

    // 3. Get chapters for this video
    const { data: chapters } = await supabase
      .from('chapters')
      .select('id')
      .eq('video_id', video.id)
      .order('order', { ascending: true });

    if (!chapters || chapters.length === 0) {
      return NextResponse.json({ error: 'No chapters found' }, { status: 404 });
    }

    // 4. Get all scenes across chapters, ordered
    const chapterIds = chapters.map((c: { id: string }) => c.id);
    const { data: scenes, error: scenesError } = await supabase
      .from('scenes')
      .select(
        'order, audio_text, video_duration, audio_duration, voiceover_transcription, chapter_id'
      )
      .in('chapter_id', chapterIds)
      .order('order', { ascending: true });

    if (scenesError || !scenes || scenes.length === 0) {
      return NextResponse.json(
        { error: 'No scenes found for analysis' },
        { status: 404 }
      );
    }

    // 5. Stitch transcript with cumulative time offsets
    const stitchedTranscript = stitchTranscript(
      scenes as SceneRow[],
      renderedVideo.duration
    );

    if (!stitchedTranscript) {
      console.error('[AnalyzeShorts] No transcript data available');
      return NextResponse.json(
        { error: 'No transcript data available for analysis' },
        { status: 400 }
      );
    }

    const videoDuration = renderedVideo.duration || 0;
    console.log(
      `[AnalyzeShorts] Transcript ready: ${stitchedTranscript.split('\n').length} lines, video duration: ${videoDuration}s`
    );

    const userPrompt = `Video duration: ${Math.round(videoDuration)} seconds

Transcript with timestamps:
${stitchedTranscript}

Identify the most viral segments from this video.`;

    // 6. Call LLM with primary + backup fallback
    let result: z.infer<typeof analyzeResultSchema>;
    try {
      console.log('[AnalyzeShorts] Calling primary model:', PRIMARY_MODEL);
      const { object } = await generateObject({
        model: openrouter.chat(PRIMARY_MODEL),
        schema: analyzeResultSchema,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        maxOutputTokens: 2000,
      });
      result = object;
      console.log(
        `[AnalyzeShorts] Primary model returned ${result.segments.length} segments`
      );
    } catch (primaryError) {
      console.warn(
        '[AnalyzeShorts] Primary model failed, retrying with backup:',
        primaryError instanceof Error ? primaryError.message : primaryError
      );
      const { object } = await generateObject({
        model: openrouter.chat(BACKUP_MODEL),
        schema: analyzeResultSchema,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        maxOutputTokens: 2000,
      });
      result = object;
      console.log(
        `[AnalyzeShorts] Backup model returned ${result.segments.length} segments`
      );
    }

    // 7. Validate and clamp segments
    const validSegments = result.segments
      .filter((s) => {
        const duration = s.end_time - s.start_time;
        const valid =
          duration >= 15 &&
          duration <= 90 &&
          s.start_time >= 0 &&
          s.end_time <= videoDuration + 1;
        if (!valid) {
          console.warn(
            `[AnalyzeShorts] Filtered out segment "${s.title}": start=${s.start_time}, end=${s.end_time}, duration=${duration}, videoDuration=${videoDuration}`
          );
        }
        return valid;
      })
      .map((s) => ({
        ...s,
        start_time: Math.max(0, s.start_time),
        end_time: Math.min(s.end_time, videoDuration),
      }))
      .sort((a, b) => b.virality_score - a.virality_score);

    console.log(
      `[AnalyzeShorts] Returning ${validSegments.length} valid segments (filtered from ${result.segments.length})`
    );
    return NextResponse.json({ segments: validSegments });
  } catch (error) {
    console.error('Analyze shorts error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze video for shorts' },
      { status: 500 }
    );
  }
}

function stitchTranscript(
  scenes: SceneRow[],
  totalDuration: number | null
): string | null {
  let offset = 0;
  const lines: string[] = [];
  let hasAnyContent = false;

  for (const scene of scenes) {
    const transcription =
      scene.voiceover_transcription as VoiceoverTranscription | null;
    const sceneDuration = scene.video_duration || scene.audio_duration || 0;

    if (transcription?.words && transcription.words.length > 0) {
      // Word-level timestamps available — build sentence-like chunks
      hasAnyContent = true;
      let currentSentence: string[] = [];
      let sentenceStart = offset + transcription.words[0].start;

      for (const word of transcription.words) {
        currentSentence.push(word.word);
        const absoluteEnd = offset + word.end;

        // Split on sentence-ending punctuation or every ~15 words
        const endsWithPunctuation = /[.!?]$/.test(word.word);
        if (endsWithPunctuation || currentSentence.length >= 15) {
          lines.push(
            `[${sentenceStart.toFixed(2)}-${absoluteEnd.toFixed(2)}] "${currentSentence.join(' ')}"`
          );
          currentSentence = [];
          // Next sentence starts after this word
          sentenceStart = absoluteEnd;
        }
      }

      // Flush remaining words
      if (currentSentence.length > 0) {
        const lastWord = transcription.words[transcription.words.length - 1];
        lines.push(
          `[${sentenceStart.toFixed(2)}-${(offset + lastWord.end).toFixed(2)}] "${currentSentence.join(' ')}"`
        );
      }
    } else if (scene.audio_text) {
      // Fallback: scene-level text with duration boundaries
      hasAnyContent = true;
      lines.push(
        `[${offset.toFixed(2)}-${(offset + sceneDuration).toFixed(2)}] "${scene.audio_text}"`
      );
    }

    offset += sceneDuration;
  }

  return hasAnyContent ? lines.join('\n') : null;
}
