import { validateApiKey } from '@/lib/auth/api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  deleteVideo,
  getVideoWithAssets,
  updateVideo,
} from '@/lib/supabase/video-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseVideoUpdates(body: Record<string, unknown>) {
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return {
        error: NextResponse.json(
          { error: 'Name cannot be empty' },
          { status: 400 }
        ),
      };
    }
    updates.name = body.name.trim();
  }

  if (body.genre !== undefined) {
    updates.genre = asOptionalString(body.genre);
  }

  if (body.tone !== undefined) {
    updates.tone = asOptionalString(body.tone);
  }

  if (body.bible !== undefined) {
    updates.bible = asOptionalString(body.bible);
  }

  if (body.content_mode !== undefined) {
    if (
      typeof body.content_mode !== 'string' ||
      !['narrative', 'cinematic', 'hybrid'].includes(body.content_mode)
    ) {
      return {
        error: NextResponse.json(
          {
            error: "content_mode must be 'narrative', 'cinematic', or 'hybrid'",
          },
          { status: 400 }
        ),
      };
    }
    updates.content_mode = body.content_mode;
  }

  if (body.plan_status !== undefined) {
    if (
      typeof body.plan_status !== 'string' ||
      !['draft', 'finalized'].includes(body.plan_status)
    ) {
      return {
        error: NextResponse.json(
          { error: "plan_status must be 'draft' or 'finalized'" },
          { status: 400 }
        ),
      };
    }
    updates.plan_status = body.plan_status;
  }

  const nullableTextFields = [
    'language',
    'aspect_ratio',
    'video_model',
    'image_model',
    'voice_id',
  ] as const;

  for (const field of nullableTextFields) {
    if (body[field] !== undefined) {
      updates[field] = asOptionalString(body[field]);
    }
  }

  if (body.tts_speed !== undefined) {
    if (
      body.tts_speed !== null &&
      (typeof body.tts_speed !== 'number' || !Number.isFinite(body.tts_speed))
    ) {
      return {
        error: NextResponse.json(
          { error: 'tts_speed must be a finite number or null' },
          { status: 400 }
        ),
      };
    }
    updates.tts_speed = body.tts_speed;
  }

  if (body.visual_style !== undefined) {
    if (
      body.visual_style !== null &&
      typeof body.visual_style !== 'string' &&
      !isRecord(body.visual_style)
    ) {
      return {
        error: NextResponse.json(
          { error: 'visual_style must be a string, object, or null' },
          { status: 400 }
        ),
      };
    }

    updates.visual_style = body.visual_style;
  }

  const creativeBriefSource =
    body.creative_brief !== undefined ? body.creative_brief : body.metadata;

  if (creativeBriefSource !== undefined) {
    if (creativeBriefSource !== null && !isRecord(creativeBriefSource)) {
      return {
        error: NextResponse.json(
          { error: 'creative_brief must be an object or null' },
          { status: 400 }
        ),
      };
    }

    updates.creative_brief = creativeBriefSource;
  }

  if (Object.keys(updates).length === 0) {
    return {
      error: NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      ),
    };
  }

  return { updates };
}

// GET /api/videos/[id] — get video with all assets/variants
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

    // Use service-role client so private storage URLs can always be resolved.
    const dbClient = createServiceClient('studio');
    const video = await getVideoWithAssets(dbClient, id, user.id);
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    return NextResponse.json({ video });
  } catch (error) {
    console.error('Get video error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function updateVideoHandler(req: NextRequest, context: RouteContext) {
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

    const body = (await req.json()) as Record<string, unknown>;
    const parsed = parseVideoUpdates(body);

    if ('error' in parsed) {
      return parsed.error;
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');
    const video = await updateVideo(dbClient, id, user.id, parsed.updates);
    return NextResponse.json({ video });
  } catch (error) {
    console.error('Update video error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/videos/[id] — update video
export async function PUT(req: NextRequest, context: RouteContext) {
  return updateVideoHandler(req, context);
}

// PATCH /api/videos/[id] — partial update video
export async function PATCH(req: NextRequest, context: RouteContext) {
  return updateVideoHandler(req, context);
}

// DELETE /api/videos/[id] — delete video (cascades to assets/chapters/scenes)
export async function DELETE(req: NextRequest, context: RouteContext) {
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
    const existing = await getVideoWithAssets(dbClient, id, user.id);
    if (!existing) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    await deleteVideo(dbClient, id, user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
