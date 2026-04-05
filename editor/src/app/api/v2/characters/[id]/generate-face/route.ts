import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { searchFaceImages } from '@/lib/image-search';
import { createTask } from '@/lib/kieai';
import { createServiceClient } from '@/lib/supabase/admin';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const FACE_GRID_MODEL = 'nano-banana-2';

function buildFaceGridPrompt(name: string): string {
  return `${name} portrait sheet (only face), same person shown from 4 angles: front view, left profile, right profile, back view, arranged in a perfect 2x2 grid, thin 2px grid lines separating each panel, identical framing in all 4 panels, pure white background, clean studio lighting, neutral expression, realistic face, high detail skin texture, sharp focus, consistent identity in all 4 panels, symmetrical layout, passport-style framing, photorealistic, natural colors`;
}

/**
 * POST /api/v2/characters/{id}/generate-face
 *
 * Re-runs face grid generation for a character.
 * Body (optional):
 *   reference_image_urls?: string[]
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: characterId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    const { data: character } = await supabase
      .from('project_characters')
      .select('id, project_id, name')
      .eq('id', characterId)
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

    const body = await req.json().catch(() => ({}));

    let referenceUrls: string[] = [];

    if (body.reference_image_urls !== undefined) {
      if (!Array.isArray(body.reference_image_urls)) {
        return NextResponse.json(
          { error: 'reference_image_urls must be an array of strings' },
          { status: 400 }
        );
      }

      referenceUrls = body.reference_image_urls
        .filter((url: unknown): url is string => typeof url === 'string')
        .map((url: string) => url.trim())
        .filter((url: string) => url.length > 0);
    } else {
      const searchResults = await searchFaceImages(character.name, 3);
      referenceUrls = searchResults.map((item) => item.url);
    }

    if (referenceUrls.length === 0) {
      return NextResponse.json(
        {
          error:
            'No reference images available. Provide reference_image_urls or try again later.',
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
    webhookUrl.searchParams.set('step', 'GenerateFaceGrid');
    webhookUrl.searchParams.set('character_id', characterId);

    const queued = await createTask({
      model: FACE_GRID_MODEL,
      callbackUrl: webhookUrl.toString(),
      input: {
        prompt: buildFaceGridPrompt(character.name),
        image_urls: referenceUrls,
        aspect_ratio: '1:1',
        resolution: '1k',
      },
    });

    await supabase
      .from('project_characters')
      .update({
        face_grid_status: 'generating',
        face_grid_task_id: queued.taskId,
      })
      .eq('id', characterId);

    return NextResponse.json({
      task_id: queued.taskId,
      model: FACE_GRID_MODEL,
      character_id: characterId,
      reference_image_urls: referenceUrls,
    });
  } catch (error) {
    console.error('[v2/characters/:id/generate-face] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
