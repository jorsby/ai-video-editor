import { describe, expect, it } from 'vitest';

import {
  compileScenePrompt,
  compileScenePromptContract,
  getScenePromptContractFromGenerationMeta,
  mergeScenePromptContractGenerationMeta,
} from '@/lib/storyboard/prompt-compiler';
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
      desired_asset_slug: 'char-elena-v1',
    },
    {
      slot: 'checkpoint_bg',
      role: 'background',
      desired_asset_slug: 'bg-corridor-v1',
    },
  ],
};

function createRuntime(
  overrides: Partial<ValidatedRuntime> = {}
): ValidatedRuntime {
  return {
    validated_reuse: [],
    validated_missing_assets: [],
    blocking_issues: [],
    ...overrides,
  };
}

describe('scene prompt compiler', () => {
  it('compiles ready path with resolved slugs and structured reference images', () => {
    const runtime = createRuntime({
      validated_reuse: [
        {
          slot: 'lead_character',
          role: 'character',
          desired_asset_slug: 'char-elena-v1',
          resolved_asset_slug: 'char-elena-v1',
          reuse_reason: 'exact_match',
          reference_image_url:
            'https://cdn.example.com/assets/char-elena-v1.png',
        },
        {
          slot: 'checkpoint_bg',
          role: 'background',
          desired_asset_slug: 'bg-corridor-v1',
          resolved_asset_slug: 'bg-corridor-v1',
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
        desired_asset_slug: 'char-elena-v1',
        resolved_asset_slug: 'char-elena-v1',
        resolution: 'resolved',
      },
      {
        slot: 'checkpoint_bg',
        role: 'background',
        desired_asset_slug: 'bg-corridor-v1',
        resolved_asset_slug: 'bg-corridor-v1',
        resolution: 'resolved',
      },
    ]);
    expect(compiled.reference_images).toEqual([
      {
        slot: 'lead_character',
        role: 'character',
        asset_slug: 'char-elena-v1',
        image_url: 'https://cdn.example.com/assets/char-elena-v1.png',
      },
      {
        slot: 'checkpoint_bg',
        role: 'background',
        asset_slug: 'bg-corridor-v1',
      },
    ]);
  });

  it('marks compile status as blocked when any desired slot is unresolved', () => {
    const runtime = createRuntime({
      validated_reuse: [
        {
          slot: 'checkpoint_bg',
          role: 'background',
          desired_asset_slug: 'bg-corridor-v1',
          resolved_asset_slug: 'bg-corridor-v1',
          reuse_reason: 'exact_match',
          reference_image_url:
            'https://cdn.example.com/assets/bg-corridor-v1.png',
        },
      ],
      validated_missing_assets: [
        {
          slot: 'lead_character',
          role: 'character',
          desired_asset_slug: 'char-elena-v1',
          reason: 'no approved asset for this slug',
        },
      ],
    });

    const compiled = compileScenePrompt(basePromptJson, runtime);

    expect(compiled.compile_status).toBe('blocked');
    expect(compiled.validated_runtime.validated_missing_assets).toEqual(
      runtime.validated_missing_assets
    );
    expect(compiled.compiled_prompt_text).toContain('MISSING');
    expect(compiled.reference_images).toEqual([
      {
        slot: 'checkpoint_bg',
        role: 'background',
        asset_slug: 'bg-corridor-v1',
        image_url: 'https://cdn.example.com/assets/bg-corridor-v1.png',
      },
    ]);
  });

  it('keeps canonical intent unchanged regardless of runtime metadata', () => {
    const runtime = createRuntime({
      validated_reuse: [
        {
          slot: 'lead_character',
          role: 'character',
          desired_asset_slug: 'char-elena-v1',
          resolved_asset_slug: 'char-elena-v1',
          reuse_reason: 'exact_match',
          notes: 'alternate framing idea that should never override intent',
        },
        {
          slot: 'checkpoint_bg',
          role: 'background',
          desired_asset_slug: 'bg-corridor-v1',
          resolved_asset_slug: 'bg-corridor-v1',
          reuse_reason: 'exact_match',
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
      'alternate framing idea that should never override intent'
    );
  });

  it('marks compile status as blocked when explicit blocking issues exist', () => {
    const runtime = createRuntime({
      validated_reuse: [
        {
          slot: 'lead_character',
          role: 'character',
          desired_asset_slug: 'char-elena-v1',
          resolved_asset_slug: 'char-elena-v1',
          reuse_reason: 'exact_match',
        },
        {
          slot: 'checkpoint_bg',
          role: 'background',
          desired_asset_slug: 'bg-corridor-v1',
          resolved_asset_slug: 'bg-corridor-v1',
          reuse_reason: 'exact_match',
        },
      ],
      blocking_issues: [
        {
          code: 'contract_violation',
          message: 'downstream provider payload validation failed',
        },
      ],
    });

    const compiled = compileScenePrompt(basePromptJson, runtime);

    expect(compiled.compile_status).toBe('blocked');
  });

  it('rejects duplicate desired slots', () => {
    const invalidPromptJson: PromptJSON = {
      ...basePromptJson,
      desired_asset_refs: [
        {
          slot: 'lead_character',
          role: 'character',
          desired_asset_slug: 'char-elena-v1',
        },
        {
          slot: 'lead_character',
          role: 'background',
          desired_asset_slug: 'bg-corridor-v1',
        },
      ],
    };

    expect(() => {
      compileScenePrompt(invalidPromptJson, createRuntime());
    }).toThrow('duplicate slot: lead_character');
  });

  it('compiles contract payload with deterministic default runtime', () => {
    const compiledContract = compileScenePromptContract({
      prompt_json: basePromptJson,
    });

    expect(compiledContract.validated_runtime).toEqual({
      validated_reuse: [],
      validated_missing_assets: [],
      blocking_issues: [],
    });
    expect(compiledContract.scene_payload.compile_status).toBe('blocked');
  });

  it('merges contract payload into generation_meta without dropping existing metadata', () => {
    const readyRuntime = createRuntime({
      validated_reuse: [
        {
          slot: 'lead_character',
          role: 'character',
          desired_asset_slug: 'char-elena-v1',
          resolved_asset_slug: 'char-elena-v1',
          reuse_reason: 'exact_match',
        },
        {
          slot: 'checkpoint_bg',
          role: 'background',
          desired_asset_slug: 'bg-corridor-v1',
          resolved_asset_slug: 'bg-corridor-v1',
          reuse_reason: 'exact_match',
        },
      ],
    });
    const compiledContract = compileScenePromptContract({
      prompt_json: basePromptJson,
      validated_runtime: readyRuntime,
    });

    const mergedGenerationMeta = mergeScenePromptContractGenerationMeta({
      existing_generation_meta: {
        model: 'grok-imagine/image-to-video',
        duration_seconds: 10,
      },
      prompt_json: compiledContract.prompt_json,
      validated_runtime: compiledContract.validated_runtime,
      scene_payload: compiledContract.scene_payload,
    });

    expect(mergedGenerationMeta.model).toBe('grok-imagine/image-to-video');
    expect(mergedGenerationMeta.duration_seconds).toBe(10);

    const storedContract =
      getScenePromptContractFromGenerationMeta(mergedGenerationMeta);
    expect(storedContract?.compile_status).toBe('ready');
    expect(storedContract?.compiled_prompt).toContain(
      basePromptJson.canonical_prompt_text
    );
    expect(storedContract?.resolved_asset_refs).toHaveLength(2);
  });
});
