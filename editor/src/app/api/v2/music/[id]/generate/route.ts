import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { generateMusic } from '@/lib/suno';
import {
  isWebhookBasePubliclyReachable,
  LOCAL_WEBHOOK_BASE_ERROR,
  resolveWebhookBaseUrl,
} from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const MUSIC_SELECT =
  'id, project_id, video_id, title, structured_prompt, audio_url, cover_image_url, duration, status, task_id, generation_metadata, sort_order, created_at, updated_at';

/**
 * POST /api/v2/music/{id}/generate
 *
 * Regenerates music for an existing track using its current structured_prompt.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const logPrefix = '[v2/music/:id/generate]';

  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: musicId } = await context.params;
    const db = createServiceClient('studio');

    // Look up the music track
    const { data: music, error: musicError } = await db
      .from('musics')
      .select(MUSIC_SELECT)
      .eq('id', musicId)
      .maybeSingle();

    if (musicError || !music) {
      return NextResponse.json(
        { error: 'Music track not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    const { data: project, error: projectError } = await db
      .from('projects')
      .select('id, user_id')
      .eq('id', music.project_id)
      .maybeSingle();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Don't regenerate if already generating
    if (music.status === 'generating') {
      return NextResponse.json(
        { error: 'Track is already generating' },
        { status: 409 }
      );
    }

    // Derive generation params from structured_prompt
    const sp =
      music.structured_prompt &&
      typeof music.structured_prompt === 'object' &&
      !Array.isArray(music.structured_prompt)
        ? (music.structured_prompt as Record<string, unknown>)
        : {};

    const genPrompt = typeof sp.prompt === 'string' ? sp.prompt : '';
    const genStyle = typeof sp.extras === 'string' ? sp.extras : '';
    const isInstrumental = !genPrompt;

    // Mark as generating, clear previous results
    await db
      .from('musics')
      .update({
        status: 'generating',
        audio_url: null,
        cover_image_url: null,
        duration: null,
        task_id: null,
        generation_metadata: null,
      })
      .eq('id', musicId);

    // Build webhook URL
    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      await db
        .from('musics')
        .update({
          status: 'failed',
          generation_metadata: {
            error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL',
          },
        })
        .eq('id', musicId)
        .eq('status', 'generating');

      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    if (!isWebhookBasePubliclyReachable(webhookBase)) {
      await db
        .from('musics')
        .update({
          status: 'failed',
          generation_metadata: { error: LOCAL_WEBHOOK_BASE_ERROR },
        })
        .eq('id', musicId)
        .eq('status', 'generating');

      return NextResponse.json(
        { error: LOCAL_WEBHOOK_BASE_ERROR },
        { status: 500 }
      );
    }

    const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
    webhookUrl.searchParams.set('step', 'GenerateMusic');
    webhookUrl.searchParams.set('music_id', musicId);

    try {
      const queued = await generateMusic({
        prompt: isInstrumental ? '' : genPrompt,
        style: genStyle,
        title: music.title as string,
        instrumental: isInstrumental,
        callbackUrl: webhookUrl.toString(),
      });

      const { data: updated, error: updateError } = await db
        .from('musics')
        .update({
          task_id: queued.taskId,
          generation_metadata: {
            provider: 'kie',
            submit_response: queued.response,
          },
        })
        .eq('id', musicId)
        .select(MUSIC_SELECT)
        .single();

      if (updateError || !updated) {
        throw new Error('Failed to save task_id for music generation');
      }

      return NextResponse.json(updated);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to queue music task';

      await db
        .from('musics')
        .update({
          status: 'failed',
          generation_metadata: { error: message },
        })
        .eq('id', musicId)
        .eq('status', 'generating');

      return NextResponse.json(
        { error: 'Failed to generate music', details: message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
