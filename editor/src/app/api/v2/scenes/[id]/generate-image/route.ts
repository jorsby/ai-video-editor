import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { queueKieImageTask } from '@/lib/kie-image';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/scenes/{id}/generate-image
 *
 * Generates a first-frame image for a scene using Nano Banana 2 via kie.ai.
 * Always 1K resolution, 9:16 aspect ratio, JPG output.
 *
 * The scene must have a `prompt` field (visual prompt with @slug refs).
 * The prompt is sent as-is — @slug refs are human-readable tags that
 * the image model interprets as descriptions.
 *
 * Body (optional):
 *   prompt_override?: string — Custom prompt instead of scene.prompt
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: sceneId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    // ── Fetch scene + episode + series ──────────────────────────────────

    const { data: scene, error: sceneError } = await supabase
      .from('scenes')
      .select('id, episode_id, prompt, status')
      .eq('id', sceneId)
      .maybeSingle();

    if (sceneError || !scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const prompt = body.prompt_override ?? scene.prompt;

    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: 'Scene has no visual prompt. Write a prompt first.' },
        { status: 400 }
      );
    }

    const { data: episode } = await supabase
      .from('episodes')
      .select('id, series_id')
      .eq('id', scene.episode_id)
      .maybeSingle();

    if (!episode) {
      return NextResponse.json(
        { error: 'Episode not found' },
        { status: 404 }
      );
    }

    const { data: series } = await supabase
      .from('series')
      .select('id, user_id')
      .eq('id', episode.series_id)
      .maybeSingle();

    if (!series) {
      return NextResponse.json(
        { error: 'Series not found' },
        { status: 404 }
      );
    }

    if (series.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Build webhook URL ───────────────────────────────────────────────

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
    webhookUrl.searchParams.set('step', 'GenerateSceneImage');
    webhookUrl.searchParams.set('scene_id', sceneId);

    // ── Submit to kie.ai — always 1K, 9:16, JPG ────────────────────────

    const queued = await queueKieImageTask({
      prompt: prompt.trim(),
      callbackUrl: webhookUrl.toString(),
      aspectRatio: '9:16',
      resolution: '1K',
      outputFormat: 'jpg',
    });

    // ── Mark scene as in_progress ───────────────────────────────────────

    await supabase
      .from('scenes')
      .update({ status: 'in_progress' })
      .eq('id', sceneId);

    return NextResponse.json({
      task_id: queued.requestId,
      model: queued.model,
      scene_id: sceneId,
      aspect_ratio: '9:16',
      resolution: '1K',
    });
  } catch (error) {
    console.error('[v2/scenes/:id/generate-image] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
