import { z } from 'zod';

const slotSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'slot must be snake_case');

const assetSlugSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'asset_slug must be lowercase kebab-case'
  );

function enforceUniqueSlots(
  items: Array<{ slot: string }>,
  ctx: z.RefinementCtx
): void {
  const seenSlots = new Set<string>();

  for (const [index, item] of items.entries()) {
    if (!seenSlots.has(item.slot)) {
      seenSlots.add(item.slot);
      continue;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `duplicate slot: ${item.slot}`,
      path: [index, 'slot'],
    });
  }
}

export const storyboardAssetRoleSchema = z.enum([
  'character',
  'object',
  'background',
]);

export const desiredSceneIntentSchema = z.object({
  narrative_beat: z.string().min(1),
  visual_goal: z.string().min(1),
  emotional_tone: z.string().min(1),
  camera_intent: z.string().min(1),
});

export const desiredAssetRefSchema = z.object({
  slot: slotSchema,
  role: storyboardAssetRoleSchema,
  desired_asset_slug: assetSlugSchema,
  usage_notes: z.string().optional(),
});

const desiredAssetRefsSchema = z
  .array(desiredAssetRefSchema)
  .default([])
  .superRefine(enforceUniqueSlots);

export const promptJSONSchema = z.object({
  scene_id: z.string().min(1),
  scene_order: z.number().int().positive(),
  canonical_prompt_text: z.string().min(1),
  desired_scene_intent: desiredSceneIntentSchema,
  desired_asset_refs: desiredAssetRefsSchema,
});

export const validatedReuseItemSchema = z.object({
  slot: slotSchema,
  role: storyboardAssetRoleSchema,
  desired_asset_slug: assetSlugSchema,
  resolved_asset_slug: assetSlugSchema,
  reuse_reason: z.enum(['exact_match']),
  reference_image_url: z.string().url().optional(),
  notes: z.string().optional(),
});

export const validatedMissingAssetSchema = z.object({
  slot: slotSchema,
  role: storyboardAssetRoleSchema,
  desired_asset_slug: assetSlugSchema,
  reason: z.string().min(1),
});

export const blockingIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  slot: slotSchema.optional(),
});

export const validatedRuntimeSchema = z
  .object({
    validated_reuse: z
      .array(validatedReuseItemSchema)
      .default([])
      .superRefine(enforceUniqueSlots),
    validated_missing_assets: z
      .array(validatedMissingAssetSchema)
      .default([])
      .superRefine(enforceUniqueSlots),
    blocking_issues: z.array(blockingIssueSchema).default([]),
  })
  .superRefine((runtime, ctx) => {
    const resolvedSlots = new Set(
      runtime.validated_reuse.map((item) => item.slot)
    );

    for (const [
      index,
      missingAsset,
    ] of runtime.validated_missing_assets.entries()) {
      if (!resolvedSlots.has(missingAsset.slot)) {
        continue;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `slot cannot be both resolved and missing: ${missingAsset.slot}`,
        path: ['validated_missing_assets', index, 'slot'],
      });
    }
  });

export const compiledPromptStatusSchema = z.enum(['ready', 'blocked']);

export const compiledAssetRefSchema = z.object({
  slot: slotSchema,
  role: storyboardAssetRoleSchema,
  desired_asset_slug: assetSlugSchema,
  resolved_asset_slug: assetSlugSchema.nullable(),
  resolution: z.enum(['resolved', 'missing']),
});

export const compiledReferenceImageSchema = z.object({
  slot: slotSchema,
  role: storyboardAssetRoleSchema,
  asset_slug: assetSlugSchema,
  image_url: z.string().url().optional(),
});

export const compiledPromptSchema = z.object({
  scene_id: z.string().min(1),
  scene_order: z.number().int().positive(),
  canonical: z.object({
    canonical_prompt_text: z.string().min(1),
    desired_scene_intent: desiredSceneIntentSchema,
    desired_asset_refs: desiredAssetRefsSchema,
  }),
  validated_runtime: validatedRuntimeSchema,
  compile_status: compiledPromptStatusSchema,
  compiled_prompt_text: z.string().min(1),
  resolved_asset_refs: z.array(compiledAssetRefSchema),
  reference_images: z.array(compiledReferenceImageSchema),
});

export const scenePayloadSchema = z.object({
  scene_id: z.string().min(1),
  scene_order: z.number().int().positive(),
  prompt: z.string().min(1),
  compile_status: compiledPromptStatusSchema,
  desired_scene_intent: desiredSceneIntentSchema,
  resolved_asset_refs: z.array(compiledAssetRefSchema),
  reference_images: z.array(compiledReferenceImageSchema),
  blocking_issues: z.array(blockingIssueSchema),
});

export const scenePromptContractSchema = z.object({
  prompt_json: promptJSONSchema.optional(),
  validated_runtime: validatedRuntimeSchema.optional(),
  compiled_prompt: z.string().min(1).optional(),
  compile_status: compiledPromptStatusSchema.optional(),
  resolved_asset_refs: z.array(compiledAssetRefSchema).optional(),
  reference_images: z.array(compiledReferenceImageSchema).optional(),
  blocking_issues: z.array(blockingIssueSchema).optional(),
});

export const sceneGenerationMetaSchema = z
  .object({
    prompt_contract: scenePromptContractSchema.optional(),
  })
  .passthrough();

export type StoryboardAssetRole = z.infer<typeof storyboardAssetRoleSchema>;
export type DesiredSceneIntent = z.infer<typeof desiredSceneIntentSchema>;
export type DesiredAssetRef = z.infer<typeof desiredAssetRefSchema>;
export type PromptJSON = z.infer<typeof promptJSONSchema>;
export type ValidatedReuseItem = z.infer<typeof validatedReuseItemSchema>;
export type ValidatedMissingAsset = z.infer<typeof validatedMissingAssetSchema>;
export type BlockingIssue = z.infer<typeof blockingIssueSchema>;
export type ValidatedRuntime = z.infer<typeof validatedRuntimeSchema>;
export type CompiledPromptStatus = z.infer<typeof compiledPromptStatusSchema>;
export type CompiledAssetRef = z.infer<typeof compiledAssetRefSchema>;
export type CompiledReferenceImage = z.infer<
  typeof compiledReferenceImageSchema
>;
export type CompiledPrompt = z.infer<typeof compiledPromptSchema>;
export type ScenePayload = z.infer<typeof scenePayloadSchema>;
export type ScenePromptContract = z.infer<typeof scenePromptContractSchema>;
export type SceneGenerationMeta = z.infer<typeof sceneGenerationMetaSchema>;
