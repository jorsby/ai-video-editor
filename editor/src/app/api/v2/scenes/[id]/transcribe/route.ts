import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import {
  type TranscriptionSummary,
  transcribeUrl,
} from '@/lib/transcribe/transcribe-url';

type RouteContext = { params: Promise<{ id: string }> };

type Source = 'video' | 'voiceover' | 'both';

const VALID_SOURCES = new Set<Source>(['video', 'voiceover', 'both']);

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: sceneId } = await context.params;
    const db = createServiceClient('studio');

    // Parse body
    const body = await req.json().catch(() => ({}));
    const source: Source =
      typeof body.source === 'string' &&
      VALID_SOURCES.has(body.source as Source)
        ? (body.source as Source)
        : 'video';

    // Fetch scene + ownership chain
    const { data: scene, error: sceneError } = await db
      .from('scenes')
      .select('id, chapter_id, video_url, audio_url')
      .eq('id', sceneId)
      .maybeSingle();

    if (sceneError || !scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    const { data: chapter, error: chapterError } = await db
      .from('chapters')
      .select('id, video_id')
      .eq('id', scene.chapter_id)
      .maybeSingle();

    if (chapterError || !chapter) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    const { data: video, error: videoError } = await db
      .from('videos')
      .select('id, project_id, user_id')
      .eq('id', chapter.video_id)
      .maybeSingle();

    if (videoError || !video) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    if (video.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const projectId: string = video.project_id;

    // Determine what to transcribe
    const doVideo = source === 'video' || source === 'both';
    const doVoiceover = source === 'voiceover' || source === 'both';

    if (doVideo && !scene.video_url) {
      if (source === 'video') {
        return NextResponse.json(
          { error: 'Scene has no video_url to transcribe' },
          { status: 400 }
        );
      }
      // source=both, skip video silently
    }

    if (doVoiceover && !scene.audio_url) {
      if (source === 'voiceover') {
        return NextResponse.json(
          { error: 'Scene has no audio_url to transcribe' },
          { status: 400 }
        );
      }
      // source=both, skip voiceover silently
    }

    // Run transcription(s)
    let videoTranscription: TranscriptionSummary | null = null;
    let voiceoverTranscription: TranscriptionSummary | null = null;

    if (doVideo && scene.video_url) {
      videoTranscription = await transcribeUrl(db, scene.video_url, projectId);
    }

    if (doVoiceover && scene.audio_url) {
      voiceoverTranscription = await transcribeUrl(
        db,
        scene.audio_url,
        projectId
      );
    }

    // Build scene update
    const updates: Record<string, unknown> = {};

    if (videoTranscription !== null) {
      updates.video_transcription = videoTranscription;
      updates.has_speech = videoTranscription.words.length > 0;
    }

    if (voiceoverTranscription !== null) {
      updates.voiceover_transcription = voiceoverTranscription;
    }

    if (Object.keys(updates).length > 0) {
      await db.from('scenes').update(updates).eq('id', sceneId);
    }

    return NextResponse.json({
      scene_id: sceneId,
      video_transcription: videoTranscription,
      voiceover_transcription: voiceoverTranscription,
      has_speech: videoTranscription
        ? videoTranscription.words.length > 0
        : null,
    });
  } catch (error) {
    console.error('[v2/scenes/:id/transcribe][POST] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
