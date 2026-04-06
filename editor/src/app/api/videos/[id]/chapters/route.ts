import { validateApiKey } from '@/lib/auth/api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  createChapter,
  getVideo,
  listChapters,
} from '@/lib/supabase/video-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

// GET /api/videos/[id]/chapters
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
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

    const chapters = await listChapters(dbClient, id);
    return NextResponse.json({ chapters });
  } catch (error) {
    console.error('List chapters error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/videos/[id]/chapters
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
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

    const body = await req.json();

    const order =
      typeof body?.order === 'number'
        ? body.order
        : typeof body?.chapter_number === 'number'
          ? body.chapter_number
          : null;

    if (!order || order < 1 || !Number.isInteger(order)) {
      return NextResponse.json(
        { error: 'order (or chapter_number) must be a positive integer' },
        { status: 400 }
      );
    }

    if (body?.status !== undefined) {
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
    }

    if (
      body?.asset_variant_map !== undefined &&
      !isValidAssetVariantMap(body.asset_variant_map)
    ) {
      return NextResponse.json(
        {
          error:
            'asset_variant_map must be an object with string arrays: characters, locations, props',
        },
        { status: 400 }
      );
    }

    const chapter = await createChapter(dbClient, id, {
      order,
      title: asOptionalString(body?.title),
      synopsis: asOptionalString(body?.synopsis),
      audio_content: asOptionalString(body?.audio_content),
      visual_outline: asOptionalString(body?.visual_outline),
      asset_variant_map: body?.asset_variant_map,
      plan_json:
        body?.plan_json && typeof body.plan_json === 'object'
          ? body.plan_json
          : undefined,
      status: body?.status,
    });

    return NextResponse.json({ chapter }, { status: 201 });
  } catch (error) {
    console.error('Create chapter error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
