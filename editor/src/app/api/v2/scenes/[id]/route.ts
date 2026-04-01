import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

type SceneStatus = 'draft' | 'ready' | 'in_progress' | 'done' | 'failed';
type ContentMode = 'narrative' | 'cinematic' | 'hybrid';

type SceneRecord = {
  id: string;
  episode_id: string;
  order: number;
  title: string | null;
  duration: number | null;
  content_mode: ContentMode | null;
  visual_direction: string | null;
  prompt: string | null;
  location_variant_slug: string | null;
  character_variant_slugs: string[];
  prop_variant_slugs: string[];
  audio_text: string | null;
  audio_url: string | null;
  video_url: string | null;
  status: SceneStatus;
  created_at: string;
  updated_at: string;
};

const SCENE_SELECT =
  'id, episode_id, order, title, content_mode, visual_direction, prompt, location_variant_slug, character_variant_slugs, prop_variant_slugs, audio_text, audio_url, audio_duration, video_url, video_duration, duration, status, created_at, updated_at';

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

async function getOwnedScene(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  sceneId: string
): Promise<
  | { scene: SceneRecord; error?: undefined }
  | { scene?: undefined; error: NextResponse }
> {
  const { data: scene, error: sceneError } = await db
    .from('scenes')
    .select(SCENE_SELECT)
    .eq('id', sceneId)
    .maybeSingle();

  if (sceneError || !scene) {
    return {
      error: NextResponse.json({ error: 'Scene not found' }, { status: 404 }),
    };
  }

  const { data: episode, error: episodeError } = await db
    .from('episodes')
    .select('id, series_id')
    .eq('id', scene.episode_id)
    .maybeSingle();

  if (episodeError || !episode) {
    return {
      error: NextResponse.json({ error: 'Scene not found' }, { status: 404 }),
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

  return { scene: scene as SceneRecord };
}

function parseScenePatch(body: Record<string, unknown>): {
  updates: Record<string, unknown>;
  error?: string;
} {
  const updates: Record<string, unknown> = {};

  const order = toPositiveInteger(body.order, 'order');
  if (order.error) return { updates, error: order.error };
  if (order.value !== undefined) updates.order = order.value;

  // duration is a GENERATED column (= COALESCE(audio_duration, video_duration))
  // Set audio_duration / video_duration instead
  const audioDuration = toNullableFloat(body.audio_duration, 'audio_duration');
  if (audioDuration.error) return { updates, error: audioDuration.error };
  if (audioDuration.value !== undefined)
    updates.audio_duration = audioDuration.value;

  const videoDuration = toNullableFloat(body.video_duration, 'video_duration');
  if (videoDuration.error) return { updates, error: videoDuration.error };
  if (videoDuration.value !== undefined)
    updates.video_duration = videoDuration.value;

  if (body.content_mode !== undefined) {
    if (body.content_mode === null) {
      updates.content_mode = null;
    } else if (
      typeof body.content_mode === 'string' &&
      CONTENT_MODES.has(body.content_mode as ContentMode)
    ) {
      updates.content_mode = body.content_mode as ContentMode;
    } else {
      return {
        updates,
        error: 'content_mode must be one of: narrative, cinematic, hybrid',
      };
    }
  }

  if (body.status !== undefined) {
    if (
      typeof body.status !== 'string' ||
      !SCENE_STATUSES.has(body.status as SceneStatus)
    ) {
      return {
        updates,
        error: 'status must be one of: draft, ready, in_progress, done, failed',
      };
    }
    updates.status = body.status as SceneStatus;
  }

  const title = toNullableString(body.title, 'title');
  if (title.error) return { updates, error: title.error };
  if (title.value !== undefined) updates.title = title.value;

  const visualDirection = toNullableString(
    body.visual_direction,
    'visual_direction'
  );
  if (visualDirection.error) return { updates, error: visualDirection.error };
  if (visualDirection.value !== undefined) {
    updates.visual_direction = visualDirection.value;
  }

  const prompt = toNullableString(body.prompt, 'prompt');
  if (prompt.error) return { updates, error: prompt.error };
  if (prompt.value !== undefined) updates.prompt = prompt.value;

  const locationVariantSlug = toNullableString(
    body.location_variant_slug,
    'location_variant_slug'
  );
  if (locationVariantSlug.error)
    return { updates, error: locationVariantSlug.error };
  if (locationVariantSlug.value !== undefined) {
    updates.location_variant_slug = locationVariantSlug.value;
  }

  const characterVariantSlugs = toSlugArray(
    body.character_variant_slugs,
    'character_variant_slugs'
  );
  if (characterVariantSlugs.error) {
    return { updates, error: characterVariantSlugs.error };
  }
  if (characterVariantSlugs.value !== undefined) {
    updates.character_variant_slugs = characterVariantSlugs.value;
  }

  const propVariantSlugs = toSlugArray(
    body.prop_variant_slugs,
    'prop_variant_slugs'
  );
  if (propVariantSlugs.error) return { updates, error: propVariantSlugs.error };
  if (propVariantSlugs.value !== undefined) {
    updates.prop_variant_slugs = propVariantSlugs.value;
  }

  const audioText = toNullableString(body.audio_text, 'audio_text');
  if (audioText.error) return { updates, error: audioText.error };
  if (audioText.value !== undefined) updates.audio_text = audioText.value;

  const audioUrl = toNullableString(body.audio_url, 'audio_url');
  if (audioUrl.error) return { updates, error: audioUrl.error };
  if (audioUrl.value !== undefined) updates.audio_url = audioUrl.value;

  const videoUrl = toNullableString(body.video_url, 'video_url');
  if (videoUrl.error) return { updates, error: videoUrl.error };
  if (videoUrl.value !== undefined) updates.video_url = videoUrl.value;

  return { updates };
}

// GET /api/v2/scenes/{id}
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedScene(db, user.id, id);
    if (owned.error) return owned.error;

    return NextResponse.json(owned.scene);
  } catch (error) {
    console.error('[v2/scenes/[id]][GET] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/v2/scenes/{id}
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedScene(db, user.id, id);
    if (owned.error) return owned.error;

    const body = await req.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 }
      );
    }

    const { updates, error: validationError } = parseScenePatch(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data: updatedScene, error: updateError } = await db
      .from('scenes')
      .update(updates)
      .eq('id', owned.scene.id)
      .select(SCENE_SELECT)
      .maybeSingle();

    if (updateError) {
      if ((updateError as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: 'Scene order already exists for this episode' },
          { status: 409 }
        );
      }

      console.error(
        '[v2/scenes/[id]][PATCH] Failed to update scene:',
        updateError
      );
      return NextResponse.json(
        { error: 'Failed to update scene' },
        { status: 500 }
      );
    }

    if (!updatedScene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    return NextResponse.json(updatedScene);
  } catch (error) {
    console.error('[v2/scenes/[id]][PATCH] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/v2/scenes/{id}
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const db = createServiceClient('studio');

    const owned = await getOwnedScene(db, user.id, id);
    if (owned.error) return owned.error;

    const { error: deleteError } = await db
      .from('scenes')
      .delete()
      .eq('id', owned.scene.id);

    if (deleteError) {
      console.error(
        '[v2/scenes/[id]][DELETE] Failed to delete scene:',
        deleteError
      );
      return NextResponse.json(
        { error: 'Failed to delete scene' },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: owned.scene.id, deleted: true });
  } catch (error) {
    console.error('[v2/scenes/[id]][DELETE] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
