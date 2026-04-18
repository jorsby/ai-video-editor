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

export async function getVideoStyleForProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<string | null> {
  const { data: project, error } = await supabase
    .from('projects')
    .select('generation_settings')
    .eq('id', projectId)
    .maybeSingle();

  if (error) {
    console.warn(
      '[style-injector] Failed to load project generation_settings:',
      error.message
    );
    return null;
  }

  if (!project) return null;

  const settings = isRecord(project.generation_settings)
    ? project.generation_settings
    : null;
  if (!settings) return null;

  // Structured style block (preferred): settings.metadata.style or settings.style
  const structuredStyle =
    (isRecord(settings.metadata) && isRecord(settings.metadata.style)
      ? settings.metadata.style
      : null) ?? (isRecord(settings.style) ? settings.style : null);

  if (structuredStyle) {
    const styleEntries = Object.entries(structuredStyle)
      .filter(([, value]) => typeof value === 'string')
      .map(([key, value]) => [key, value as string]);
    if (styleEntries.length > 0) {
      const serialized = serializeStyleToPromptSuffix(
        Object.fromEntries(styleEntries)
      );
      if (serialized) return serialized;
    }
  }

  // Fallback: flat `visual_style` string.
  const flat = toNonEmptyString(settings.visual_style);
  return flat
    ? serializeStyleToPromptSuffix({ visual_style: flat }) || null
    : null;
}
