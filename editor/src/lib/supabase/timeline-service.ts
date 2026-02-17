import { createClient } from '@/lib/supabase/client';
import { clipToJSON, type IClip } from 'openvideo';

// Track interface matching the Studio's track structure
interface StudioTrack {
  id: string;
  name: string;
  type: string;
  clipIds: string[];
}

/**
 * Find which track a clip belongs to
 */
function findTrackForClip(
  tracks: StudioTrack[],
  clipId: string
): string | null {
  for (const track of tracks) {
    if (track.clipIds.includes(clipId)) {
      return track.id;
    }
  }
  return null;
}

/**
 * Save timeline (tracks and clips) to Supabase
 */
export async function saveTimeline(
  projectId: string,
  tracks: StudioTrack[],
  clips: IClip[]
) {
  const supabase = createClient();

  // Get all track IDs for this save
  const trackIds = tracks.map((t) => t.id);

  // Delete existing clips for these tracks
  if (trackIds.length > 0) {
    const { error: deleteClipsError } = await supabase
      .from('clips')
      .delete()
      .in('track_id', trackIds);
    if (deleteClipsError) throw deleteClipsError;
  }

  // Delete existing tracks for this project
  const { error: deleteTracksError } = await supabase
    .from('tracks')
    .delete()
    .eq('project_id', projectId);
  if (deleteTracksError) throw deleteTracksError;

  // Insert tracks
  if (tracks.length > 0) {
    const trackRows = tracks.map((track, i) => ({
      id: track.id,
      project_id: projectId,
      position: i,
      data: track, // Full track object in JSONB
    }));
    const { error: trackError } = await supabase
      .from('tracks')
      .insert(trackRows);
    if (trackError) throw trackError;
  }

  // Insert clips
  if (clips.length > 0) {
    const clipRows = clips
      .map((clip, i) => {
        const trackId = findTrackForClip(tracks, clip.id);
        if (!trackId) return null;
        return {
          id: clip.id,
          track_id: trackId,
          position: i,
          data: clipToJSON(clip), // Serialize clip to JSON
        };
      })
      .filter((row) => row !== null);
    const { error: clipError } = await supabase.from('clips').insert(clipRows);
    if (clipError) throw clipError;
  }
}

interface TrackWithClips {
  id: string;
  project_id: string;
  position: number;
  data: StudioTrack;
  clips: Array<{
    id: string;
    track_id: string;
    position: number;
    data: Record<string, unknown>;
  }>;
}

/**
 * Load timeline from Supabase
 * Returns tracks with nested clips data
 */
export async function loadTimeline(
  projectId: string
): Promise<TrackWithClips[] | null> {
  const supabase = createClient();

  const { data: tracks, error } = await supabase
    .from('tracks')
    .select('*, clips(*)')
    .eq('project_id', projectId)
    .order('position');

  if (error) {
    console.error('Failed to load timeline:', error);
    return null;
  }

  return tracks as TrackWithClips[];
}

/**
 * Reconstruct ProjectJSON format from Supabase data
 * This format is compatible with studio.loadFromJSON()
 */
/**
 * Clear all tracks and clips for a project from Supabase
 */
export async function clearTimeline(projectId: string) {
  const supabase = createClient();

  // Fetch track IDs for this project
  const { data: tracks, error: fetchError } = await supabase
    .from('tracks')
    .select('id')
    .eq('project_id', projectId);
  if (fetchError) throw fetchError;

  const trackIds = (tracks ?? []).map((t) => t.id);

  // Delete clips by track_id
  if (trackIds.length > 0) {
    const { error: deleteClipsError } = await supabase
      .from('clips')
      .delete()
      .in('track_id', trackIds);
    if (deleteClipsError) throw deleteClipsError;
  }

  // Delete tracks by project_id
  const { error: deleteTracksError } = await supabase
    .from('tracks')
    .delete()
    .eq('project_id', projectId);
  if (deleteTracksError) throw deleteTracksError;
}

export function reconstructProjectJSON(tracks: TrackWithClips[]) {
  // Collect all clips from all tracks
  const allClips: Record<string, unknown>[] = [];

  // Reconstruct track structure with clipIds
  const trackData: Array<{
    id: string;
    name: string;
    type: string;
    clipIds: string[];
  }> = [];

  for (const track of tracks) {
    // Build clipIds array for this track from its clips
    const clipIds: string[] = [];

    if (track.clips) {
      // Sort clips by position within track
      const sortedClips = [...track.clips].sort(
        (a, b) => a.position - b.position
      );
      for (const clip of sortedClips) {
        allClips.push(clip.data);
        clipIds.push(clip.id);
      }
    }

    // Add track with its clipIds
    trackData.push({
      id: track.data.id,
      name: track.data.name,
      type: track.data.type,
      clipIds,
    });
  }

  return {
    clips: allClips,
    tracks: trackData,
  };
}
