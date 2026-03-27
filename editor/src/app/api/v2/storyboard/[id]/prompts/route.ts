import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import {
  compileScenePromptContract,
  getScenePromptContractFromGenerationMeta,
  mergeScenePromptContractGenerationMeta,
} from '@/lib/storyboard/prompt-compiler';
import {
  promptJSONSchema,
  validatedRuntimeSchema,
} from '@/lib/storyboard/scene-contracts';
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
  prompt_json: promptJSONSchema.optional(),
  validated_runtime: validatedRuntimeSchema.optional(),
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

type StoryboardSceneRow = {
  id: string;
  order: number;
  generation_meta: Record<string, unknown> | null;
};

function resolveTargetScene(input: {
  scenePatch: z.infer<typeof sceneUpdateSchema>;
  sceneById: Map<string, StoryboardSceneRow>;
  sceneByOrder: Map<number, StoryboardSceneRow>;
  sceneByOneBasedOrder: Map<number, StoryboardSceneRow>;
}): StoryboardSceneRow | null {
  const { scenePatch, sceneById, sceneByOrder, sceneByOneBasedOrder } = input;

  if (scenePatch.scene_id) {
    return sceneById.get(scenePatch.scene_id) ?? null;
  }

  // Prompt-contract payloads are 1-based by schema (`prompt_json.scene_order`),
  // while DB scene.order is 0-based.
  if (scenePatch.prompt_json) {
    return sceneByOneBasedOrder.get(scenePatch.prompt_json.scene_order) ?? null;
  }

  if (scenePatch.scene_order != null) {
    return (
      sceneByOrder.get(scenePatch.scene_order) ??
      sceneByOneBasedOrder.get(scenePatch.scene_order) ??
      null
    );
  }

  return null;
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
      .select('id, order, generation_meta')
      .eq('storyboard_id', storyboardId);

    if (scenesError) {
      return NextResponse.json(
        { error: 'Failed to load storyboard scenes' },
        { status: 500 }
      );
    }

    const storyboardScenes = (storyboardScenesData ??
      []) as StoryboardSceneRow[];

    const sceneById = new Map(
      storyboardScenes.map((scene) => [scene.id, scene])
    );
    const sceneByOrder = new Map(
      storyboardScenes.map((scene) => [Number(scene.order), scene])
    );
    const sceneByOneBasedOrder = new Map(
      storyboardScenes.map((scene) => [Number(scene.order) + 1, scene])
    );

    let updatedScenes = 0;
    let updatedVoiceovers = 0;
    const compiledScenes: Array<Record<string, unknown>> = [];
    const skippedScenes: Array<Record<string, unknown>> = [];

    for (const scenePatch of parsed.data.scenes) {
      const targetScene = resolveTargetScene({
        scenePatch,
        sceneById,
        sceneByOrder,
        sceneByOneBasedOrder,
      });

      if (!targetScene) {
        skippedScenes.push({
          scene_id: scenePatch.scene_id ?? null,
          scene_order: scenePatch.scene_order ?? null,
          prompt_json_scene_order: scenePatch.prompt_json?.scene_order ?? null,
          reason: 'scene_not_found',
        });
        continue;
      }

      const hasPromptContractPatch =
        scenePatch.prompt_json !== undefined ||
        scenePatch.validated_runtime !== undefined;
      if (
        scenePatch.prompt_json &&
        scenePatch.prompt_json.scene_order !== targetScene.order + 1
      ) {
        return NextResponse.json(
          {
            error: `prompt_json.scene_order must match scene order ${targetScene.order + 1} for scene ${targetScene.id}`,
          },
          { status: 400 }
        );
      }

      const existingPromptContract = getScenePromptContractFromGenerationMeta(
        targetScene.generation_meta
      );
      const resolvedPromptJson =
        scenePatch.prompt_json ?? existingPromptContract?.prompt_json;
      const resolvedRuntime =
        scenePatch.validated_runtime ??
        existingPromptContract?.validated_runtime;
      const compiledPromptContract =
        hasPromptContractPatch && resolvedPromptJson
          ? compileScenePromptContract({
              prompt_json: resolvedPromptJson,
              validated_runtime: resolvedRuntime,
            })
          : null;

      const sceneUpdates: Record<string, unknown> = {};
      if (scenePatch.prompt !== undefined) {
        sceneUpdates.prompt = normalizePrompt(scenePatch.prompt);
      } else if (compiledPromptContract) {
        sceneUpdates.prompt =
          compiledPromptContract.scene_payload.compile_status === 'ready'
            ? compiledPromptContract.scene_payload.prompt
            : null;
      }
      if (scenePatch.multi_prompt !== undefined) {
        sceneUpdates.multi_prompt =
          scenePatch.multi_prompt && scenePatch.multi_prompt.length > 0
            ? scenePatch.multi_prompt.map((p) => p.trim()).filter(Boolean)
            : null;
      }
      if (scenePatch.generation_meta !== undefined || hasPromptContractPatch) {
        const baseGenerationMeta =
          scenePatch.generation_meta !== undefined
            ? scenePatch.generation_meta
            : targetScene.generation_meta;
        sceneUpdates.generation_meta = hasPromptContractPatch
          ? mergeScenePromptContractGenerationMeta({
              // TODO(db): move prompt contract data into dedicated scene columns
              // once migrations are in place; keep additive under generation_meta.
              existing_generation_meta: baseGenerationMeta,
              prompt_json:
                compiledPromptContract?.prompt_json ?? scenePatch.prompt_json,
              validated_runtime:
                scenePatch.validated_runtime ??
                compiledPromptContract?.validated_runtime,
              scene_payload: compiledPromptContract?.scene_payload,
            })
          : baseGenerationMeta;
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

      if (compiledPromptContract) {
        compiledScenes.push({
          scene_id: targetScene.id,
          compiled_prompt: compiledPromptContract.scene_payload.prompt,
          compile_status: compiledPromptContract.scene_payload.compile_status,
          resolved_asset_refs:
            compiledPromptContract.scene_payload.resolved_asset_refs,
          reference_images:
            compiledPromptContract.scene_payload.reference_images,
        });
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

    const responsePayload: Record<string, unknown> = {
      success: true,
      storyboard_id: storyboardId,
      updated_scenes: updatedScenes,
      updated_voiceovers: updatedVoiceovers,
    };

    if (compiledScenes.length > 0) {
      responsePayload.compiled_scenes = compiledScenes;
    }

    if (skippedScenes.length > 0) {
      responsePayload.skipped_scenes = skippedScenes;
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('[v2/storyboard/prompts] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
