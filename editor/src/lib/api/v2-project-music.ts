import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { generateMusic } from '@/lib/suno';
import { createServiceClient } from '@/lib/supabase/admin';
import {
  isWebhookBasePubliclyReachable,
  LOCAL_WEBHOOK_BASE_ERROR,
  resolveWebhookBaseUrl,
} from '@/lib/webhook-base-url';
import {
  MusicSPSchema,
  EXPECTED_MUSIC_SP,
  validateStructuredPrompt,
  type MusicSP,
} from '@/lib/api/structured-prompt-schemas';

type MusicType = 'lyrical' | 'instrumental';

const MUSIC_SELECT =
  'id, project_id, video_id, title, structured_prompt, audio_url, cover_image_url, duration, status, task_id, generation_metadata, sort_order, created_at, updated_at';

type MusicRow = {
  id: string;
  project_id: string;
  video_id: string | null;
  title: string | null;
  structured_prompt: unknown;
  audio_url: string | null;
  cover_image_url: string | null;
  duration: number | null;
  status: string;
  task_id: string | null;
  generation_metadata: unknown;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/** Read stored structured_prompt leniently — supports new typed shape AND
 * legacy `{ prompt, extras }` rows. Returns a partial MusicSP-ish object. */
function readMusicSPLenient(value: unknown): {
  is_instrumental: boolean | null;
  genre: string;
  mood: string;
  instrumentation: string;
  tempo_bpm: number | null;
  lyrics: string | null;
  // legacy-derived (for UI backward compat until it moves off)
  legacyPrompt: string;
  legacyExtras: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      is_instrumental: null,
      genre: '',
      mood: '',
      instrumentation: '',
      tempo_bpm: null,
      lyrics: null,
      legacyPrompt: '',
      legacyExtras: '',
    };
  }
  const sp = value as Record<string, unknown>;
  const isInstrumentalTyped =
    typeof sp.is_instrumental === 'boolean' ? sp.is_instrumental : null;
  const legacyPrompt = typeof sp.prompt === 'string' ? sp.prompt : '';
  const legacyExtras = typeof sp.extras === 'string' ? sp.extras : '';
  return {
    is_instrumental:
      isInstrumentalTyped ??
      (legacyPrompt || legacyExtras ? legacyPrompt.trim() === '' : null),
    genre: typeof sp.genre === 'string' ? sp.genre : '',
    mood: typeof sp.mood === 'string' ? sp.mood : '',
    instrumentation:
      typeof sp.instrumentation === 'string' ? sp.instrumentation : '',
    tempo_bpm:
      typeof sp.tempo_bpm === 'number' && Number.isFinite(sp.tempo_bpm)
        ? sp.tempo_bpm
        : null,
    lyrics: typeof sp.lyrics === 'string' ? sp.lyrics : null,
    legacyPrompt,
    legacyExtras,
  };
}

/** Compose Suno inputs from a typed MusicSP. */
function composeMusicForSuno(sp: MusicSP): {
  prompt: string;
  style: string;
  instrumental: boolean;
} {
  const tempoSuffix = sp.tempo_bpm ? ` ${sp.tempo_bpm} BPM.` : '';
  const style = `${sp.genre}, ${sp.mood}. Instruments: ${sp.instrumentation}.${tempoSuffix}`;
  return {
    prompt: sp.is_instrumental ? '' : sp.lyrics,
    style,
    instrumental: sp.is_instrumental,
  };
}

/**
 * Resolve Suno generation params from a stored structured_prompt.
 * Handles both the new typed MusicSP shape and legacy `{ prompt, extras }` rows.
 * Returns null if neither shape has enough info to generate.
 */
export function resolveMusicGenerationParams(raw: unknown): {
  prompt: string;
  style: string;
  instrumental: boolean;
} | null {
  const parsed = MusicSPSchema.safeParse(raw);
  if (parsed.success) return composeMusicForSuno(parsed.data);

  const lenient = readMusicSPLenient(raw);
  if (!lenient.legacyExtras && !lenient.legacyPrompt) return null;
  return {
    prompt: lenient.legacyPrompt,
    style: lenient.legacyExtras,
    instrumental: !lenient.legacyPrompt.trim(),
  };
}

export function toApiMusic(row: MusicRow) {
  const lenient = readMusicSPLenient(row.structured_prompt);
  const isInstrumental = lenient.is_instrumental ?? true;
  // Legacy-compat display fields (will be removed once UI moves to typed fields)
  const legacyStyle =
    lenient.genre || lenient.mood || lenient.instrumentation
      ? [
          lenient.genre,
          lenient.mood,
          lenient.instrumentation && `Instruments: ${lenient.instrumentation}`,
        ]
          .filter(Boolean)
          .join(', ')
      : lenient.legacyExtras;
  return {
    id: row.id,
    project_id: row.project_id,
    video_id: row.video_id,
    name: row.title ?? '',
    title: row.title,
    music_type: (isInstrumental ? 'instrumental' : 'lyrical') as MusicType,
    // Typed fields (new)
    is_instrumental: isInstrumental,
    genre: lenient.genre || null,
    mood: lenient.mood || null,
    instrumentation: lenient.instrumentation || null,
    tempo_bpm: lenient.tempo_bpm,
    lyrics: lenient.lyrics,
    // Legacy-derived display fields
    prompt: lenient.lyrics || lenient.legacyPrompt || null,
    style: legacyStyle || null,
    structured_prompt: row.structured_prompt,
    audio_url: row.audio_url,
    cover_image_url: row.cover_image_url,
    duration: row.duration,
    status: row.status,
    task_id: row.task_id,
    generation_metadata: row.generation_metadata,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

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

function _normalizeOptionalText(value: unknown): string | null {
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
      .from('musics')
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

    return NextResponse.json(((data ?? []) as MusicRow[]).map(toApiMusic));
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
      .from('musics')
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

    return NextResponse.json(((data ?? []) as MusicRow[]).map(toApiMusic));
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

    const title = normalizeText(body.title);
    if (!title.ok) {
      return NextResponse.json(
        { error: 'title must be a non-empty string' },
        { status: 400 }
      );
    }

    // Validate typed structured_prompt (discriminated union on is_instrumental).
    const { title: _t, ...sp } = body as Record<string, unknown>;
    const validation = validateStructuredPrompt(
      MusicSPSchema,
      sp,
      EXPECTED_MUSIC_SP,
      'structured_prompt'
    );
    if (!validation.ok) return validation.response;
    const musicSP = validation.value as MusicSP;
    const composed = composeMusicForSuno(musicSP);

    const db = createServiceClient('studio');
    const owned = await getOwnedProject(db, projectId, user.id);
    if (owned.error) return owned.error;

    const { data: maxRow } = await db
      .from('musics')
      .select('sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSort =
      typeof maxRow?.sort_order === 'number' ? maxRow.sort_order + 1 : 0;

    const { data: inserted, error: insertError } = await db
      .from('musics')
      .insert({
        project_id: projectId,
        video_id: videoId ?? null,
        title: title.value,
        structured_prompt: musicSP,
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
        .from('musics')
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

    if (!isWebhookBasePubliclyReachable(webhookBase)) {
      await db
        .from('musics')
        .update({
          status: 'failed',
          generation_metadata: { error: LOCAL_WEBHOOK_BASE_ERROR },
        })
        .eq('id', inserted.id)
        .eq('status', 'generating');

      return NextResponse.json(
        { error: LOCAL_WEBHOOK_BASE_ERROR },
        { status: 500 }
      );
    }

    const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
    webhookUrl.searchParams.set('step', 'GenerateMusic');
    webhookUrl.searchParams.set('music_id', inserted.id as string);

    try {
      const queued = await generateMusic({
        prompt: composed.prompt,
        style: composed.style,
        title: title.value,
        instrumental: composed.instrumental,
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
        .eq('id', inserted.id)
        .select(MUSIC_SELECT)
        .single();

      if (updateError || !updated) {
        throw new Error('Failed to save task_id for music generation');
      }

      return NextResponse.json(toApiMusic(updated as MusicRow), {
        status: 201,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to queue music task';

      await db
        .from('musics')
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
