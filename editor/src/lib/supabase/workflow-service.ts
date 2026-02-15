import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Types for workflow data

export type PlanStatus =
  | 'draft'
  | 'approved'
  | 'generating'
  | 'grid_ready'
  | null;

export interface StoryboardPlan {
  rows: number;
  cols: number;
  grid_image_prompt: string;
  voiceover_list: { en: string[]; tr: string[]; ar: string[] };
  visual_flow: string[];
}

export interface Storyboard {
  id: string;
  project_id: string;
  voiceover: string;
  aspect_ratio: string;
  created_at: string;
  plan: StoryboardPlan | null;
  plan_status: PlanStatus;
}

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
}

export interface FirstFrame {
  id: string;
  scene_id: string;
  visual_prompt: string | null;
  sfx_prompt: string | null;
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
    | 'success'
    | 'failed'
    | null;
  image_edit_error_message: string | null;
  outpainted_url: string | null;
  video_url: string | null;
  video_status: 'pending' | 'processing' | 'success' | 'failed' | null;
  video_request_id: string | null;
  video_error_message: string | null;
  video_resolution: '480p' | '720p' | '1080p' | null;
  sfx_status: 'pending' | 'processing' | 'success' | 'failed' | null;
  sfx_request_id: string | null;
  sfx_error_message: string | null;
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
}

export interface Scene {
  id: string;
  grid_image_id: string;
  order: number;
  created_at: string;
  first_frames: FirstFrame[];
  voiceovers: Voiceover[];
}

export interface GridImageWithScenes extends GridImage {
  scenes: Scene[];
}

export interface StoryboardWithGridImage extends Storyboard {
  grid_images: GridImageWithScenes[];
}

/**
 * Get the latest storyboard for a project
 * Orders by created_at DESC and returns the most recent one
 */
export async function getLatestStoryboard(
  projectId: string
): Promise<Storyboard | null> {
  const supabase = createClient();

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

  const supabase = createClient();
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
  const supabase = createClient();

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
  const supabase = createClient();

  const { data, error } = await supabase
    .from('storyboards')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch storyboards:', error);
    return [];
  }

  return (data as Storyboard[]) || [];
}

/**
 * Get a specific storyboard by ID with its grid_image, scenes, first_frames, and voiceovers
 */
export async function getStoryboardWithScenesById(
  storyboardId: string
): Promise<StoryboardWithGridImage | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('storyboards')
    .select(
      `
      *,
      grid_images (
        *,
        scenes (
          *,
          first_frames (*),
          voiceovers (*)
        )
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

  // Sort scenes by order within each grid_image
  if (data?.grid_images) {
    for (const gridImage of data.grid_images) {
      if (gridImage.scenes) {
        gridImage.scenes.sort((a: Scene, b: Scene) => a.order - b.order);
      }
    }
  }

  return data as StoryboardWithGridImage;
}

/**
 * Get the latest storyboard with its grid_image, scenes, first_frames, and voiceovers
 * This is the main function for loading workflow data
 */
export async function getLatestStoryboardWithScenes(
  projectId: string
): Promise<StoryboardWithGridImage | null> {
  const supabase = createClient();

  // Get the latest storyboard with nested grid_images and scenes
  const { data: storyboard, error: storyboardError } = await supabase
    .from('storyboards')
    .select(
      `
      *,
      grid_images (
        *,
        scenes (
          *,
          first_frames (*),
          voiceovers (*)
        )
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

  // Sort scenes by order within each grid_image
  if (storyboard?.grid_images) {
    for (const gridImage of storyboard.grid_images) {
      if (gridImage.scenes) {
        gridImage.scenes.sort((a: Scene, b: Scene) => a.order - b.order);
      }
    }
  }

  return storyboard as StoryboardWithGridImage;
}

/**
 * Get the latest grid_image with its scenes, first_frames, and voiceovers
 * @deprecated Use getLatestStoryboardWithScenes instead
 */
export async function getLatestGridImageWithScenes(
  projectId: string
): Promise<GridImageWithScenes | null> {
  const storyboard = await getLatestStoryboardWithScenes(projectId);
  if (!storyboard || !storyboard.grid_images?.[0]) {
    return null;
  }
  return storyboard.grid_images[0];
}

/**
 * Subscribe to grid_image status changes
 * Useful for real-time updates when waiting for workflow completion
 */
export function subscribeToGridImageStatus(
  gridImageId: string,
  onUpdate: (gridImage: GridImage) => void
) {
  const supabase = createClient();

  const channel = supabase
    .channel(`grid_image_${gridImageId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
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
  const supabase = createClient();

  // We need to join through scenes to filter by grid_image_id
  // For simplicity, we'll subscribe to all first_frames changes
  // and filter client-side, or you can use a database function
  const channel = supabase
    .channel(`first_frames_${gridImageId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
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
}

/**
 * Combined subscription for all scene-related updates
 * Subscribes to grid_images, first_frames, and voiceovers tables
 * Returns a single unsubscribe function that cleans up all channels
 */
export function subscribeToSceneUpdates(
  gridImageId: string,
  callbacks: SceneUpdateCallbacks
) {
  const supabase = createClient();
  const channels: RealtimeChannel[] = [];

  // Grid image updates
  if (callbacks.onGridImageUpdate) {
    const gridChannel = supabase
      .channel(`grid_image_${gridImageId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'grid_images',
          filter: `id=eq.${gridImageId}`,
        },
        (payload) => callbacks.onGridImageUpdate?.(payload.new as GridImage)
      )
      .subscribe();
    channels.push(gridChannel);
  }

  // First frame updates (includes visual_prompt, url, status)
  if (callbacks.onFirstFrameUpdate) {
    const ffChannel = supabase
      .channel(`first_frames_${gridImageId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'first_frames',
        },
        (payload) => callbacks.onFirstFrameUpdate?.(payload.new as FirstFrame)
      )
      .subscribe();
    channels.push(ffChannel);
  }

  // Voiceover updates (listen for both INSERT and UPDATE to catch all changes)
  if (callbacks.onVoiceoverUpdate) {
    const voChannel = supabase
      .channel(`voiceovers_${gridImageId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
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
  const supabase = createClient();

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
  const supabase = createClient();

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
