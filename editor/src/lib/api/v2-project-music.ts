import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { generateMusic } from '@/lib/suno';
import { createServiceClient } from '@/lib/supabase/admin';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type MusicType = 'lyrical' | 'instrumental';

const MUSIC_TYPES = new Set<MusicType>(['lyrical', 'instrumental']);
const MUSIC_SELECT =
  'id, project_id, video_id, name, music_type, prompt, style, title, audio_url, cover_image_url, duration, status, task_id, generation_metadata, sort_order, created_at, updated_at';

type OwnedProjectLookup =
  | {
      project: {
        id: string;
        user_id: string;
      };
      error?: undefined;
    }
  | {
      project?: undefined;
      error: NextResponse;
    };

type ProjectResolution =
  | {
      projectId: string;
      videoId: string;
      error?: undefined;
    }
  | {
      projectId?: undefined;
      videoId?: undefined;
      error: NextResponse;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(
  value: unknown
): { ok: true; value: string } | { ok: false } {
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false };
  return { ok: true, value: trimmed };
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function getOwnedProject(
  db: ReturnType<typeof createServiceClient>,
  projectId: string,
  userId: string
): Promise<OwnedProjectLookup> {
  const { data: project, error } = await db
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .maybeSingle();

  if (error || !project) {
    return {
      error: NextResponse.json({ error: 'Project not found' }, { status: 404 }),
    };
  }

  if (project.user_id !== userId) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  return { project };
}

export async function resolveProjectIdFromVideo(
  db: ReturnType<typeof createServiceClient>,
  videoId: string
): Promise<ProjectResolution> {
  const { data: video, error } = await db
    .from('videos')
    .select('project_id')
    .eq('id', videoId)
    .maybeSingle();

  if (error || !video || typeof video.project_id !== 'string') {
    return {
      error: NextResponse.json({ error: 'Video not found' }, { status: 404 }),
    };
  }

  return { projectId: video.project_id, videoId };
}

export async function listProjectMusic(
  req: NextRequest,
  projectId: string,
  logPrefix: string
) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedProject(db, projectId, user.id);
    if (owned.error) return owned.error;

    const { data, error } = await db
      .from('project_music')
      .select(MUSIC_SELECT)
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error(`${logPrefix} Failed to list tracks:`, error);
      return NextResponse.json(
        { error: 'Failed to list music tracks' },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function listVideoMusic(
  req: NextRequest,
  videoId: string,
  projectId: string,
  logPrefix: string
) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedProject(db, projectId, user.id);
    if (owned.error) return owned.error;

    const { data, error } = await db
      .from('project_music')
      .select(MUSIC_SELECT)
      .eq('project_id', projectId)
      .eq('video_id', videoId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error(`${logPrefix} Failed to list tracks:`, error);
      return NextResponse.json(
        { error: 'Failed to list music tracks' },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error(`${logPrefix} Unexpected error:`, error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: request validation and queue flow
export async function createProjectMusic(
  req: NextRequest,
  projectId: string,
  logPrefix: string,
  videoId?: string | null
) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json(
        { error: 'Body must be a JSON object' },
        { status: 400 }
      );
    }

    const name = normalizeText(body.name);
    if (!name.ok) {
      return NextResponse.json(
        { error: 'name must be a non-empty string' },
        { status: 400 }
      );
    }

    const musicTypeRaw =
      typeof body.music_type === 'string' ? body.music_type.trim() : '';
    if (!MUSIC_TYPES.has(musicTypeRaw as MusicType)) {
      return NextResponse.json(
        { error: "music_type must be either 'lyrical' or 'instrumental'" },
        { status: 400 }
      );
    }

    const musicType = musicTypeRaw as MusicType;

    const style = normalizeText(body.style);
    if (!style.ok) {
      return NextResponse.json(
        { error: 'style must be a non-empty string' },
        { status: 400 }
      );
    }

    const title = normalizeText(body.title);
    if (!title.ok) {
      return NextResponse.json(
        { error: 'title must be a non-empty string' },
        { status: 400 }
      );
    }

    if (
      body.prompt !== undefined &&
      body.prompt !== null &&
      typeof body.prompt !== 'string'
    ) {
      return NextResponse.json(
        { error: 'prompt must be a string or null' },
        { status: 400 }
      );
    }

    const prompt = normalizeOptionalText(body.prompt);
    if (musicType === 'lyrical' && !prompt) {
      return NextResponse.json(
        {
          error:
            'prompt is required for lyrical tracks and must be a non-empty string',
        },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');
    const owned = await getOwnedProject(db, projectId, user.id);
    if (owned.error) return owned.error;

    const { data: maxRow } = await db
      .from('project_music')
      .select('sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSort =
      typeof maxRow?.sort_order === 'number' ? maxRow.sort_order + 1 : 0;

    const { data: inserted, error: insertError } = await db
      .from('project_music')
      .insert({
        project_id: projectId,
        video_id: videoId ?? null,
        name: name.value,
        music_type: musicType,
        prompt,
        style: style.value,
        title: title.value,
        status: 'generating',
        sort_order: nextSort,
      })
      .select(MUSIC_SELECT)
      .single();

    if (insertError || !inserted) {
      console.error(`${logPrefix} Failed to create track:`, insertError);
      return NextResponse.json(
        { error: 'Failed to create music track' },
        { status: 500 }
      );
    }

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      await db
        .from('project_music')
        .update({
          status: 'failed',
          generation_metadata: {
            error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL',
          },
        })
        .eq('id', inserted.id)
        .eq('status', 'generating');

      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
    webhookUrl.searchParams.set('step', 'GenerateMusic');
    webhookUrl.searchParams.set('music_id', inserted.id as string);

    try {
      const queued = await generateMusic({
        prompt: musicType === 'instrumental' ? '' : (prompt ?? ''),
        style: style.value,
        title: title.value,
        instrumental: musicType === 'instrumental',
        callbackUrl: webhookUrl.toString(),
      });

      const { data: updated, error: updateError } = await db
        .from('project_music')
        .update({
          task_id: queued.taskId,
          generation_metadata: {
            provider: 'kie',
            submit_response: queued.response,
          },
        })
        .eq('id', inserted.id)
        .select(MUSIC_SELECT)
        .single();

      if (updateError || !updated) {
        throw new Error('Failed to save task_id for music generation');
      }

      return NextResponse.json(updated, { status: 201 });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to queue music task';

      await db
        .from('project_music')
        .update({
          status: 'failed',
          generation_metadata: {
            error: message,
          },
        })
        .eq('id', inserted.id)
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
