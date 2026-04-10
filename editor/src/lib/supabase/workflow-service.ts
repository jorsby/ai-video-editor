import type {
  CompiledAssetRef,
  CompiledPromptStatus,
  CompiledReferenceImage,
  PromptJSON,
  ValidatedRuntime,
} from '@/lib/storyboard/scene-contracts';

// ── Video production metadata ───────────────────────────────────────────────

export interface VideoProductionMeta {
  scene_mode?: 'narrative' | 'cinematic';
  chapter_count?: number;
  aspect_ratio?: string;
  language?: string;
  voice_id?: string;
  video_model?: string;
}

// ── Scene ────────────────────────────────────────────────────────────────────

export type SceneStatus = 'draft' | 'ready' | 'in_progress' | 'done' | 'failed';

export interface Scene {
  id: string;
  chapter_id: string;
  order: number;
  title: string | null;
  duration: number | null;
  content_mode: string | null;
  visual_direction: string | null;
  prompt: string | null;
  prompt_json?: PromptJSON | null;
  validated_runtime?: ValidatedRuntime | null;
  compiled_prompt?: string | null;
  compile_status?: CompiledPromptStatus | null;
  resolved_asset_refs?: CompiledAssetRef[] | null;
  reference_images?: CompiledReferenceImage[] | null;
  location_variant_slug: string | null;
  character_variant_slugs: string[];
  prop_variant_slugs: string[];
  audio_text: string | null;
  audio_url: string | null;
  audio_duration: number | null;
  video_url: string | null;
  video_duration: number | null;
  status: SceneStatus | null;
  created_at: string;
  updated_at: string;
}
