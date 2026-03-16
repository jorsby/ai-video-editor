/**
 * GET /api/v2/project/{id}/status
 *
 * Returns the full pipeline status for a project so the agent can know
 * what needs attention.
 *
 * Response:
 * {
 *   project_id: string,
 *   series_id: string | null,
 *   storyboards: Array<{
 *     id: string,
 *     title: string | null,
 *     status: string,       // plan_status value
 *     scenes: Array<{
 *       index: number,
 *       objects_status: "pending" | "generating" | "ready" | "failed",
 *       background_status: "pending" | "generating" | "ready" | "failed",
 *       video_status: "none" | "awaiting_approval" | "generating" | "ready" | "failed",
 *       tts_status: "none" | "pending" | "generating" | "ready" | "failed"
 *     }>
 *   }>
 * }
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

type PipelineStatus = 'pending' | 'generating' | 'ready' | 'failed';
type VideoStatus =
  | 'none'
  | 'awaiting_approval'
  | 'generating'
  | 'ready'
  | 'failed';
type TtsStatus = 'none' | 'pending' | 'generating' | 'ready' | 'failed';

function mapObjectStatus(
  objects: Array<{ status: string; final_url: string | null }>
): PipelineStatus {
  if (objects.length === 0) return 'pending';
  if (objects.every((o) => o.status === 'success' && o.final_url))
    return 'ready';
  if (objects.some((o) => o.status === 'failed')) return 'failed';
  if (objects.some((o) => o.status === 'processing' || o.status === 'pending'))
    return 'generating';
  return 'pending';
}

function mapBgStatus(
  backgrounds: Array<{ status: string; final_url: string | null }>
): PipelineStatus {
  if (backgrounds.length === 0) return 'pending';
  if (backgrounds.every((b) => b.status === 'success' && b.final_url))
    return 'ready';
  if (backgrounds.some((b) => b.status === 'failed')) return 'failed';
  if (
    backgrounds.some((b) => b.status === 'processing' || b.status === 'pending')
  )
    return 'generating';
  return 'pending';
}

function mapVideoStatus(
  sceneVideoStatus: string | null,
  objectsReady: boolean,
  backgroundReady: boolean
): VideoStatus {
  if (!sceneVideoStatus) {
    // If assets are ready the video is awaiting approval (user/agent needs to trigger)
    if (objectsReady && backgroundReady) return 'awaiting_approval';
    return 'none';
  }
  if (sceneVideoStatus === 'success') return 'ready';
  if (sceneVideoStatus === 'failed') return 'failed';
  if (sceneVideoStatus === 'processing' || sceneVideoStatus === 'pending')
    return 'generating';
  return 'none';
}

function mapTtsStatus(
  voiceovers: Array<{ status: string; audio_url?: string | null }>
): TtsStatus {
  if (voiceovers.length === 0) return 'none';
  if (voiceovers.every((v) => v.status === 'success' && v.audio_url))
    return 'ready';
  if (voiceovers.some((v) => v.status === 'failed')) return 'failed';
  if (
    voiceovers.some((v) => v.status === 'processing' || v.status === 'pending')
  )
    return 'generating';
  // voiceovers exist but no audio yet → pending TTS generation
  if (voiceovers.every((v) => !v.audio_url)) return 'pending';
  return 'none';
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');

    // Verify project ownership
    const { data: project, error: projectError } = await db
      .from('projects')
      .select('id, settings')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Resolve series_id (from project settings or via series.project_id)
    let seriesId: string | null = null;
    const settings = project.settings as Record<string, unknown> | null;
    if (settings?.series_id && typeof settings.series_id === 'string') {
      seriesId = settings.series_id;
    } else {
      const { data: seriesRow } = await db
        .from('series')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .maybeSingle();
      seriesId = seriesRow?.id ?? null;
    }

    // Fetch all storyboards for this project
    const { data: storyboards, error: sbError } = await db
      .from('storyboards')
      .select('id, title, plan_status, sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (sbError) {
      console.error(
        '[v2/project/status] Failed to fetch storyboards:',
        sbError
      );
      return NextResponse.json(
        { error: 'Failed to fetch storyboards' },
        { status: 500 }
      );
    }

    const storyboardResults = await Promise.all(
      (storyboards ?? []).map(
        async (sb: {
          id: string;
          title: string | null;
          plan_status: string;
          sort_order: number;
        }) => {
          // Fetch scenes with their objects, backgrounds, voiceovers
          const { data: scenes } = await db
            .from('scenes')
            .select(
              `
              id,
              order,
              video_status,
              objects (id, status, final_url),
              backgrounds (id, status, final_url),
              voiceovers (id, status, audio_url)
            `
            )
            .eq('storyboard_id', sb.id)
            .order('order', { ascending: true });

          const sceneSummaries = (scenes ?? []).map(
            (scene: {
              id: string;
              order: number;
              video_status: string | null;
              objects: Array<{ status: string; final_url: string | null }>;
              backgrounds: Array<{ status: string; final_url: string | null }>;
              voiceovers: Array<{ status: string; audio_url?: string | null }>;
            }) => {
              const objStatus = mapObjectStatus(scene.objects ?? []);
              const bgStatus = mapBgStatus(scene.backgrounds ?? []);
              const videoStatus = mapVideoStatus(
                scene.video_status,
                objStatus === 'ready',
                bgStatus === 'ready'
              );
              const ttsStatus = mapTtsStatus(scene.voiceovers ?? []);

              return {
                index: scene.order,
                objects_status: objStatus,
                background_status: bgStatus,
                video_status: videoStatus,
                tts_status: ttsStatus,
              };
            }
          );

          return {
            id: sb.id,
            title: sb.title,
            status: sb.plan_status,
            scenes: sceneSummaries,
          };
        }
      )
    );

    return NextResponse.json({
      project_id: projectId,
      series_id: seriesId,
      storyboards: storyboardResults,
    });
  } catch (error) {
    console.error('[v2/project/status] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
