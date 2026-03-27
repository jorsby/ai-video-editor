import {
  type CompiledAssetRef,
  type CompiledReferenceImage,
  type CompiledPrompt,
  type CompiledPromptStatus,
  type PromptJSON,
  type ScenePromptContract,
  type ScenePayload,
  type ValidatedRuntime,
  compiledPromptSchema,
  promptJSONSchema,
  sceneGenerationMetaSchema,
  scenePayloadSchema,
  scenePromptContractSchema,
  validatedRuntimeSchema,
} from '@/lib/storyboard/scene-contracts';

export const SCENE_PROMPT_CONTRACT_META_KEY = 'prompt_contract';

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }

  return {};
}

function makeAssetKey(input: {
  slot: string;
  role: string;
  desired_asset_slug: string;
}): string {
  return `${input.slot}::${input.role}::${input.desired_asset_slug}`;
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
        desired_asset_slug: desiredAssetRef.desired_asset_slug,
        resolved_asset_slug: validatedReuse.resolved_asset_slug,
        resolution: 'resolved',
      };
    }

    return {
      slot: desiredAssetRef.slot,
      role: desiredAssetRef.role,
      desired_asset_slug: desiredAssetRef.desired_asset_slug,
      resolved_asset_slug: null,
      resolution: 'missing',
    };
  });
}

function buildReferenceImages(
  resolvedAssetRefs: CompiledAssetRef[],
  runtime: ValidatedRuntime
): CompiledReferenceImage[] {
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

  return resolvedAssetRefs
    .filter(
      (
        assetRef
      ): assetRef is CompiledAssetRef & { resolved_asset_slug: string } =>
        assetRef.resolution === 'resolved' &&
        assetRef.resolved_asset_slug !== null
    )
    .map((assetRef) => {
      const key = makeAssetKey(assetRef);
      const validatedReuse = reuseByKey.get(key);
      const referenceImage = {
        slot: assetRef.slot,
        role: assetRef.role,
        asset_slug: assetRef.resolved_asset_slug,
      };

      if (!validatedReuse?.reference_image_url) {
        return referenceImage;
      }

      return {
        ...referenceImage,
        image_url: validatedReuse.reference_image_url,
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
    return 'blocked';
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
    const resolvedSlug = assetRef.resolved_asset_slug ?? 'MISSING';
    return `- ${assetRef.slot} (${assetRef.role}) => ${resolvedSlug}`;
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
  const referenceImages = buildReferenceImages(resolvedAssetRefs, runtime);

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
    reference_images: referenceImages,
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
    reference_images: compiledPrompt.reference_images,
    blocking_issues: compiledPrompt.validated_runtime.blocking_issues,
  });
}

export function compileScenePromptContract(input: {
  prompt_json: PromptJSON;
  validated_runtime?: ValidatedRuntime;
}): {
  prompt_json: PromptJSON;
  validated_runtime: ValidatedRuntime;
  scene_payload: ScenePayload;
} {
  const promptJson = promptJSONSchema.parse(input.prompt_json);
  const runtime = validatedRuntimeSchema.parse(input.validated_runtime ?? {});
  const compiledPrompt = compileScenePrompt(promptJson, runtime);

  return {
    prompt_json: promptJson,
    validated_runtime: runtime,
    scene_payload: toScenePayload(compiledPrompt),
  };
}

export function getScenePromptContractFromGenerationMeta(
  generationMetaInput: unknown
): ScenePromptContract | null {
  const parsedGenerationMeta = sceneGenerationMetaSchema.safeParse(
    toRecord(generationMetaInput)
  );

  if (!parsedGenerationMeta.success) {
    return null;
  }

  return parsedGenerationMeta.data.prompt_contract ?? null;
}

export function mergeScenePromptContractGenerationMeta(input: {
  existing_generation_meta?: unknown;
  prompt_json?: PromptJSON;
  validated_runtime?: ValidatedRuntime;
  scene_payload?: ScenePayload;
}): Record<string, unknown> {
  const baseGenerationMeta = toRecord(input.existing_generation_meta);
  const existingContract =
    getScenePromptContractFromGenerationMeta(baseGenerationMeta) ?? {};
  const nextContract: ScenePromptContract = { ...existingContract };

  if (input.prompt_json !== undefined) {
    nextContract.prompt_json = promptJSONSchema.parse(input.prompt_json);
  }

  if (input.validated_runtime !== undefined) {
    nextContract.validated_runtime = validatedRuntimeSchema.parse(
      input.validated_runtime
    );
  }

  if (input.scene_payload !== undefined) {
    const scenePayload = scenePayloadSchema.parse(input.scene_payload);
    nextContract.compiled_prompt = scenePayload.prompt;
    nextContract.compile_status = scenePayload.compile_status;
    nextContract.resolved_asset_refs = scenePayload.resolved_asset_refs;
    nextContract.reference_images = scenePayload.reference_images;
    nextContract.blocking_issues = scenePayload.blocking_issues;
  } else if (
    input.prompt_json !== undefined ||
    input.validated_runtime !== undefined
  ) {
    delete nextContract.compiled_prompt;
    delete nextContract.compile_status;
    delete nextContract.resolved_asset_refs;
    delete nextContract.reference_images;
    delete nextContract.blocking_issues;
  }

  if (Object.keys(nextContract).length === 0) {
    delete baseGenerationMeta[SCENE_PROMPT_CONTRACT_META_KEY];
    return baseGenerationMeta;
  }

  baseGenerationMeta[SCENE_PROMPT_CONTRACT_META_KEY] =
    scenePromptContractSchema.parse(nextContract);

  return baseGenerationMeta;
}
