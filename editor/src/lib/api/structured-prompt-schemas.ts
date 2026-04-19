import { NextResponse } from 'next/server';
import { z, type ZodIssue } from 'zod';

// ---------------------------------------------------------------------------
// Locked `structured_prompt` shapes (one per table)
// ---------------------------------------------------------------------------

export const CharacterSPSchema = z
  .object({
    age: z.number().int().nonnegative(),
    gender: z.string().min(1),
    era: z.string().min(1),
    appearance: z.string().min(1),
    outfit: z.string().min(1),
    extras: z.string().min(1).optional(),
  })
  .strict();

export const LocationSPSchema = z
  .object({
    setting_type: z.string().min(1),
    time_of_day: z.string().min(1),
    era: z.string().min(1),
    extras: z.string().min(1).optional(),
  })
  .strict();

export const PropSPSchema = z
  .object({
    prompt: z.string().min(1),
    brand: z.string().min(1).optional(),
  })
  .strict();

export const SceneShotSchema = z
  .object({
    order: z.number().int().nonnegative(),
    shot_type: z.string().min(1),
    camera_movement: z.string().min(1),
    action: z.string().min(1),
    lighting: z.string().min(1),
    mood: z.string().min(1),
    setting_notes: z.string().min(1).optional(),
    duration_hint: z.number().positive().optional(),
  })
  .strict();

export const SceneSPSchema = z.array(SceneShotSchema).min(1);

const MusicBase = z.object({
  genre: z.string().min(1),
  mood: z.string().min(1),
  instrumentation: z.string().min(1),
  tempo_bpm: z.number().int().positive().optional(),
});

export const MusicSPSchema = z.discriminatedUnion('is_instrumental', [
  MusicBase.extend({ is_instrumental: z.literal(true) }).strict(),
  MusicBase.extend({
    is_instrumental: z.literal(false),
    lyrics: z.string().min(1),
  }).strict(),
]);

// Partial variants (for PATCH + variant overlay on parent)
export const CharacterSPPartialSchema = CharacterSPSchema.partial();
export const LocationSPPartialSchema = LocationSPSchema.partial();
export const PropSPPartialSchema = PropSPSchema.partial();

// ---------------------------------------------------------------------------
// Inferred types — reuse these in hooks and composers
// ---------------------------------------------------------------------------

export type CharacterSP = z.infer<typeof CharacterSPSchema>;
export type LocationSP = z.infer<typeof LocationSPSchema>;
export type PropSP = z.infer<typeof PropSPSchema>;
export type SceneShot = z.infer<typeof SceneShotSchema>;
export type SceneSP = z.infer<typeof SceneSPSchema>;
export type MusicSP = z.infer<typeof MusicSPSchema>;

// ---------------------------------------------------------------------------
// `expected` maps — attached to 400 error bodies so callers self-correct.
// Kept as plain dictionaries (not derived from zod) so optional/required
// hints stay human-readable.
// ---------------------------------------------------------------------------

export const EXPECTED_CHARACTER_SP: Record<string, string> = {
  age: 'number',
  gender: 'string',
  era: 'string',
  appearance: 'string',
  outfit: 'string',
  extras: 'string (optional)',
};

export const EXPECTED_LOCATION_SP: Record<string, string> = {
  setting_type: 'string',
  time_of_day: 'string',
  era: 'string',
  extras: 'string (optional)',
};

export const EXPECTED_PROP_SP: Record<string, string> = {
  prompt: 'string',
  brand: 'string (optional)',
};

export const EXPECTED_SCENE_SHOT: Record<string, string> = {
  order: 'number',
  shot_type: 'string',
  camera_movement: 'string',
  action: 'string',
  lighting: 'string',
  mood: 'string',
  setting_notes: 'string (optional)',
  duration_hint: 'number (optional)',
};

export const EXPECTED_SCENE_SP: Record<string, string> = {
  shots:
    'array of scene-shot objects (min 1) — each shot uses the scene-shot schema',
  ...Object.fromEntries(
    Object.entries(EXPECTED_SCENE_SHOT).map(([k, v]) => [`shots[].${k}`, v])
  ),
};

export const EXPECTED_MUSIC_SP: Record<string, string> = {
  is_instrumental: 'boolean',
  genre: 'string',
  mood: 'string',
  instrumentation: 'string',
  tempo_bpm: 'number (optional)',
  lyrics:
    'string (required only when is_instrumental=false; must be absent when true)',
};

// ---------------------------------------------------------------------------
// Issue → friendly reason
// ---------------------------------------------------------------------------

function zodIssueToReason(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type': {
      const received = (issue as { received?: unknown }).received;
      if (received === 'undefined') return 'required field missing';
      const expected = (issue as { expected?: unknown }).expected;
      return `must be ${String(expected ?? 'correct type')}`;
    }
    case 'too_small': {
      const min = (issue as { minimum?: unknown }).minimum;
      if (min === 1) return 'must be non-empty';
      return `must be at least ${String(min)}`;
    }
    case 'unrecognized_keys': {
      const keys =
        (issue as { keys?: readonly string[] }).keys?.join(', ') ?? '';
      return `must be absent when is_instrumental=true (unrecognized: ${keys})`;
    }
    case 'invalid_union':
    case 'invalid_value':
      return issue.message || 'invalid discriminator value';
    default:
      return issue.message || 'invalid value';
  }
}

function issuePath(issue: ZodIssue): string {
  if (!issue.path.length) return '(root)';
  return issue.path
    .map((p) => (typeof p === 'number' ? `[${p}]` : String(p)))
    .join('.')
    .replace(/\.\[/g, '[');
}

// ---------------------------------------------------------------------------
// Validator entry point
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; response: NextResponse };

type ParseableSchema = {
  safeParse: (
    input: unknown
  ) =>
    | { success: true; data: unknown }
    | { success: false; error: { issues: ZodIssue[] } };
};

/**
 * Parse `input` against `schema`. On failure, return a ready-to-send 400
 * NextResponse using the shared envelope
 *   { error, path, reason, expected }
 *
 * `expected` is the endpoint's field→type hint map (one of the
 * EXPECTED_* constants above, or a composition of them for scenes).
 *
 * Optional `pathPrefix` lets callers scope the failure path to where the
 * structured_prompt sits in their request (e.g. "scenes[0].structured_prompt").
 *
 * The return `value` is typed `unknown`; callers cast to the concrete inferred
 * type (e.g. `CharacterSP`) since the generic narrow for zod-v4 discriminated
 * union / strict-object schemas isn't ergonomic.
 */
export function validateStructuredPrompt(
  schema: ParseableSchema,
  input: unknown,
  expected: Record<string, string>,
  pathPrefix?: string
): ValidationResult {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };

  const issue = parsed.error.issues[0];
  const rawPath = issuePath(issue);
  const path = pathPrefix
    ? rawPath === '(root)'
      ? pathPrefix
      : `${pathPrefix}.${rawPath}`
    : rawPath;
  const reason = zodIssueToReason(issue);

  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'structured_prompt is invalid',
        path,
        reason,
        expected,
      },
      { status: 400 }
    ),
  };
}
