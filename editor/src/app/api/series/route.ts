import { validateApiKey } from '@/lib/auth/api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { createSeries, listSeries } from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// GET /api/series — list all series for the authenticated user
export async function GET(req: NextRequest) {
  try {
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
    const { searchParams } = new URL(req.url);
    const projectId = asOptionalString(searchParams.get('project_id'));

    let series = await listSeries(dbClient, user.id);
    if (projectId) {
      series = series.filter((entry) => entry.project_id === projectId);
    }

    return NextResponse.json({ series });
  } catch (error) {
    console.error('List series error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/series — create a new series
export async function POST(req: NextRequest) {
  try {
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

    const body = await req.json();
    const name = asOptionalString(body?.name);

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const planStatus = asOptionalString(body?.plan_status);
    if (planStatus && !['draft', 'finalized'].includes(planStatus)) {
      return NextResponse.json(
        { error: "plan_status must be 'draft' or 'finalized'" },
        { status: 400 }
      );
    }

    const contentMode = asOptionalString(body?.content_mode);
    if (
      contentMode &&
      !['narrative', 'cinematic', 'hybrid'].includes(contentMode)
    ) {
      return NextResponse.json(
        { error: "content_mode must be 'narrative', 'cinematic', or 'hybrid'" },
        { status: 400 }
      );
    }

    const creativeBriefSource =
      body?.creative_brief !== undefined ? body.creative_brief : body?.metadata;

    if (
      creativeBriefSource !== undefined &&
      creativeBriefSource !== null &&
      !isRecord(creativeBriefSource)
    ) {
      return NextResponse.json(
        { error: 'creative_brief must be an object or null' },
        { status: 400 }
      );
    }

    const dbClient = sessionUser ? supabase : createServiceClient('studio');
    const series = await createSeries(dbClient, user.id, {
      project_id: asOptionalString(body?.project_id),
      project_description: asOptionalString(body?.project_description),
      name,
      genre: asOptionalString(body?.genre),
      tone: asOptionalString(body?.tone),
      bible: asOptionalString(body?.bible),
      content_mode: contentMode as
        | 'narrative'
        | 'cinematic'
        | 'hybrid'
        | undefined,
      language: asOptionalString(body?.language),
      aspect_ratio: asOptionalString(body?.aspect_ratio),
      video_model: asOptionalString(body?.video_model),
      image_model: asOptionalString(body?.image_model),
      voice_id: asOptionalString(body?.voice_id),
      tts_speed:
        typeof body?.tts_speed === 'number' && Number.isFinite(body.tts_speed)
          ? body.tts_speed
          : undefined,
      visual_style: body?.visual_style,
      creative_brief: isRecord(creativeBriefSource)
        ? creativeBriefSource
        : undefined,
      plan_status: planStatus as 'draft' | 'finalized' | undefined,
    });

    return NextResponse.json({ series }, { status: 201 });
  } catch (error) {
    console.error('Create series error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
