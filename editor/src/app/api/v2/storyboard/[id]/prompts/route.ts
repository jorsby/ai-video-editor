import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createServiceClient } from '@/lib/supabase/admin';

type RouteContext = { params: Promise<{ id: string }> };

const voiceoverUpdateSchema = z.object({
  id: z.string().uuid().optional(),
  language: z.string().min(1).optional(),
  text: z.string().nullable().optional(),
  generation_meta: z.record(z.string(), z.unknown()).optional(),
  feedback: z.string().nullable().optional(),
});

const sceneUpdateSchema = z.object({
  scene_id: z.string().uuid().optional(),
  scene_order: z.number().int().min(0).optional(),
  prompt: z.string().nullable().optional(),
  multi_prompt: z.array(z.string()).nullable().optional(),
  generation_meta: z.record(z.string(), z.unknown()).optional(),
  feedback: z.string().nullable().optional(),
  voiceovers: z.array(voiceoverUpdateSchema).optional(),
});

const bodySchema = z.object({
  scenes: z.array(sceneUpdateSchema).min(1),
});

function normalizePrompt(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id: storyboardId } = await context.params;

    const user = await getUserOrApiKey(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 }
      );
    }

    const db = createServiceClient('studio');

    const { data: storyboard, error: storyboardError } = await db
      .from('storyboards')
      .select('id, project_id')
      .eq('id', storyboardId)
      .single();

    if (storyboardError || !storyboard) {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }

    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', storyboard.project_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { data: storyboardScenesData, error: scenesError } = await db
      .from('scenes')
      .select('id, order')
      .eq('storyboard_id', storyboardId);

    if (scenesError) {
      return NextResponse.json(
        { error: 'Failed to load storyboard scenes' },
        { status: 500 }
      );
    }

    const storyboardScenes = (storyboardScenesData ?? []) as Array<{
      id: string;
      order: number;
    }>;

    const sceneById = new Map(
      storyboardScenes.map((scene) => [scene.id, scene])
    );
    const sceneByOrder = new Map(
      storyboardScenes.map((scene) => [Number(scene.order), scene])
    );

    let updatedScenes = 0;
    let updatedVoiceovers = 0;

    for (const scenePatch of parsed.data.scenes) {
      const targetScene =
        (scenePatch.scene_id ? sceneById.get(scenePatch.scene_id) : null) ??
        (scenePatch.scene_order != null
          ? sceneByOrder.get(scenePatch.scene_order)
          : null);

      if (!targetScene) {
        continue;
      }

      const sceneUpdates: Record<string, unknown> = {};
      if (scenePatch.prompt !== undefined) {
        sceneUpdates.prompt = normalizePrompt(scenePatch.prompt);
      }
      if (scenePatch.multi_prompt !== undefined) {
        sceneUpdates.multi_prompt =
          scenePatch.multi_prompt && scenePatch.multi_prompt.length > 0
            ? scenePatch.multi_prompt.map((p) => p.trim()).filter(Boolean)
            : null;
      }
      if (scenePatch.generation_meta !== undefined) {
        sceneUpdates.generation_meta = scenePatch.generation_meta;
      }
      if (scenePatch.feedback !== undefined) {
        sceneUpdates.feedback = normalizePrompt(scenePatch.feedback);
      }

      if (Object.keys(sceneUpdates).length > 0) {
        const { error: updateSceneError } = await db
          .from('scenes')
          .update(sceneUpdates)
          .eq('id', targetScene.id);

        if (updateSceneError) {
          return NextResponse.json(
            { error: `Failed to update scene ${targetScene.id}` },
            { status: 500 }
          );
        }

        updatedScenes++;
      }

      for (const voiceoverPatch of scenePatch.voiceovers ?? []) {
        const voUpdates: Record<string, unknown> = {};
        if (voiceoverPatch.text !== undefined) {
          voUpdates.text = normalizePrompt(voiceoverPatch.text);
        }
        if (voiceoverPatch.generation_meta !== undefined) {
          voUpdates.generation_meta = voiceoverPatch.generation_meta;
        }
        if (voiceoverPatch.feedback !== undefined) {
          voUpdates.feedback = normalizePrompt(voiceoverPatch.feedback);
        }

        if (Object.keys(voUpdates).length === 0) continue;

        if (voiceoverPatch.id) {
          const { error: updateVoError } = await db
            .from('voiceovers')
            .update(voUpdates)
            .eq('id', voiceoverPatch.id)
            .eq('scene_id', targetScene.id);

          if (updateVoError) {
            return NextResponse.json(
              { error: `Failed to update voiceover ${voiceoverPatch.id}` },
              { status: 500 }
            );
          }

          updatedVoiceovers++;
          continue;
        }

        if (!voiceoverPatch.language) continue;

        const { error: updateByLangError } = await db
          .from('voiceovers')
          .update(voUpdates)
          .eq('scene_id', targetScene.id)
          .eq('language', voiceoverPatch.language);

        if (updateByLangError) {
          return NextResponse.json(
            {
              error: `Failed to update voiceover language ${voiceoverPatch.language}`,
            },
            { status: 500 }
          );
        }

        updatedVoiceovers++;
      }
    }

    return NextResponse.json({
      success: true,
      storyboard_id: storyboardId,
      updated_scenes: updatedScenes,
      updated_voiceovers: updatedVoiceovers,
    });
  } catch (error) {
    console.error('[v2/storyboard/prompts] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
