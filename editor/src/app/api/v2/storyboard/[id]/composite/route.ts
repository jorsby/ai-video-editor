import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  skip_failed_scenes: z.boolean().optional(),
  output_format: z.string().min(1).optional(),
});

type StoryboardPlan = {
  scene_durations?: number[];
  [key: string]: unknown;
};

type SceneRow = {
  id: string;
  order: number;
  video_url: string | null;
  voiceovers: Array<{
    id: string;
    audio_url: string | null;
    duration: number | null;
    status: string | null;
  }>;
};

type SceneWithMedia = {
  scene_id: string;
  order: number;
  video_url: string | null;
  audio_url: string | null;
  duration: number | null;
  missing_video: boolean;
  missing_audio: boolean;
};

function parseInput(reqBody: unknown) {
  const parsedBody = bodySchema.safeParse(reqBody);
  if (!parsedBody.success) {
    return {
      error: NextResponse.json(
        {
          error: parsedBody.error.issues[0]?.message ?? 'Invalid request body',
        },
        { status: 400 }
      ),
    };
  }

  return {
    data: {
      skipFailedScenes: parsedBody.data.skip_failed_scenes ?? false,
      outputFormat: parsedBody.data.output_format ?? 'mp4',
    },
  };
}

function pickSceneVoiceoverAudio(
  voiceovers: Array<{
    audio_url: string | null;
    duration: number | null;
    status: string | null;
  }>
): { audio_url: string | null; duration: number | null } {
  const successful = voiceovers.find(
    (voiceover) =>
      voiceover.status === 'success' &&
      typeof voiceover.audio_url === 'string' &&
      voiceover.audio_url.length > 0
  );

  if (successful) {
    return {
      audio_url: successful.audio_url,
      duration: successful.duration,
    };
  }

  const withAudio = voiceovers.find(
    (voiceover) =>
      typeof voiceover.audio_url === 'string' && voiceover.audio_url.length > 0
  );

  return {
    audio_url: withAudio?.audio_url ?? null,
    duration: withAudio?.duration ?? null,
  };
}

function resolveSceneDuration(
  sceneOrder: number,
  voiceoverDuration: number | null,
  plan: StoryboardPlan
): number | null {
  if (
    typeof voiceoverDuration === 'number' &&
    Number.isFinite(voiceoverDuration)
  ) {
    return voiceoverDuration;
  }

  if (
    Array.isArray(plan.scene_durations) &&
    typeof plan.scene_durations[sceneOrder] === 'number'
  ) {
    return plan.scene_durations[sceneOrder];
  }

  return null;
}

function buildScenesWithMedia(
  scenes: SceneRow[],
  plan: StoryboardPlan
): SceneWithMedia[] {
  return scenes.map((scene) => {
    const { audio_url, duration } = pickSceneVoiceoverAudio(scene.voiceovers);

    return {
      scene_id: scene.id,
      order: scene.order,
      video_url: scene.video_url,
      audio_url,
      duration: resolveSceneDuration(scene.order, duration, plan),
      missing_video: !scene.video_url,
      missing_audio: !audio_url,
    };
  });
}

function buildTimeline(
  scenes: SceneWithMedia[],
  outputFormat: string
): {
  clips: Array<{
    scene_id: string;
    video_url: string | null;
    audio_url: string | null;
    duration: number | null;
    order: number;
  }>;
  output_format: string;
} {
  return {
    clips: scenes.map((scene) => ({
      scene_id: scene.scene_id,
      video_url: scene.video_url,
      audio_url: scene.audio_url,
      duration: scene.duration,
      order: scene.order,
    })),
    output_format: outputFormat,
  };
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: storyboardId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const input = parseInput(await req.json().catch(() => ({})));
    if ('error' in input) {
      return input.error;
    }

    const db = createServiceClient('studio');

    const { data: storyboard, error: storyboardError } = await db
      .from('storyboards')
      .select('id, project_id, plan')
      .eq('id', storyboardId)
      .single();

    if (storyboardError || !storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    const { data: project, error: projectError } = await db
      .from('projects')
      .select('id')
      .eq('id', storyboard.project_id)
      .eq('user_id', user.id)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { data: scenesData, error: scenesError } = await db
      .from('scenes')
      .select(
        'id, order, video_url, voiceovers (id, audio_url, duration, status)'
      )
      .eq('storyboard_id', storyboardId)
      .order('order', { ascending: true });

    if (scenesError) {
      return NextResponse.json(
        { error: 'Failed to load scenes' },
        { status: 500 }
      );
    }

    const scenes = (scenesData ?? []) as SceneRow[];
    const plan = ((storyboard.plan as StoryboardPlan | null) ??
      {}) as StoryboardPlan;
    const scenesWithMedia = buildScenesWithMedia(scenes, plan);

    const missingScenes = scenesWithMedia.filter(
      (scene) => scene.missing_video || scene.missing_audio
    );

    if (!input.data.skipFailedScenes && missingScenes.length > 0) {
      return NextResponse.json(
        {
          error:
            'Cannot composite: one or more scenes are missing video or voiceover audio',
          missing_scenes: missingScenes,
        },
        { status: 400 }
      );
    }

    const completeScenes = scenesWithMedia.filter(
      (scene) => !scene.missing_video && !scene.missing_audio
    );

    const timelineSource = input.data.skipFailedScenes
      ? completeScenes
      : scenesWithMedia;

    const timeline = buildTimeline(timelineSource, input.data.outputFormat);

    const updatedPlan: StoryboardPlan = {
      ...plan,
      composite: {
        timeline,
        output_format: input.data.outputFormat,
        updated_at: new Date().toISOString(),
      },
    };

    const { error: updateError } = await db
      .from('storyboards')
      .update({
        plan_status: 'ready_to_composite',
        plan: updatedPlan,
      })
      .eq('id', storyboardId);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to persist composite timeline' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: 'ready_to_composite',
      timeline,
      complete_scenes: completeScenes,
      missing_scenes: missingScenes,
    });
  } catch (error) {
    console.error('[v2/storyboard/composite] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
