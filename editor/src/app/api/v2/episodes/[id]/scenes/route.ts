import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

type SceneStatus = 'draft' | 'ready' | 'in_progress' | 'done' | 'failed';
type ContentMode = 'narrative' | 'cinematic' | 'hybrid';

type SceneInsert = Record<string, unknown> & {
  episode_id: string;
  order: number;
};

const SCENE_SELECT =
  'id, episode_id, order, title, content_mode, visual_direction, prompt, location_variant_slug, character_variant_slugs, prop_variant_slugs, audio_text, audio_url, audio_duration, video_url, video_duration, status, created_at, updated_at';

const SCENE_STATUSES = new Set<SceneStatus>([
  'draft',
  'ready',
  'in_progress',
  'done',
  'failed',
]);

const CONTENT_MODES = new Set<ContentMode>([
  'narrative',
  'cinematic',
  'hybrid',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toNullableString(
  value: unknown,
  fieldName: string
): { value?: string | null; error?: string } {
  if (value === undefined) return {};
  if (value === null) return { value: null };

  if (typeof value !== 'string') {
    return { error: `${fieldName} must be a string or null` };
  }

  const trimmed = value.trim();
  return { value: trimmed.length > 0 ? trimmed : null };
}

function toPositiveInteger(
  value: unknown,
  fieldName: string
): { value?: number; error?: string } {
  if (value === undefined) return {};

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return { error: `${fieldName} must be a positive integer` };
  }

  return { value };
}

function toNullableFloat(
  value: unknown,
  fieldName: string
): { value?: number | null; error?: string } {
  if (value === undefined) return {};
  if (value === null) return { value: null };
  if (typeof value !== 'number' || value <= 0) {
    return { error: `${fieldName} must be a positive number or null` };
  }
  return { value };
}

function toSlugArray(
  value: unknown,
  fieldName: string
): { value?: string[]; error?: string } {
  if (value === undefined) return {};
  if (value === null) return { value: [] };
  if (!Array.isArray(value)) {
    return { error: `${fieldName} must be an array of non-empty strings` };
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== 'string') {
      return { error: `${fieldName} must be an array of non-empty strings` };
    }

    const trimmed = item.trim();
    if (!trimmed) {
      return { error: `${fieldName} must be an array of non-empty strings` };
    }

    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }

  return { value: normalized };
}

async function getOwnedEpisode(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  id: string
): Promise<
  | { episode: { id: string; series_id: string }; error?: undefined }
  | { episode?: undefined; error: NextResponse }
> {
  const { data: episode, error: episodeError } = await db
    .from('episodes')
    .select('id, series_id')
    .eq('id', id)
    .maybeSingle();

  if (episodeError || !episode) {
    return {
      error: NextResponse.json({ error: 'Episode not found' }, { status: 404 }),
    };
  }

  const { data: series, error: seriesError } = await db
    .from('series')
    .select('id')
    .eq('id', episode.series_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (seriesError || !series) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
    };
  }

  return {
    episode: {
      id: episode.id as string,
      series_id: episode.series_id as string,
    },
  };
}

function parseSceneCreateInput(
  input: unknown,
  index: number,
  id: string
): { scene?: SceneInsert; explicitOrder?: number; error?: string } {
  if (!isRecord(input)) {
    return { error: `scenes[${index}] must be an object` };
  }

  const scene: SceneInsert = {
    episode_id: id,
    order: 0,
  };

  const order = toPositiveInteger(input.order, 'order');
  if (order.error) return { error: `scenes[${index}].${order.error}` };

  // audio_duration / video_duration are the SSOT — set at webhook probe time.
  const audioDuration = toNullableFloat(input.audio_duration, 'audio_duration');
  if (audioDuration.error)
    return { error: `scenes[${index}].${audioDuration.error}` };
  if (audioDuration.value !== undefined)
    scene.audio_duration = audioDuration.value;

  const videoDuration = toNullableFloat(input.video_duration, 'video_duration');
  if (videoDuration.error)
    return { error: `scenes[${index}].${videoDuration.error}` };
  if (videoDuration.value !== undefined)
    scene.video_duration = videoDuration.value;

  if (input.content_mode !== undefined) {
    if (input.content_mode === null) {
      scene.content_mode = null;
    } else if (
      typeof input.content_mode === 'string' &&
      CONTENT_MODES.has(input.content_mode as ContentMode)
    ) {
      scene.content_mode = input.content_mode as ContentMode;
    } else {
      return {
        error: `scenes[${index}].content_mode must be one of: narrative, cinematic, hybrid`,
      };
    }
  }

  if (input.status !== undefined) {
    if (
      typeof input.status !== 'string' ||
      !SCENE_STATUSES.has(input.status as SceneStatus)
    ) {
      return {
        error: `scenes[${index}].status must be one of: draft, ready, in_progress, done, failed`,
      };
    }
    scene.status = input.status as SceneStatus;
  }

  const title = toNullableString(input.title, 'title');
  if (title.error) return { error: `scenes[${index}].${title.error}` };
  if (title.value !== undefined) scene.title = title.value;

  const visualDirection = toNullableString(
    input.visual_direction,
    'visual_direction'
  );
  if (visualDirection.error) {
    return { error: `scenes[${index}].${visualDirection.error}` };
  }
  if (visualDirection.value !== undefined) {
    scene.visual_direction = visualDirection.value;
  }

  const prompt = toNullableString(input.prompt, 'prompt');
  if (prompt.error) return { error: `scenes[${index}].${prompt.error}` };
  if (prompt.value !== undefined) scene.prompt = prompt.value;

  const locationVariantSlug = toNullableString(
    input.location_variant_slug,
    'location_variant_slug'
  );
  if (locationVariantSlug.error) {
    return { error: `scenes[${index}].${locationVariantSlug.error}` };
  }
  if (locationVariantSlug.value !== undefined) {
    scene.location_variant_slug = locationVariantSlug.value;
  }

  const characterVariantSlugs = toSlugArray(
    input.character_variant_slugs,
    'character_variant_slugs'
  );
  if (characterVariantSlugs.error) {
    return { error: `scenes[${index}].${characterVariantSlugs.error}` };
  }
  if (characterVariantSlugs.value !== undefined) {
    scene.character_variant_slugs = characterVariantSlugs.value;
  }

  const propVariantSlugs = toSlugArray(
    input.prop_variant_slugs,
    'prop_variant_slugs'
  );
  if (propVariantSlugs.error) {
    return { error: `scenes[${index}].${propVariantSlugs.error}` };
  }
  if (propVariantSlugs.value !== undefined) {
    scene.prop_variant_slugs = propVariantSlugs.value;
  }

  const audioText = toNullableString(input.audio_text, 'audio_text');
  if (audioText.error) return { error: `scenes[${index}].${audioText.error}` };
  if (audioText.value !== undefined) scene.audio_text = audioText.value;

  const audioUrl = toNullableString(input.audio_url, 'audio_url');
  if (audioUrl.error) return { error: `scenes[${index}].${audioUrl.error}` };
  if (audioUrl.value !== undefined) scene.audio_url = audioUrl.value;

  const videoUrl = toNullableString(input.video_url, 'video_url');
  if (videoUrl.error) return { error: `scenes[${index}].${videoUrl.error}` };
  if (videoUrl.value !== undefined) scene.video_url = videoUrl.value;

  return {
    scene,
    explicitOrder: order.value,
  };
}

// GET /api/v2/episodes/{id}/scenes
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedEpisode(db, user.id, id);
    if (owned.error) return owned.error;

    const { data: scenes, error: scenesError } = await db
      .from('scenes')
      .select(SCENE_SELECT)
      .eq('episode_id', owned.episode.id)
      .order('order', { ascending: true });

    if (scenesError) {
      console.error(
        '[v2/episodes/scenes][GET] Failed to list scenes:',
        scenesError
      );
      return NextResponse.json(
        { error: 'Failed to list scenes' },
        { status: 500 }
      );
    }

    return NextResponse.json(scenes ?? []);
  } catch (error) {
    console.error('[v2/episodes/scenes][GET] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/v2/episodes/{id}/scenes
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedEpisode(db, user.id, id);
    if (owned.error) return owned.error;

    const payload = await req.json().catch(() => null);
    const scenesInput = Array.isArray(payload)
      ? payload
      : isRecord(payload) && Array.isArray(payload.scenes)
        ? payload.scenes
        : null;

    if (!scenesInput || scenesInput.length === 0) {
      return NextResponse.json(
        { error: 'Request body must be a non-empty scenes array' },
        { status: 400 }
      );
    }

    const { data: maxOrderRow, error: maxOrderError } = await db
      .from('scenes')
      .select('order')
      .eq('episode_id', id)
      .order('order', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (maxOrderError) {
      console.error(
        '[v2/episodes/scenes][POST] Failed to load current max order:',
        maxOrderError
      );
      return NextResponse.json(
        { error: 'Failed to prepare scene ordering' },
        { status: 500 }
      );
    }

    const currentMaxOrder =
      typeof maxOrderRow?.order === 'number' ? maxOrderRow.order : 0;

    let nextAutoOrder = Math.max(1000, currentMaxOrder + 1000);

    const inserts: SceneInsert[] = [];
    const seenOrders = new Set<number>();

    for (let index = 0; index < scenesInput.length; index += 1) {
      const parsed = parseSceneCreateInput(scenesInput[index], index, id);
      if (parsed.error || !parsed.scene) {
        return NextResponse.json(
          { error: parsed.error ?? `Invalid scenes[${index}]` },
          { status: 400 }
        );
      }

      const resolvedOrder = parsed.explicitOrder ?? nextAutoOrder;

      if (seenOrders.has(resolvedOrder)) {
        return NextResponse.json(
          { error: `Duplicate order value in request: ${resolvedOrder}` },
          { status: 400 }
        );
      }

      seenOrders.add(resolvedOrder);
      parsed.scene.order = resolvedOrder;
      inserts.push(parsed.scene);

      if (parsed.explicitOrder === undefined) {
        nextAutoOrder += 1000;
      } else if (parsed.explicitOrder >= nextAutoOrder) {
        nextAutoOrder = parsed.explicitOrder + 1000;
      }
    }

    const { data: createdScenes, error: createError } = await db
      .from('scenes')
      .insert(inserts)
      .select(SCENE_SELECT);

    if (createError) {
      if ((createError as { code?: string }).code === '23505') {
        return NextResponse.json(
          {
            error:
              'One or more scene order values already exist for this episode',
          },
          { status: 409 }
        );
      }

      console.error(
        '[v2/episodes/scenes][POST] Failed to create scenes:',
        createError
      );
      return NextResponse.json(
        { error: 'Failed to create scenes' },
        { status: 500 }
      );
    }

    const orderedScenes = [...(createdScenes ?? [])].sort(
      (a, b) => (a.order as number) - (b.order as number)
    );

    return NextResponse.json(orderedScenes, { status: 201 });
  } catch (error) {
    console.error('[v2/episodes/scenes][POST] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
