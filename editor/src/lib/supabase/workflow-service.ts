import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type {
  GridAspectRatio,
  GridResolution,
} from '@/lib/grid-generation-settings';
import type { StoryboardContentTemplate } from '@/lib/storyboard-content-template';
import type {
  CompiledAssetRef,
  CompiledPromptStatus,
  CompiledReferenceImage,
  PromptJSON,
  ScenePromptContract,
  ValidatedRuntime,
} from '@/lib/storyboard/scene-contracts';

// Types for workflow data

export type StoryboardMode = 'image_to_video' | 'ref_to_video' | 'quick_video';
export type VideoModel = 'grok-imagine/image-to-video';
export type ScenePromptSource =
  | 'prompt_contract'
  | 'multi_prompt'
  | 'prompt'
  | 'none';

export type PlanStatus =
  | 'draft'
  | 'approved'
  | 'generating'
  | 'grid_ready'
  | 'splitting'
  | 'failed'
  | null;

// Image-to-video plan shape
export interface StoryboardPlan {
  rows: number;
  cols: number;
  grid_image_prompt: string;
  grid_generation_aspect_ratio?: GridAspectRatio;
  grid_generation_resolution?: GridResolution;
  voiceover_list: Record<string, string[]>;
  visual_flow: string[];
  content_template?: StoryboardContentTemplate;
}

// Ref-to-video plan shapes
export interface SceneElement {
  name: string;
  description: string;
}

export type RefWorkflowVariant = 'i2v_from_refs' | 'direct_ref_to_video';
export type RefVideoMode = 'narrative' | 'dialogue_scene';

export interface SceneDialogueLine {
  speaker: string;
  line: string;
}

export interface RefPlanBase {
  objects_rows: number;
  objects_cols: number;
  objects_grid_prompt: string;
  bg_rows: number;
  bg_cols: number;
  backgrounds_grid_prompt: string;
  grid_generation_aspect_ratio?: GridAspectRatio;
  grid_generation_resolution?: GridResolution;
  background_names: string[];
  scene_prompts: (string | string[])[];
  scene_first_frame_prompts?: string[];
  scene_bg_indices: number[];
  scene_object_indices: number[][];
  voiceover_list: Record<string, string[]>;
  video_mode?: RefVideoMode;
  scene_dialogue?: SceneDialogueLine[][];
  workflow_variant?: RefWorkflowVariant;
  content_template?: StoryboardContentTemplate;
}

export interface RefVideoPlan extends RefPlanBase {
  objects: SceneElement[];
}

export type RefPlan = RefVideoPlan;

export type StoryboardInputType = 'voiceover_script' | 'cinematic_flow';

export interface Storyboard {
  id: string;
  project_id: string;
  voiceover: string;
  aspect_ratio: string;
  created_at: string;
  plan: StoryboardPlan | RefPlan | null;
  plan_status: PlanStatus;
  mode: StoryboardMode;
  model: VideoModel | null;
  title: string | null;
  input_type: StoryboardInputType;
  is_active: boolean;
  sort_order: number;
}

// ── Generation Log (append-only version history) ─────────────────────────────

export type GenerationEntityType =
  | 'object'
  | 'background'
  | 'scene'
  | 'voiceover';

export type GenerationLogStatus = 'pending' | 'success' | 'failed' | 'skipped';

export interface GenerationLog {
  id: string;
  entity_type: GenerationEntityType;
  entity_id: string;
  storyboard_id: string | null;
  version: number;
  prompt: string | null;
  generation_meta: GenerationMeta | null;
  feedback: string | null;
  result_url: string | null;
  status: GenerationLogStatus;
  created_at: string;
}

// ── Series Metadata (production fields) ──────────────────────────────────────

export interface SeriesProductionMeta {
  scene_mode?: 'narrative' | 'cinematic';
  episode_count?: number;
  aspect_ratio?: string;
  language?: string;
  voice_id?: string;
  video_model?: string;
  image_model?: string;
}

export type GridImageType = 'scene' | 'objects' | 'backgrounds';

export interface GridImage {
  id: string;
  storyboard_id: string;
  url: string | null;
  prompt: string | null;
  status: 'pending' | 'processing' | 'generated' | 'success' | 'failed';
  request_id: string | null;
  error_message: string | null;
  created_at: string;
  detected_rows: number | null;
  detected_cols: number | null;
  dimension_detection_status: 'success' | 'failed' | null;
  type: GridImageType;
}

export interface FirstFrame {
  id: string;
  scene_id: string;
  grid_image_id: string | null;
  visual_prompt: string | null;
  url: string | null;
  out_padded_url: string | null;
  status: 'pending' | 'processing' | 'success' | 'failed';
  error_message: string | null;
  created_at: string;
  final_url: string | null;
  image_edit_status:
    | 'pending'
    | 'outpainting'
    | 'enhancing'
    | 'editing'
    | 'processing'
    | 'success'
    | 'failed'
    | null;
  image_edit_error_message: string | null;
  outpainted_url: string | null;
}

export interface Voiceover {
  id: string;
  scene_id: string;
  text: string | null;
  status: 'pending' | 'processing' | 'success' | 'failed';
  created_at: string;
  audio_url?: string | null;
  language: string;
  duration?: number | null;
  generation_meta?: GenerationMeta;
  feedback?: string | null;
}

export interface Scene {
  id: string;
  storyboard_id: string;
  order: number;
  prompt: string | null;
  multi_prompt: string[] | null;
  prompt_json?: PromptJSON | null;
  validated_runtime?: ValidatedRuntime | null;
  compiled_prompt?: string | null;
  compile_status?: CompiledPromptStatus | null;
  resolved_asset_refs?: CompiledAssetRef[] | null;
  reference_images?: CompiledReferenceImage[] | null;
  multi_shots: boolean | null;
  created_at: string;
  first_frames: FirstFrame[];
  voiceovers: Voiceover[];
  backgrounds: Background[];
  objects: RefObject[];
  video_url: string | null;
  video_status: 'pending' | 'processing' | 'success' | 'failed' | null;
  video_request_id: string | null;
  video_error_message: string | null;
  video_resolution: '480p' | '720p' | '1080p' | null;
  sfx_prompt: string | null;
  sfx_status: 'pending' | 'processing' | 'success' | 'failed' | null;
  sfx_request_id: string | null;
  sfx_error_message: string | null;
  generation_meta?: GenerationMeta;
  feedback?: string | null;
}

/** Scene row as returned by realtime (flat, without nested relations) */
export type SceneRow = Omit<
  Scene,
  'first_frames' | 'voiceovers' | 'backgrounds' | 'objects'
>;

// Ref-to-video related types
export interface GenerationMeta {
  model?: string;
  output_format?: string;
  resolution?: string;
  aspect_ratio?: string;
  use_case?: string;
  episode_id?: string;
  episode_title?: string;
  scene_order?: number;
  duration_seconds?: number;
  shot_type?: 'single' | 'multi';
  voice_id?: string;
  speed?: number;
  language?: string;
  prompt_source?: ScenePromptSource;
  prompt_contract?: ScenePromptContract;
  prompt_contract_compile_status?: CompiledPromptStatus | null;
  prompt_contract_reference_images?: CompiledReferenceImage[];
  prompt_contract_resolved_asset_refs?: CompiledAssetRef[];
  generated_at?: string;
  generated_by?: 'agent' | 'user' | 'system';
  [key: string]: unknown;
}

export interface RefObject {
  id: string;
  grid_image_id: string;
  scene_id: string;
  scene_order: number;
  order: number;
  name: string;
  grid_position: number;
  description: string | null;
  url: string | null;
  final_url: string | null;
  series_asset_variant_id?: string | null;
  generation_prompt?: string | null;
  generation_meta?: GenerationMeta;
  feedback?: string | null;
  status: 'pending' | 'processing' | 'success' | 'failed';
  request_id: string | null;
  error_message: string | null;
  image_edit_status:
    | 'outpainting'
    | 'enhancing'
    | 'editing'
    | 'processing'
    | 'success'
    | 'failed'
    | null;
  image_edit_error_message: string | null;
  image_edit_request_id: string | null;
  created_at: string;
}

export interface Background {
  id: string;
  grid_image_id: string;
  scene_id: string;
  order: number;
  name: string;
  grid_position: number;
  url: string | null;
  final_url: string | null;
  series_asset_variant_id?: string | null;
  generation_prompt?: string | null;
  generation_meta?: GenerationMeta;
  feedback?: string | null;
  status: 'pending' | 'processing' | 'success' | 'failed';
  request_id: string | null;
  error_message: string | null;
  image_edit_status:
    | 'outpainting'
    | 'enhancing'
    | 'editing'
    | 'processing'
    | 'success'
    | 'failed'
    | null;
  image_edit_error_message: string | null;
  image_edit_request_id: string | null;
  created_at: string;
}

export interface StoryboardWithScenes extends Storyboard {
  grid_images: GridImage[];
  scenes: Scene[];
}

/**
 * Get the latest storyboard for a project
 * Orders by created_at DESC and returns the most recent one
 */
export async function getLatestStoryboard(
  projectId: string
): Promise<Storyboard | null> {
  const supabase = createClient('studio');

  const { data, error } = await supabase
    .from('storyboards')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    // PGRST116 means no rows returned, which is not an error for our use case
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Failed to fetch latest storyboard:', error);
    return null;
  }

  return data as Storyboard;
}

/**
 * Get the latest grid_image for a project (through storyboard)
 * @deprecated Use getLatestStoryboardWithScenes instead
 */
export async function getLatestGridImage(
  projectId: string
): Promise<GridImage | null> {
  const storyboard = await getLatestStoryboard(projectId);
  if (!storyboard) return null;

  const supabase = createClient('studio');
  const { data, error } = await supabase
    .from('grid_images')
    .select('*')
    .eq('storyboard_id', storyboard.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Failed to fetch latest grid_image:', error);
    return null;
  }

  return data as GridImage;
}

/**
 * Get the latest successful grid_image for a project (through storyboard)
 * Useful when you only want completed workflows
 */
export async function getLatestSuccessfulGridImage(
  projectId: string
): Promise<GridImage | null> {
  const supabase = createClient('studio');

  // Query grid_images through storyboards
  const { data, error } = await supabase
    .from('grid_images')
    .select('*, storyboards!inner(project_id)')
    .eq('storyboards.project_id', projectId)
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Failed to fetch latest successful grid_image:', error);
    return null;
  }

  return data as GridImage;
}

/**
 * Get all storyboards for a project, ordered by creation time (newest first)
 */
export async function getStoryboardsForProject(
  projectId: string
): Promise<Storyboard[]> {
  const supabase = createClient('studio');

  const { data, error } = await supabase
    .from('storyboards')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch storyboards:', error);
    return [];
  }

  // Sort by episode number extracted from title (EP1, EP2, ... EP12)
  const sorted = (data as Storyboard[]) || [];
  sorted.sort((a, b) => {
    const numA = parseInt(a.title?.match(/EP(\d+)/)?.[1] || '999', 10);
    const numB = parseInt(b.title?.match(/EP(\d+)/)?.[1] || '999', 10);
    return numA - numB;
  });
  return sorted;
}

/**
 * Get a specific storyboard by ID with its grid_image, scenes, first_frames, and voiceovers
 */
export async function getStoryboardWithScenesById(
  storyboardId: string
): Promise<StoryboardWithScenes | null> {
  const supabase = createClient('studio');

  const { data, error } = await supabase
    .from('storyboards')
    .select(
      `
      *,
      grid_images (*),
      scenes (
        *,
        first_frames (*),
        voiceovers (*),
        backgrounds (*),
        objects (*)
      )
    `
    )
    .eq('id', storyboardId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Failed to fetch storyboard:', error);
    return null;
  }

  // Sort scenes by order
  if (data?.scenes) {
    data.scenes.sort((a: Scene, b: Scene) => a.order - b.order);
  }

  return data as StoryboardWithScenes;
}

/**
 * Get the latest storyboard with its grid_image, scenes, first_frames, and voiceovers
 * This is the main function for loading workflow data
 */
export async function getLatestStoryboardWithScenes(
  projectId: string
): Promise<StoryboardWithScenes | null> {
  const supabase = createClient('studio');

  // Get the latest storyboard with grid_images and scenes
  const { data: storyboard, error: storyboardError } = await supabase
    .from('storyboards')
    .select(
      `
      *,
      grid_images (*),
      scenes (
        *,
        first_frames (*),
        voiceovers (*),
        backgrounds (*),
        objects (*)
      )
    `
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (storyboardError) {
    if (storyboardError.code === 'PGRST116') {
      return null;
    }
    console.error('Failed to fetch latest storyboard:', storyboardError);
    return null;
  }

  // Sort scenes by order
  if (storyboard?.scenes) {
    storyboard.scenes.sort((a: Scene, b: Scene) => a.order - b.order);
  }

  return storyboard as StoryboardWithScenes;
}

/**
 * Subscribe to grid_image status changes
 * Useful for real-time updates when waiting for workflow completion
 */
export function subscribeToGridImageStatus(
  gridImageId: string,
  onUpdate: (gridImage: GridImage) => void
) {
  const supabase = createClient('studio');

  const channel = supabase
    .channel(`grid_image_${gridImageId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'studio',
        table: 'grid_images',
        filter: `id=eq.${gridImageId}`,
      },
      (payload) => {
        onUpdate(payload.new as GridImage);
      }
    )
    .subscribe();

  // Return unsubscribe function
  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Subscribe to first_frame status changes for a grid_image
 * Useful for tracking individual scene progress
 */
export function subscribeToFirstFrameUpdates(
  gridImageId: string,
  onUpdate: (firstFrame: FirstFrame) => void
) {
  const supabase = createClient('studio');

  // We need to join through scenes to filter by grid_image_id
  // For simplicity, we'll subscribe to all first_frames changes
  // and filter client-side, or you can use a database function
  const channel = supabase
    .channel(`first_frames_${gridImageId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'studio',
        table: 'first_frames',
      },
      (payload) => {
        onUpdate(payload.new as FirstFrame);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Callbacks for scene-related updates
 */
export interface SceneUpdateCallbacks {
  onGridImageUpdate?: (gridImage: GridImage) => void;
  onFirstFrameUpdate?: (firstFrame: FirstFrame) => void;
  onVoiceoverUpdate?: (voiceover: Voiceover) => void;
  onSceneUpdate?: (scene: SceneRow) => void;
  onStoryboardUpdate?: (storyboard: StoryboardRow) => void;
  onBackgroundUpdate?: (background: Background) => void;
  onObjectUpdate?: (object: RefObject) => void;
}

/** Raw storyboard row from realtime subscription */
export interface StoryboardRow {
  id: string;
  plan_status: PlanStatus;
  plan: Record<string, unknown> | null;
  mode: StoryboardMode;
  model: VideoModel | null;
  title: string | null;
  input_type: StoryboardInputType;
  is_active: boolean;
  sort_order: number;
  [key: string]: unknown;
}

/**
 * Combined subscription for all scene-related updates
 * Subscribes to grid_images, first_frames, and voiceovers tables
 * Returns a single unsubscribe function that cleans up all channels
 */
export function subscribeToSceneUpdates(
  gridImageIds: string[],
  callbacks: SceneUpdateCallbacks,
  storyboardId?: string
) {
  const supabase = createClient('studio');
  const channels: RealtimeChannel[] = [];

  // Storyboard updates (plan_status transitions)
  if (callbacks.onStoryboardUpdate && storyboardId) {
    const sbChannel = supabase
      .channel(`storyboard_${storyboardId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'studio',
          table: 'storyboards',
          filter: `id=eq.${storyboardId}`,
        },
        (payload) =>
          callbacks.onStoryboardUpdate?.(payload.new as StoryboardRow)
      )
      .subscribe();
    channels.push(sbChannel);
  }

  // Grid image updates — one channel per grid image ID
  if (callbacks.onGridImageUpdate) {
    for (const gid of gridImageIds) {
      const gridChannel = supabase
        .channel(`grid_image_${gid}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'studio',
            table: 'grid_images',
            filter: `id=eq.${gid}`,
          },
          (payload) => callbacks.onGridImageUpdate?.(payload.new as GridImage)
        )
        .subscribe();
      channels.push(gridChannel);
    }
  }

  const channelKey = gridImageIds.join('_');

  // First frame updates (includes visual_prompt, url, status)
  if (callbacks.onFirstFrameUpdate) {
    const ffChannel = supabase
      .channel(`first_frames_${channelKey}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'studio',
          table: 'first_frames',
        },
        (payload) => callbacks.onFirstFrameUpdate?.(payload.new as FirstFrame)
      )
      .subscribe();
    channels.push(ffChannel);
  }

  // Scene updates (for video/sfx status changes)
  if (callbacks.onSceneUpdate) {
    const sceneChannel = supabase
      .channel(`scenes_${channelKey}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'studio',
          table: 'scenes',
        },
        (payload) => callbacks.onSceneUpdate?.(payload.new as SceneRow)
      )
      .subscribe();
    channels.push(sceneChannel);
  }

  // Voiceover updates (listen for both INSERT and UPDATE to catch all changes)
  if (callbacks.onVoiceoverUpdate) {
    const voChannel = supabase
      .channel(`voiceovers_${channelKey}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'voiceovers',
        },
        (payload) => {
          if (
            payload.eventType === 'INSERT' ||
            payload.eventType === 'UPDATE'
          ) {
            callbacks.onVoiceoverUpdate?.(payload.new as Voiceover);
          }
        }
      )
      .subscribe();
    channels.push(voChannel);
  }

  // Background updates (for ref_to_video scene thumbnails)
  if (callbacks.onBackgroundUpdate) {
    const bgChannel = supabase
      .channel(`backgrounds_${channelKey}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'backgrounds',
        },
        (payload) => {
          if (
            payload.eventType === 'INSERT' ||
            payload.eventType === 'UPDATE'
          ) {
            callbacks.onBackgroundUpdate?.(payload.new as Background);
          }
        }
      )
      .subscribe();
    channels.push(bgChannel);
  }

  // Object updates (for ref_to_video character/item thumbnails)
  if (callbacks.onObjectUpdate) {
    const objChannel = supabase
      .channel(`objects_${channelKey}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'objects',
        },
        (payload) => {
          if (
            payload.eventType === 'INSERT' ||
            payload.eventType === 'UPDATE'
          ) {
            callbacks.onObjectUpdate?.(payload.new as RefObject);
          }
        }
      )
      .subscribe();
    channels.push(objChannel);
  }

  // Single unsubscribe function for all channels
  return () => {
    for (const ch of channels) {
      supabase.removeChannel(ch);
    }
  };
}

/**
 * Get the draft storyboard for a project (if one exists)
 * Returns the storyboard with plan_status='draft'
 */
export async function getDraftStoryboard(
  projectId: string
): Promise<Storyboard | null> {
  const supabase = createClient('studio');

  const { data, error } = await supabase
    .from('storyboards')
    .select('*')
    .eq('project_id', projectId)
    .eq('plan_status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Failed to fetch draft storyboard:', error);
    return null;
  }

  return data as Storyboard;
}

/**
 * Get a storyboard by ID
 */
export async function getStoryboardById(
  storyboardId: string
): Promise<Storyboard | null> {
  const supabase = createClient('studio');

  const { data, error } = await supabase
    .from('storyboards')
    .select('*')
    .eq('id', storyboardId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('Failed to fetch storyboard:', error);
    return null;
  }

  return data as Storyboard;
}
