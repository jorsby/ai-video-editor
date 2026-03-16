import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

type AssetStatus = 'pending' | 'generating' | 'ready' | 'failed';
type VideoStatus =
  | 'none'
  | 'awaiting_approval'
  | 'generating'
  | 'ready'
  | 'failed';
type TtsStatus = 'none' | 'ready' | 'failed';

function resolveAssetStatus(
  items: Array<{
    status: string | null;
    url?: string | null;
    final_url?: string | null;
    request_id?: string | null;
  }>
): AssetStatus {
  if (!items.length) return 'pending';

  const hasFailed = items.some((item) => item.status === 'failed');
  if (hasFailed) return 'failed';

  const allReady = items.every(
    (item) =>
      item.status === 'success' &&
      typeof (item.final_url ?? item.url) === 'string' &&
      Boolean(item.final_url ?? item.url)
  );
  if (allReady) return 'ready';

  const hasGenerating = items.some(
    (item) =>
      item.status === 'processing' ||
      item.status === 'pending' ||
      (!!item.request_id && item.status !== 'success')
  );
  if (hasGenerating) return 'generating';

  return 'pending';
}

function resolveVideoStatus(params: {
  sceneVideoStatus: string | null;
  objectsStatus: AssetStatus;
  backgroundStatus: AssetStatus;
}): VideoStatus {
  if (params.sceneVideoStatus === 'success') return 'ready';
  if (params.sceneVideoStatus === 'failed') return 'failed';
  if (
    params.sceneVideoStatus === 'processing' ||
    params.sceneVideoStatus === 'pending'
  ) {
    return 'generating';
  }

  if (params.objectsStatus === 'ready' && params.backgroundStatus === 'ready') {
    return 'awaiting_approval';
  }

  return 'none';
}

function resolveTtsStatus(
  voiceovers: Array<{ status: string | null; audio_url: string | null }>
): TtsStatus {
  if (!voiceovers.length) return 'none';
  if (voiceovers.some((voiceover) => voiceover.status === 'failed')) {
    return 'failed';
  }

  const allReady = voiceovers.every(
    (voiceover) =>
      voiceover.status === 'success' &&
      typeof voiceover.audio_url === 'string' &&
      voiceover.audio_url.length > 0
  );

  return allReady ? 'ready' : 'none';
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');

    const { data: project, error: projectError } = await db
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const { data: series } = await db
      .from('series')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();

    const { data: storyboards, error: storyboardError } = await db
      .from('storyboards')
      .select('id, title, plan_status, plan, sort_order, created_at')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (storyboardError) {
      return NextResponse.json(
        { error: 'Failed to load storyboards' },
        { status: 500 }
      );
    }

    const resultStoryboards = await Promise.all(
      (storyboards ?? []).map(
        async (storyboard: {
          id: string;
          title: string | null;
          plan_status: string;
          plan: Record<string, unknown> | null;
        }) => {
          const planSceneCount = Array.isArray(storyboard.plan?.scene_prompts)
            ? storyboard.plan?.scene_prompts.length
            : 0;

          const { data: scenes, error: scenesError } = await db
            .from('scenes')
            .select(
              `
              id,
              order,
              video_status,
              objects (status, url, final_url, request_id),
              backgrounds (status, url, final_url, request_id),
              voiceovers (status, audio_url)
            `
            )
            .eq('storyboard_id', storyboard.id)
            .order('order', { ascending: true });

          if (scenesError) {
            throw new Error(
              `Failed to load scenes for storyboard ${storyboard.id}`
            );
          }

          const mappedScenes = (scenes ?? []).map(
            (scene: {
              order: number;
              video_status: string | null;
              objects: Array<{
                status: string | null;
                url: string | null;
                final_url: string | null;
                request_id: string | null;
              }>;
              backgrounds: Array<{
                status: string | null;
                url: string | null;
                final_url: string | null;
                request_id: string | null;
              }>;
              voiceovers: Array<{
                status: string | null;
                audio_url: string | null;
              }>;
            }) => {
              const objectsStatus = resolveAssetStatus(scene.objects ?? []);
              const backgroundStatus = resolveAssetStatus(
                scene.backgrounds ?? []
              );

              return {
                index: scene.order,
                objects_status: objectsStatus,
                background_status: backgroundStatus,
                video_status: resolveVideoStatus({
                  sceneVideoStatus: scene.video_status,
                  objectsStatus,
                  backgroundStatus,
                }),
                tts_status: resolveTtsStatus(scene.voiceovers ?? []),
              };
            }
          );

          return {
            id: storyboard.id,
            title: storyboard.title,
            status: storyboard.plan_status,
            scene_count: Math.max(planSceneCount, mappedScenes.length),
            scenes: mappedScenes,
          };
        }
      )
    );

    return NextResponse.json({
      project_id: projectId,
      series_id: series?.id ?? null,
      storyboards: resultStoryboards,
    });
  } catch (error) {
    console.error('[v2/project/status] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
