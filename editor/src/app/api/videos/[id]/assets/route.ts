import { validateApiKey } from '@/lib/auth/api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  createVideoAsset,
  getVideo,
  listVideoAssets,
} from '@/lib/supabase/video-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// GET /api/videos/[id]/assets — list assets with variants
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

    // Use service-role client so canonical variant image_url values can be hydrated.
    const dbClient = createServiceClient('studio');

    // Verify video ownership
    const video = await getVideo(dbClient, id, user.id);
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    const assets = await listVideoAssets(dbClient, id);
    return NextResponse.json({ assets });
  } catch (error) {
    console.error('List video assets error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/videos/[id]/assets — create a new asset
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
    const name = asOptionalString(body?.name);

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    if (!['character', 'location', 'prop'].includes(body?.type)) {
      return NextResponse.json(
        { error: 'Type must be character, location, or prop' },
        { status: 400 }
      );
    }

    const asset = await createVideoAsset(dbClient, id, {
      type: body.type,
      name,
      slug: asOptionalString(body?.slug),
      description: asOptionalString(body?.description),
      sort_order:
        typeof body?.sort_order === 'number' && Number.isFinite(body.sort_order)
          ? body.sort_order
          : undefined,
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    console.error('Create video asset error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
