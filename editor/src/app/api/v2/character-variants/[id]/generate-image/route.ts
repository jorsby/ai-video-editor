import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createTask } from '@/lib/kieai';
import { createServiceClient } from '@/lib/supabase/admin';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const CHARACTER_VARIANT_IMAGE_MODEL = 'nano-banana-2';

/**
 * POST /api/v2/character-variants/{id}/generate-image
 *
 * Generates a character variant image using the parent character's face grid
 * as image reference input.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: variantId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    const { data: variant } = await supabase
      .from('project_character_variants')
      .select('id, character_id, prompt')
      .eq('id', variantId)
      .maybeSingle();

    if (!variant) {
      return NextResponse.json(
        { error: 'Character variant not found' },
        { status: 404 }
      );
    }

    const { data: character } = await supabase
      .from('project_characters')
      .select('id, project_id, face_grid_url')
      .eq('id', variant.character_id)
      .maybeSingle();

    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      );
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', character.project_id)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!character.face_grid_url) {
      return NextResponse.json(
        {
          error: 'Character face grid is missing. Generate face grid first.',
          hint: 'POST /api/v2/characters/{id}/generate-face',
        },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));

    const promptOverride =
      typeof body.prompt_override === 'string'
        ? body.prompt_override.trim()
        : '';

    const prompt = promptOverride || (variant.prompt?.trim() ?? '');
    if (!prompt) {
      return NextResponse.json(
        {
          error:
            'No prompt available. Provide prompt_override or set variant.prompt.',
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
    webhookUrl.searchParams.set('step', 'GenerateCharacterVariantImage');
    webhookUrl.searchParams.set('variant_id', variantId);

    const queued = await createTask({
      model: CHARACTER_VARIANT_IMAGE_MODEL,
      callbackUrl: webhookUrl.toString(),
      input: {
        prompt,
        image_input: [character.face_grid_url],
        aspect_ratio: '9:16',
        resolution: '1K',
        output_format: 'jpg',
      },
    });

    await supabase
      .from('project_character_variants')
      .update({
        image_gen_status: 'generating',
        image_task_id: queued.taskId,
      })
      .eq('id', variantId);

    return NextResponse.json({
      task_id: queued.taskId,
      model: CHARACTER_VARIANT_IMAGE_MODEL,
      variant_id: variantId,
      reference_image_url: character.face_grid_url,
      prompt,
    });
  } catch (error) {
    console.error('[v2/character-variants/:id/generate-image] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
