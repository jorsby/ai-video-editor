import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';
import { slugify } from '@/lib/utils/slugify';
import { searchFaceImages } from '@/lib/image-search';
import { createTask } from '@/lib/kieai';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const FACE_GRID_MODEL = 'nano-banana-2';

function buildFaceGridPrompt(name: string): string {
  return `${name} portrait sheet (only face), same person shown from 4 angles: front view, left profile, right profile, back view, arranged in a perfect 2x2 grid, thin 2px grid lines separating each panel, identical framing in all 4 panels, pure white background, clean studio lighting, neutral expression, realistic face, high detail skin texture, sharp focus, consistent identity in all 4 panels, symmetrical layout, passport-style framing, photorealistic, natural colors`;
}

/**
 * GET /api/v2/projects/{id}/characters
 *
 * Lists all characters for a project with their variants.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    // Verify project ownership
    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: characters, error } = await supabase
      .from('project_characters')
      .select(
        '*, variants:project_character_variants(*)'
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return NextResponse.json(characters ?? []);
  } catch (error) {
    console.error('[v2/projects/:id/characters GET]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v2/projects/{id}/characters
 *
 * Creates a character and automatically:
 * 1. Searches for face reference images
 * 2. Queues face grid generation via kie.ai
 *
 * Body (bare array):
 * [
 *   {
 *     "name": "Arda Güler",
 *     "description": "Real Madrid midfielder",
 *     "slug": "arda-guler",              // optional, auto-generated
 *     "reference_image_urls": [...]       // optional, skips web search
 *   }
 * ]
 *
 * Returns created characters. face_grid_status will be "generating".
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: projectId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    // Verify project ownership
    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', projectId)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const items: Array<{
      name: string;
      description?: string;
      slug?: string;
      reference_image_urls?: string[];
    }> = Array.isArray(body) ? body : [body];

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'At least one character required' },
        { status: 400 }
      );
    }

    const webhookBase = resolveWebhookBaseUrl(req);

    const results = [];

    for (const item of items) {
      if (!item.name?.trim()) {
        results.push({ error: 'Name is required', input: item });
        continue;
      }

      const slug = item.slug?.trim() || slugify(item.name);

      // Insert character
      const { data: character, error: insertError } = await supabase
        .from('project_characters')
        .upsert(
          {
            project_id: projectId,
            name: item.name.trim(),
            slug,
            description: item.description?.trim() || null,
            face_grid_status: 'idle',
          },
          { onConflict: 'project_id,slug' }
        )
        .select()
        .single();

      if (insertError || !character) {
        results.push({
          error: insertError?.message ?? 'Insert failed',
          input: item,
        });
        continue;
      }

      // Create default main variant
      await supabase
        .from('project_character_variants')
        .upsert(
          {
            character_id: character.id,
            name: 'Main',
            slug: `${slug}-main`,
            prompt: '',
            is_main: true,
          },
          { onConflict: 'character_id,slug' }
        );

      // Search for face images (or use provided ones)
      let referenceUrls: string[] = item.reference_image_urls ?? [];
      if (referenceUrls.length === 0) {
        try {
          const faceImages = await searchFaceImages(item.name, 3);
          referenceUrls = faceImages.map((img) => img.url);
        } catch (searchErr) {
          console.warn(
            `[characters] Face search failed for "${item.name}":`,
            searchErr
          );
        }
      }

      // Queue face grid generation if we have reference images
      let faceGridTaskId: string | null = null;
      if (referenceUrls.length > 0 && webhookBase) {
        try {
          const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
          webhookUrl.searchParams.set('step', 'GenerateFaceGrid');
          webhookUrl.searchParams.set('character_id', character.id);

          const result = await createTask({
            model: FACE_GRID_MODEL,
            callbackUrl: webhookUrl.toString(),
            input: {
              prompt: buildFaceGridPrompt(item.name),
              image_urls: referenceUrls,
              aspect_ratio: '1:1',
              resolution: '1k',
            },
          });

          faceGridTaskId = result.taskId;

          await supabase
            .from('project_characters')
            .update({
              face_grid_status: 'generating',
              face_grid_task_id: faceGridTaskId,
            })
            .eq('id', character.id);
        } catch (genErr) {
          console.error(
            `[characters] Face grid generation failed for "${item.name}":`,
            genErr
          );
        }
      }

      results.push({
        ...character,
        face_grid_status: faceGridTaskId ? 'generating' : 'idle',
        face_grid_task_id: faceGridTaskId,
        reference_urls_used: referenceUrls,
      });
    }

    return NextResponse.json(results, { status: 201 });
  } catch (error) {
    console.error('[v2/projects/:id/characters POST]', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
