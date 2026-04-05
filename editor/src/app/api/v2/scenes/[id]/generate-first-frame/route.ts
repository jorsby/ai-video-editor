import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createTask } from '@/lib/kieai';
import {
  parseFramePrompt,
  type ParsedFramePrompt,
} from '@/lib/scenes/parse-frame-prompt';
import { createServiceClient } from '@/lib/supabase/admin';
import { resolveWebhookBaseUrl } from '@/lib/webhook-base-url';

type RouteContext = { params: Promise<{ id: string }> };

const FRAME_MODEL = 'nano-banana-2';

async function resolveReferenceUrls(params: {
  supabase: ReturnType<typeof createServiceClient>;
  projectId: string;
  refs: string[];
}) {
  const { supabase, projectId, refs } = params;

  if (refs.length === 0) {
    return { urls: [] as string[] };
  }

  const [characterResult, propResult] = await Promise.all([
    supabase
      .from('project_characters')
      .select('slug, face_grid_url')
      .eq('project_id', projectId)
      .in('slug', refs),
    supabase
      .from('project_asset_variants')
      .select('slug, image_url, asset:project_assets!inner(project_id)')
      .eq('project_assets.project_id', projectId)
      .in('slug', refs),
  ]);

  const characterBySlug = new Map<string, string | null>();
  for (const row of characterResult.data ?? []) {
    if (typeof row.slug !== 'string') continue;
    const slug = row.slug.toLowerCase();
    if (characterBySlug.has(slug)) continue;
    characterBySlug.set(
      slug,
      typeof row.face_grid_url === 'string' ? row.face_grid_url : null
    );
  }

  const propBySlug = new Map<string, string | null>();
  for (const row of propResult.data ?? []) {
    if (typeof row.slug !== 'string') continue;
    const slug = row.slug.toLowerCase();
    if (propBySlug.has(slug)) continue;
    propBySlug.set(
      slug,
      typeof row.image_url === 'string' ? row.image_url : null
    );
  }

  const urls: string[] = [];
  const unknownRefs: string[] = [];
  const ambiguousRefs: string[] = [];
  const missingCharacterFaceGridRefs: string[] = [];
  const missingPropImageRefs: string[] = [];

  for (const slug of refs) {
    const hasCharacter = characterBySlug.has(slug);
    const hasProp = propBySlug.has(slug);

    if (hasCharacter && hasProp) {
      ambiguousRefs.push(`@${slug}`);
      continue;
    }

    if (hasCharacter) {
      const url = characterBySlug.get(slug) ?? null;
      if (!url) {
        missingCharacterFaceGridRefs.push(`@${slug}`);
        continue;
      }
      urls.push(url);
      continue;
    }

    if (hasProp) {
      const url = propBySlug.get(slug) ?? null;
      if (!url) {
        missingPropImageRefs.push(`@${slug}`);
        continue;
      }
      urls.push(url);
      continue;
    }

    unknownRefs.push(`@${slug}`);
  }

  if (
    unknownRefs.length > 0 ||
    ambiguousRefs.length > 0 ||
    missingCharacterFaceGridRefs.length > 0 ||
    missingPropImageRefs.length > 0
  ) {
    return {
      error: NextResponse.json(
        {
          error: 'Could not resolve one or more REFS slugs.',
          unknown_refs: unknownRefs,
          ambiguous_refs: ambiguousRefs,
          missing_character_face_grid: missingCharacterFaceGridRefs,
          missing_prop_image: missingPropImageRefs,
        },
        { status: 400 }
      ),
    };
  }

  return { urls };
}

/**
 * POST /api/v2/scenes/{id}/generate-first-frame
 *
 * Uses scene.first_frame_prompt format:
 * BASE: @background-slug
 * REFS: @character-or-prop-slug, @character-or-prop-slug
 * EDIT: instruction text
 */
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: sceneId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient('studio');

    const { data: scene, error: sceneError } = await supabase
      .from('scenes')
      .select('id, episode_id, first_frame_prompt')
      .eq('id', sceneId)
      .maybeSingle();

    if (sceneError || !scene) {
      return NextResponse.json({ error: 'Scene not found' }, { status: 404 });
    }

    if (!scene.first_frame_prompt?.trim()) {
      return NextResponse.json(
        {
          error:
            'Scene has no first_frame_prompt. Set first_frame_prompt before generating.',
        },
        { status: 400 }
      );
    }

    const { data: episode } = await supabase
      .from('episodes')
      .select('id, series_id')
      .eq('id', scene.episode_id)
      .maybeSingle();

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    const { data: series } = await supabase
      .from('series')
      .select('id, project_id, aspect_ratio')
      .eq('id', episode.series_id)
      .maybeSingle();

    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', series.project_id)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let parsedPrompt: ParsedFramePrompt;
    try {
      parsedPrompt = parseFramePrompt(scene.first_frame_prompt);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Invalid first_frame_prompt format.',
        },
        { status: 400 }
      );
    }

    if (parsedPrompt.base.kind === 'use_first_frame') {
      return NextResponse.json(
        {
          error:
            'BASE: use_first_frame is only valid for /generate-last-frame.',
        },
        { status: 400 }
      );
    }

    const { data: background } = await supabase
      .from('project_backgrounds')
      .select('slug, image_url')
      .eq('project_id', series.project_id)
      .eq('slug', parsedPrompt.base.slug)
      .maybeSingle();

    if (!background) {
      return NextResponse.json(
        {
          error: `BASE background @${parsedPrompt.base.slug} was not found in this project.`,
        },
        { status: 400 }
      );
    }

    if (!background.image_url) {
      return NextResponse.json(
        {
          error: `BASE background @${parsedPrompt.base.slug} has no image_url.`,
          hint: 'Generate the background image first.',
        },
        { status: 400 }
      );
    }

    const resolvedRefs = await resolveReferenceUrls({
      supabase,
      projectId: series.project_id,
      refs: parsedPrompt.refs,
    });

    if ('error' in resolvedRefs) {
      return resolvedRefs.error;
    }

    const webhookBase = resolveWebhookBaseUrl(req);
    if (!webhookBase) {
      return NextResponse.json(
        { error: 'Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL' },
        { status: 500 }
      );
    }

    const webhookUrl = new URL(`${webhookBase}/api/webhook/kieai`);
    webhookUrl.searchParams.set('step', 'GenerateFirstFrame');
    webhookUrl.searchParams.set('scene_id', sceneId);

    const task = await createTask({
      model: FRAME_MODEL,
      callbackUrl: webhookUrl.toString(),
      input: {
        prompt: parsedPrompt.edit,
        image_input: [background.image_url, ...resolvedRefs.urls],
        aspect_ratio: series.aspect_ratio ?? '9:16',
        resolution: '1K',
        output_format: 'jpg',
      },
    });

    await supabase
      .from('scenes')
      .update({
        first_frame_status: 'generating',
        first_frame_task_id: task.taskId,
      })
      .eq('id', sceneId);

    return NextResponse.json({
      task_id: task.taskId,
      model: FRAME_MODEL,
      scene_id: sceneId,
      step: 'GenerateFirstFrame',
      base_image_url: background.image_url,
      ref_count: resolvedRefs.urls.length,
    });
  } catch (error) {
    console.error('[v2/scenes/:id/generate-first-frame] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
