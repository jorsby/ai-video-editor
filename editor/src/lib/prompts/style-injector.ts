import type { SupabaseClient } from '@supabase/supabase-js';

const STYLE_FIELD_ORDER = [
  'visual_style',
  'setting',
  'time_period',
  'color_palette',
  'lighting',
  'mood',
  'camera_style',
  'custom_notes',
] as const;

const STYLE_LABELS: Record<string, string> = {
  visual_style: 'Visual style',
  setting: 'Setting',
  time_period: 'Time period',
  color_palette: 'Color palette',
  lighting: 'Lighting',
  mood: 'Mood',
  camera_style: 'Camera',
  custom_notes: 'Notes',
};

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toReadableLabel(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((part, idx) =>
      idx === 0
        ? part.charAt(0).toUpperCase() + part.slice(1)
        : part.toLowerCase()
    )
    .join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function appendField(
  parts: string[],
  label: string,
  rawValue: string | undefined
): void {
  const value = toNonEmptyString(rawValue);
  if (!value) return;
  parts.push(`${label}: ${value}.`);
}

export function serializeStyleToPromptSuffix(
  style: Record<string, string>
): string {
  const parts: string[] = [];

  for (const key of STYLE_FIELD_ORDER) {
    appendField(parts, STYLE_LABELS[key], style[key]);
  }

  for (const [key, value] of Object.entries(style)) {
    if (key in STYLE_LABELS) continue;
    appendField(parts, toReadableLabel(key), value);
  }

  return parts.join(' ');
}

export async function getSeriesStyleForProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<string | null> {
  const { data: series, error } = await supabase
    .from('series')
    .select('metadata')
    .eq('project_id', projectId)
    .maybeSingle();

  if (error) {
    console.warn(
      '[style-injector] Failed to load series metadata for project:',
      error.message
    );
    return null;
  }

  if (
    !series ||
    !isRecord(series.metadata) ||
    !isRecord(series.metadata.style)
  ) {
    return null;
  }

  const styleEntries = Object.entries(series.metadata.style)
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => [key, value as string]);

  if (styleEntries.length === 0) {
    return null;
  }

  const style = Object.fromEntries(styleEntries);
  const serialized = serializeStyleToPromptSuffix(style);

  return serialized || null;
}
