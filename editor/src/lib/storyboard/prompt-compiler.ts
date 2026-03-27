import {
  type CompiledAssetRef,
  type CompiledPrompt,
  type CompiledPromptStatus,
  type PromptJSON,
  type ScenePayload,
  type ValidatedRuntime,
  compiledPromptSchema,
  promptJSONSchema,
  scenePayloadSchema,
  validatedRuntimeSchema,
} from '@/lib/storyboard/scene-contracts';

function makeAssetKey(input: {
  slot: string;
  role: string;
  desired_asset_id: string;
}): string {
  return `${input.slot}::${input.role}::${input.desired_asset_id}`;
}

function buildResolvedAssetRefs(
  promptJson: PromptJSON,
  runtime: ValidatedRuntime
): CompiledAssetRef[] {
  const reuseByKey = new Map<
    string,
    ValidatedRuntime['validated_reuse'][number]
  >();

  for (const reuseItem of runtime.validated_reuse) {
    const key = makeAssetKey(reuseItem);
    if (!reuseByKey.has(key)) {
      reuseByKey.set(key, reuseItem);
    }
  }

  return promptJson.desired_asset_refs.map((desiredAssetRef) => {
    const key = makeAssetKey(desiredAssetRef);
    const validatedReuse = reuseByKey.get(key);

    if (validatedReuse) {
      return {
        slot: desiredAssetRef.slot,
        role: desiredAssetRef.role,
        desired_asset_id: desiredAssetRef.desired_asset_id,
        resolved_asset_id: validatedReuse.resolved_asset_id,
        resolution: 'validated',
      };
    }

    return {
      slot: desiredAssetRef.slot,
      role: desiredAssetRef.role,
      desired_asset_id: desiredAssetRef.desired_asset_id,
      resolved_asset_id: null,
      resolution: 'missing',
    };
  });
}

function resolveCompileStatus(input: {
  runtime: ValidatedRuntime;
  resolvedAssetRefs: CompiledAssetRef[];
}): CompiledPromptStatus {
  if (input.runtime.blocking_issues.length > 0) {
    return 'blocked';
  }

  if (
    input.runtime.validated_missing_assets.length > 0 ||
    input.resolvedAssetRefs.some(
      (assetRef) => assetRef.resolution === 'missing'
    )
  ) {
    return 'needs_fallback';
  }

  return 'ready';
}

function buildCompiledPromptText(
  promptJson: PromptJSON,
  resolvedAssetRefs: CompiledAssetRef[]
): string {
  if (resolvedAssetRefs.length === 0) {
    return `${promptJson.canonical_prompt_text}\n\n[validated_runtime_refs]\n- none`;
  }

  const runtimeRefLines = resolvedAssetRefs.map((assetRef) => {
    const resolvedId = assetRef.resolved_asset_id ?? 'MISSING';
    return `- ${assetRef.slot} (${assetRef.role}) => ${resolvedId}`;
  });

  return `${promptJson.canonical_prompt_text}\n\n[validated_runtime_refs]\n${runtimeRefLines.join('\n')}`;
}

export function compileScenePrompt(
  promptJsonInput: PromptJSON,
  runtimeInput: ValidatedRuntime
): CompiledPrompt {
  const promptJson = promptJSONSchema.parse(promptJsonInput);
  const runtime = validatedRuntimeSchema.parse(runtimeInput);

  const resolvedAssetRefs = buildResolvedAssetRefs(promptJson, runtime);
  const compileStatus = resolveCompileStatus({
    runtime,
    resolvedAssetRefs,
  });

  return compiledPromptSchema.parse({
    scene_id: promptJson.scene_id,
    scene_order: promptJson.scene_order,
    canonical: {
      canonical_prompt_text: promptJson.canonical_prompt_text,
      desired_scene_intent: promptJson.desired_scene_intent,
      desired_asset_refs: promptJson.desired_asset_refs,
    },
    validated_runtime: runtime,
    compile_status: compileStatus,
    compiled_prompt_text: buildCompiledPromptText(
      promptJson,
      resolvedAssetRefs
    ),
    resolved_asset_refs: resolvedAssetRefs,
  });
}

export function toScenePayload(
  compiledPromptInput: CompiledPrompt
): ScenePayload {
  const compiledPrompt = compiledPromptSchema.parse(compiledPromptInput);

  return scenePayloadSchema.parse({
    scene_id: compiledPrompt.scene_id,
    scene_order: compiledPrompt.scene_order,
    prompt: compiledPrompt.compiled_prompt_text,
    compile_status: compiledPrompt.compile_status,
    desired_scene_intent: compiledPrompt.canonical.desired_scene_intent,
    resolved_asset_refs: compiledPrompt.resolved_asset_refs,
    blocking_issues: compiledPrompt.validated_runtime.blocking_issues,
  });
}
