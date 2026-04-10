import { validateApiKey } from '@/lib/auth/api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  deleteChapter,
  getVideo,
  updateChapter,
} from '@/lib/supabase/video-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string; chapterId: string }> };

function asOptionalString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidAssetVariantMap(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  for (const key of ['characters', 'locations', 'props']) {
    if (!Array.isArray(input[key])) return false;
    if (!(input[key] as unknown[]).every((item) => typeof item === 'string')) {
      return false;
    }
  }
  return true;
}

async function chapterExistsInVideo(
  // biome-ignore lint/suspicious/noExplicitAny: supabase route clients are untyped across this codebase
  dbClient: any,
  videoId: string,
  chapterId: string
): Promise<boolean> {
  const { data, error } = await dbClient
    .from('chapters')
    .select('id')
    .eq('id', chapterId)
    .eq('video_id', videoId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load chapter: ${error.message}`);
  }

  return !!data;
}

// PUT /api/videos/[id]/chapters/[chapterId]
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id, chapterId } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    const apiKeyResult = !sessionUser ? validateApiKey(req) : { valid: false };
    const user =
      sessionUser ??
      (apiKeyResult.valid && apiKeyResult.userId
        ? { id: apiKeyResult.userId }
        : null);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');
    const video = await getVideo(dbClient, id, user.id);
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const belongsToVideo = await chapterExistsInVideo(dbClient, id, chapterId);
    if (!belongsToVideo) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.order !== undefined || body.chapter_number !== undefined) {
      const order =
        typeof body.order === 'number'
          ? body.order
          : typeof body.chapter_number === 'number'
            ? body.chapter_number
            : null;

      if (!order || order < 1 || !Number.isInteger(order)) {
        return NextResponse.json(
          { error: 'order (or chapter_number) must be a positive integer' },
          { status: 400 }
        );
      }

      updates.order = order;
    }

    if (body.title !== undefined) updates.title = asOptionalString(body.title);
    if (body.synopsis !== undefined)
      updates.synopsis = asOptionalString(body.synopsis);
    if (body.audio_content !== undefined)
      updates.audio_content = asOptionalString(body.audio_content);
    if (body.visual_outline !== undefined)
      updates.visual_outline = asOptionalString(body.visual_outline);

    if (body.status !== undefined) {
      if (
        typeof body.status !== 'string' ||
        !['draft', 'ready', 'in_progress', 'done'].includes(body.status)
      ) {
        return NextResponse.json(
          {
            error: "status must be 'draft', 'ready', 'in_progress', or 'done'",
          },
          { status: 400 }
        );
      }
      updates.status = body.status;
    }

    if (body.plan_json !== undefined) {
      if (
        body.plan_json !== null &&
        (typeof body.plan_json !== 'object' || Array.isArray(body.plan_json))
      ) {
        return NextResponse.json(
          { error: 'plan_json must be an object or null' },
          { status: 400 }
        );
      }

      updates.plan_json = body.plan_json;
    }

    if (body.asset_variant_map !== undefined) {
      if (!isValidAssetVariantMap(body.asset_variant_map)) {
        return NextResponse.json(
          {
            error:
              'asset_variant_map must be an object with string arrays: characters, locations, props',
          },
          { status: 400 }
        );
      }
      updates.asset_variant_map = body.asset_variant_map;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const chapter = await updateChapter(dbClient, chapterId, updates);
    return NextResponse.json({ chapter });
  } catch (error) {
    console.error('Update chapter error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/videos/[id]/chapters/[chapterId]
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id, chapterId } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    const apiKeyResult = !sessionUser ? validateApiKey(req) : { valid: false };
    const user =
      sessionUser ??
      (apiKeyResult.valid && apiKeyResult.userId
        ? { id: apiKeyResult.userId }
        : null);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');
    const video = await getVideo(dbClient, id, user.id);
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const belongsToVideo = await chapterExistsInVideo(dbClient, id, chapterId);
    if (!belongsToVideo) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }

    await deleteChapter(dbClient, chapterId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete chapter error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
