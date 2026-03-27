import { describe, expect, it } from 'vitest';

import { compileScenePrompt } from '@/lib/storyboard/prompt-compiler';
import type {
  PromptJSON,
  ValidatedRuntime,
} from '@/lib/storyboard/scene-contracts';

const basePromptJson: PromptJSON = {
  scene_id: 'ep3-scene-1',
  scene_order: 1,
  canonical_prompt_text:
    'Slow push-in on Elena as she enters the checkpoint corridor, holding tension in silence.',
  desired_scene_intent: {
    narrative_beat: 'Elena crosses the first checkpoint and senses danger.',
    visual_goal:
      'Ground the episode in controlled suspense inside a narrow corridor.',
    emotional_tone: 'Tense and restrained',
    camera_intent: 'Slow push-in from medium-wide to close framing',
  },
  desired_asset_refs: [
    {
      slot: 'lead_character',
      role: 'character',
      desired_asset_id: 'char-elena-v1',
    },
    {
      slot: 'checkpoint_bg',
      role: 'background',
      desired_asset_id: 'bg-corridor-v1',
    },
  ],
};

function createRuntime(
  overrides: Partial<ValidatedRuntime> = {}
): ValidatedRuntime {
  return {
    validated_reuse: [],
    validated_missing_assets: [],
    fallback_options: [],
    blocking_issues: [],
    ...overrides,
  };
}

describe('scene prompt compiler', () => {
  it('compiles happy path with validated references', () => {
    const runtime = createRuntime({
      validated_reuse: [
        {
          slot: 'lead_character',
          role: 'character',
          desired_asset_id: 'char-elena-v1',
          resolved_asset_id: 'char-elena-v1',
          reuse_reason: 'exact_match',
        },
        {
          slot: 'checkpoint_bg',
          role: 'background',
          desired_asset_id: 'bg-corridor-v1',
          resolved_asset_id: 'bg-corridor-v1',
          reuse_reason: 'exact_match',
        },
      ],
    });

    const compiled = compileScenePrompt(basePromptJson, runtime);

    expect(compiled.compile_status).toBe('ready');
    expect(compiled.canonical.desired_scene_intent).toEqual(
      basePromptJson.desired_scene_intent
    );
    expect(compiled.compiled_prompt_text).toContain(
      basePromptJson.canonical_prompt_text
    );
    expect(compiled.resolved_asset_refs).toEqual([
      {
        slot: 'lead_character',
        role: 'character',
        desired_asset_id: 'char-elena-v1',
        resolved_asset_id: 'char-elena-v1',
        resolution: 'validated',
      },
      {
        slot: 'checkpoint_bg',
        role: 'background',
        desired_asset_id: 'bg-corridor-v1',
        resolved_asset_id: 'bg-corridor-v1',
        resolution: 'validated',
      },
    ]);
  });

  it('merges validated reuse even when runtime maps to a compatible variant', () => {
    const runtime = createRuntime({
      validated_reuse: [
        {
          slot: 'lead_character',
          role: 'character',
          desired_asset_id: 'char-elena-v1',
          resolved_asset_id: 'char-elena-v2',
          reuse_reason: 'compatible_variant',
          notes: 'closest approved look for EP3',
        },
        {
          slot: 'checkpoint_bg',
          role: 'background',
          desired_asset_id: 'bg-corridor-v1',
          resolved_asset_id: 'bg-corridor-v1',
          reuse_reason: 'exact_match',
        },
      ],
    });

    const compiled = compileScenePrompt(basePromptJson, runtime);
    const leadCharacterRef = compiled.resolved_asset_refs.find(
      (assetRef) => assetRef.slot === 'lead_character'
    );

    expect(compiled.compile_status).toBe('ready');
    expect(leadCharacterRef).toEqual({
      slot: 'lead_character',
      role: 'character',
      desired_asset_id: 'char-elena-v1',
      resolved_asset_id: 'char-elena-v2',
      resolution: 'validated',
    });
  });

  it('preserves missing asset and fallback metadata from validated runtime', () => {
    const runtime = createRuntime({
      validated_reuse: [
        {
          slot: 'checkpoint_bg',
          role: 'background',
          desired_asset_id: 'bg-corridor-v1',
          resolved_asset_id: 'bg-corridor-v1',
          reuse_reason: 'exact_match',
        },
      ],
      validated_missing_assets: [
        {
          slot: 'lead_character',
          role: 'character',
          desired_asset_id: 'char-elena-v1',
          reason: 'no approved variant in this episode context',
        },
      ],
      fallback_options: [
        {
          slot: 'lead_character',
          role: 'character',
          strategy: 'reuse_existing',
          fallback_asset_id: 'char-elena-v0',
          rationale: 'closest silhouette continuity',
        },
      ],
    });

    const compiled = compileScenePrompt(basePromptJson, runtime);

    expect(compiled.compile_status).toBe('needs_fallback');
    expect(compiled.validated_runtime.validated_missing_assets).toEqual(
      runtime.validated_missing_assets
    );
    expect(compiled.validated_runtime.fallback_options).toEqual(
      runtime.fallback_options
    );
    expect(compiled.compiled_prompt_text).toContain('MISSING');
  });

  it('does not let fallback metadata overwrite canonical desired_scene_intent', () => {
    const runtime = createRuntime({
      validated_reuse: [
        {
          slot: 'checkpoint_bg',
          role: 'background',
          desired_asset_id: 'bg-corridor-v1',
          resolved_asset_id: 'bg-corridor-v1',
          reuse_reason: 'exact_match',
        },
      ],
      validated_missing_assets: [
        {
          slot: 'lead_character',
          role: 'character',
          desired_asset_id: 'char-elena-v1',
          reason: 'lead character missing approval',
        },
      ],
      fallback_options: [
        {
          slot: 'lead_character',
          role: 'character',
          strategy: 'generate_new',
          rationale: 'no reusable approved variant available',
          suggested_scene_intent_override:
            'Move scene to rooftop at sunrise with different emotional tone',
        },
      ],
    });

    const compiled = compileScenePrompt(basePromptJson, runtime);

    expect(compiled.canonical.desired_scene_intent.visual_goal).toBe(
      basePromptJson.desired_scene_intent.visual_goal
    );
    expect(compiled.canonical.canonical_prompt_text).toBe(
      basePromptJson.canonical_prompt_text
    );
    expect(compiled.compiled_prompt_text).not.toContain(
      'Move scene to rooftop at sunrise with different emotional tone'
    );
  });
});
