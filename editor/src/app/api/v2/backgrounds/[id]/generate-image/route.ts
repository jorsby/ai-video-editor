import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createTask } from '@/lib/kieai';
import { createServiceClient } from '@/lib/supabase/admin';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const BACKGROUND_IMAGE_MODEL = 'nano-banana-2';

/**
 * POST /api/v2/backgrounds/{id}/generate-image
 *
 * Generates a background image from background.prompt (or prompt_override).
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: backgroundId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    const { data: background } = await supabase
      .from('project_backgrounds')
      .select('id, project_id, prompt')
      .eq('id', backgroundId)
      .maybeSingle();

    if (!background) {
      return NextResponse.json(
        { error: 'Background not found' },
        { status: 404 }
      );
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', background.project_id)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const promptOverride =
      typeof body.prompt_override === 'string'
        ? body.prompt_override.trim()
        : '';
    const prompt = promptOverride || (background.prompt?.trim() ?? '');

    if (!prompt) {
      return NextResponse.json(
        {
          error:
            'No prompt available. Provide prompt_override or set background.prompt.',
        },
        { status: 400 }
      );
    }

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
    webhookUrl.searchParams.set('step', 'GenerateBackgroundImage');
    webhookUrl.searchParams.set('background_id', backgroundId);

    const queued = await createTask({
      model: BACKGROUND_IMAGE_MODEL,
      callbackUrl: webhookUrl.toString(),
      input: {
        prompt,
        aspect_ratio: '9:16',
        resolution: '1K',
        output_format: 'jpg',
      },
    });

    await supabase
      .from('project_backgrounds')
      .update({
        image_gen_status: 'generating',
        image_task_id: queued.taskId,
      })
      .eq('id', backgroundId);

    return NextResponse.json({
      task_id: queued.taskId,
      model: BACKGROUND_IMAGE_MODEL,
      background_id: backgroundId,
      prompt,
    });
  } catch (error) {
    console.error('[v2/backgrounds/:id/generate-image] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
