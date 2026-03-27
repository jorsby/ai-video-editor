import { z } from 'zod';

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
  slot: z.string().min(1),
  role: storyboardAssetRoleSchema,
  desired_asset_id: z.string().min(1),
  usage_notes: z.string().optional(),
});

export const promptJSONSchema = z.object({
  scene_id: z.string().min(1),
  scene_order: z.number().int().positive(),
  canonical_prompt_text: z.string().min(1),
  desired_scene_intent: desiredSceneIntentSchema,
  desired_asset_refs: z.array(desiredAssetRefSchema).default([]),
});

export const validatedReuseItemSchema = z.object({
  slot: z.string().min(1),
  role: storyboardAssetRoleSchema,
  desired_asset_id: z.string().min(1),
  resolved_asset_id: z.string().min(1),
  reuse_reason: z.enum(['exact_match', 'compatible_variant', 'fallback_reuse']),
  notes: z.string().optional(),
});

export const validatedMissingAssetSchema = z.object({
  slot: z.string().min(1),
  role: storyboardAssetRoleSchema,
  desired_asset_id: z.string().min(1),
  reason: z.string().min(1),
});

export const fallbackOptionSchema = z.object({
  slot: z.string().min(1),
  role: storyboardAssetRoleSchema,
  strategy: z.enum(['reuse_existing', 'generate_new', 'omit_reference']),
  fallback_asset_id: z.string().min(1).optional(),
  rationale: z.string().min(1),
  suggested_scene_intent_override: z.string().min(1).optional(),
});

export const blockingIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  slot: z.string().min(1).optional(),
});

export const validatedRuntimeSchema = z.object({
  validated_reuse: z.array(validatedReuseItemSchema).default([]),
  validated_missing_assets: z.array(validatedMissingAssetSchema).default([]),
  fallback_options: z.array(fallbackOptionSchema).default([]),
  blocking_issues: z.array(blockingIssueSchema).default([]),
});

export const compiledPromptStatusSchema = z.enum([
  'ready',
  'needs_fallback',
  'blocked',
]);

export const compiledAssetRefSchema = z.object({
  slot: z.string().min(1),
  role: storyboardAssetRoleSchema,
  desired_asset_id: z.string().min(1),
  resolved_asset_id: z.string().min(1).nullable(),
  resolution: z.enum(['validated', 'missing']),
});

export const compiledPromptSchema = z.object({
  scene_id: z.string().min(1),
  scene_order: z.number().int().positive(),
  canonical: z.object({
    canonical_prompt_text: z.string().min(1),
    desired_scene_intent: desiredSceneIntentSchema,
    desired_asset_refs: z.array(desiredAssetRefSchema),
  }),
  validated_runtime: validatedRuntimeSchema,
  compile_status: compiledPromptStatusSchema,
  compiled_prompt_text: z.string().min(1),
  resolved_asset_refs: z.array(compiledAssetRefSchema),
});

export const scenePayloadSchema = z.object({
  scene_id: z.string().min(1),
  scene_order: z.number().int().positive(),
  prompt: z.string().min(1),
  compile_status: compiledPromptStatusSchema,
  desired_scene_intent: desiredSceneIntentSchema,
  resolved_asset_refs: z.array(compiledAssetRefSchema),
  blocking_issues: z.array(blockingIssueSchema),
});

export type StoryboardAssetRole = z.infer<typeof storyboardAssetRoleSchema>;
export type DesiredSceneIntent = z.infer<typeof desiredSceneIntentSchema>;
export type DesiredAssetRef = z.infer<typeof desiredAssetRefSchema>;
export type PromptJSON = z.infer<typeof promptJSONSchema>;
export type ValidatedReuseItem = z.infer<typeof validatedReuseItemSchema>;
export type ValidatedMissingAsset = z.infer<typeof validatedMissingAssetSchema>;
export type FallbackOption = z.infer<typeof fallbackOptionSchema>;
export type BlockingIssue = z.infer<typeof blockingIssueSchema>;
export type ValidatedRuntime = z.infer<typeof validatedRuntimeSchema>;
export type CompiledPromptStatus = z.infer<typeof compiledPromptStatusSchema>;
export type CompiledAssetRef = z.infer<typeof compiledAssetRefSchema>;
export type CompiledPrompt = z.infer<typeof compiledPromptSchema>;
export type ScenePayload = z.infer<typeof scenePayloadSchema>;
