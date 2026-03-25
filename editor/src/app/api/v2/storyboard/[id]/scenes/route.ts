import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, content-type, x-client-info, apikey',
};

const createSceneBodySchema = z.object({
  sort_order: z.number().int().min(1),
  audio_text: z.string().optional(),
  visual_direction: z.string().optional(),
  prompt: z.string().optional(),
  duration: z.literal(6).or(z.literal(10)).optional(),
  background_name: z.string().min(1).optional(),
  object_names: z.array(z.string()).max(4).optional(),
  language: z.string().min(2).max(5).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

function jsonResponse(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}

/**
 * POST /api/v2/storyboard/[id]/scenes — Create a new scene
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserOrApiKey(req);
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { id: storyboardId } = await context.params;
    const body = await req.json().catch(() => null);
    const parsed = createSceneBodySchema.safeParse(body);

    if (!parsed.success) {
      return jsonResponse(
        { error: 'Validation failed', details: parsed.error.flatten() },
        400
      );
    }

    const supabase = createServiceClient();

    const { data: storyboard, error: storyboardErr } = await supabase
      .schema('studio')
      .from('storyboards')
      .select('id, plan_status')
      .eq('id', storyboardId)
      .single();

    if (storyboardErr || !storyboard) {
      return jsonResponse({ error: 'Storyboard not found' }, 404);
    }

    if (storyboard.plan_status === 'approved') {
      return jsonResponse(
        { error: 'Cannot add scenes to an approved storyboard' },
        400
      );
    }

    const data = parsed.data;
    const insert: Record<string, unknown> = {
      storyboard_id: storyboardId,
      order: data.sort_order,
    };

    if (data.audio_text !== undefined) insert.audio_text = data.audio_text;
    if (data.visual_direction !== undefined)
      insert.visual_direction = data.visual_direction;
    if (data.prompt !== undefined) insert.prompt = data.prompt;
    if (data.duration !== undefined) insert.duration = data.duration;
    if (data.background_name !== undefined)
      insert.background_name = data.background_name;
    if (data.object_names !== undefined)
      insert.object_names = data.object_names;
    if (data.language !== undefined) insert.language = data.language;

    const { data: scene, error: insertErr } = await supabase
      .schema('studio')
      .from('scenes')
      .insert(insert)
      .select('id, storyboard_id, order')
      .single();

    if (insertErr || !scene) {
      console.error('[scenes/create] Insert failed:', insertErr);
      return jsonResponse({ error: 'Failed to create scene' }, 500);
    }

    if (storyboard.plan_status === 'empty') {
      await supabase
        .schema('studio')
        .from('storyboards')
        .update({ plan_status: 'draft' })
        .eq('id', storyboardId)
        .eq('plan_status', 'empty');
    }

    return jsonResponse(
      {
        scene_id: scene.id,
        storyboard_id: scene.storyboard_id,
        sort_order: scene.order,
        status: 'created',
      },
      201
    );
  } catch (err) {
    console.error('[scenes/create] Error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
