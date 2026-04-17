// Shared scene types and helpers used by storyboard-panel and scene-clip-panel

export interface SceneData {
  id: string;
  order: number;
  title: string | null;
  prompt: string | null;
  structured_prompt: Record<string, unknown>[] | null;
  audio_text: string | null;
  audio_url: string | null;
  audio_duration: number | null;
  video_url: string | null;
  video_duration: number | null;
  status: string | null;
  location_variant_slug: string | null;
  character_variant_slugs: string[];
  prop_variant_slugs: string[];
  tts_status: string;
  video_status: string;
  tts_generation_metadata?: Record<string, unknown> | null;
  video_generation_metadata?: Record<string, unknown> | null;
}

export interface VariantInfo {
  image_url: string | null;
  id: string;
  image_gen_status: string;
  structured_prompt?: Record<string, unknown> | null;
  is_main?: boolean;
  generation_metadata?: Record<string, unknown> | null;
}

export type VariantImageMap = Map<string, VariantInfo>;

export function statusColor(status: string | null): string {
  switch (status) {
    case 'done':
      return 'border-green-500/40 bg-green-500/10 text-green-400';
    case 'partial':
    case 'ready':
      return 'border-blue-500/40 bg-blue-500/10 text-blue-400';
    case 'generating':
      return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400';
    case 'failed':
      return 'border-red-500/40 bg-red-500/10 text-red-400';
    default:
      return 'border-border/60 bg-secondary/20 text-muted-foreground';
  }
}

export function slugToLabel(slug: string): string {
  return slug
    .replace(/-main$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Derive a display status from generation states + URL presence. */
export function deriveSceneStatus(scene: SceneData): string {
  if (scene.tts_status === 'generating' || scene.video_status === 'generating')
    return 'generating';

  const ttsOk = !scene.audio_text?.trim() || !!scene.audio_url;
  const videoOk = !!scene.video_url;

  if (ttsOk && videoOk) return 'done';

  const ttsFailed = scene.tts_status === 'failed' && !scene.audio_url;
  const videoFailed = scene.video_status === 'failed' && !scene.video_url;
  if (ttsFailed || videoFailed) return 'failed';

  if (scene.audio_url || scene.video_url) return 'partial';
  if (scene.prompt) return 'ready';
  return 'draft';
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

export function flattenStructuredPrompt(
  sp: Record<string, unknown> | null | undefined
): string {
  if (!sp) return '';
  return Object.values(sp)
    .filter((v) => v != null && String(v).trim() !== '')
    .map(String)
    .join(', ');
}

export async function callGenerateApi(
  path: string,
  body: Record<string, unknown> = {}
): Promise<{
  ok: boolean;
  task_id?: string;
  error?: string;
  missing_slugs?: string[];
}> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok)
      return {
        ok: false,
        error: data.error ?? `HTTP ${res.status}`,
        missing_slugs: Array.isArray(data.missing_slugs)
          ? data.missing_slugs
          : undefined,
      };
    return { ok: true, task_id: data.task_id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}
