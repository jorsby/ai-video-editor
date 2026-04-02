import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { generateMusic } from '@/lib/suno';
import { createServiceClient } from '@/lib/supabase/admin';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };
type MusicType = 'lyrical' | 'instrumental';

const MUSIC_TYPES = new Set<MusicType>(['lyrical', 'instrumental']);
const MUSIC_SELECT =
  'id, series_id, name, music_type, prompt, style, title, audio_url, cover_image_url, duration, status, task_id, suno_track_id, generation_metadata, sort_order, created_at, updated_at';

type OwnedSeriesLookup =
  | {
      series: {
        id: string;
        user_id: string;
      };
      error?: undefined;
    }
  | {
      series?: undefined;
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

async function getOwnedSeries(
  db: ReturnType<typeof createServiceClient>,
  seriesId: string,
  userId: string
): Promise<OwnedSeriesLookup> {
  const { data: series, error } = await db
    .from('series')
    .select('id, user_id')
    .eq('id', seriesId)
    .maybeSingle();

  if (error || !series) {
    return {
      error: NextResponse.json({ error: 'Series not found' }, { status: 404 }),
    };
  }

  if (series.user_id !== userId) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  return { series };
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: seriesId } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedSeries(db, seriesId, user.id);
    if (owned.error) return owned.error;

    const { data, error } = await db
      .from('series_music')
      .select(MUSIC_SELECT)
      .eq('series_id', seriesId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[v2/series/:id/music][GET] Failed to list tracks:', error);
      return NextResponse.json(
        { error: 'Failed to list music tracks' },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error('[v2/series/:id/music][GET] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: request validation and queue flow
export async function POST(req: NextRequest, context: RouteContext) {
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

    const { id: seriesId } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedSeries(db, seriesId, user.id);
    if (owned.error) return owned.error;

    const { data: maxRow } = await db
      .from('series_music')
      .select('sort_order')
      .eq('series_id', seriesId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSort =
      typeof maxRow?.sort_order === 'number' ? maxRow.sort_order + 1 : 0;

    const { data: inserted, error: insertError } = await db
      .from('series_music')
      .insert({
        series_id: seriesId,
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
      console.error(
        '[v2/series/:id/music][POST] Failed to create track:',
        insertError
      );
      return NextResponse.json(
        { error: 'Failed to create music track' },
        { status: 500 }
      );
    }

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      await db
        .from('series_music')
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
        .from('series_music')
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
        .from('series_music')
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
    console.error('[v2/series/:id/music][POST] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
