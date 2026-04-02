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
 * Save timeline (tracks and clips) to Supabase
 */
export async function saveTimeline(
  projectId: string,
  tracks: StudioTrack[],
  clips: IClip[]
) {
  const supabase = createClient('studio');

  // Fetch existing track IDs for this project
  const { data: existingTracks, error: fetchError } = await supabase
    .from('tracks')
    .select('id')
    .eq('project_id', projectId);
  if (fetchError) throw fetchError;

  const existingTrackIds = (existingTracks ?? []).map((t) => t.id);

  // Delete existing clips for these tracks
  if (existingTrackIds.length > 0) {
    const { error: deleteClipsError } = await supabase
      .from('clips')
      .delete()
      .in('track_id', existingTrackIds);
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

  // Insert clips (track-first: use track.clipIds as authoritative order)
  const clipById = new Map<string, IClip>(clips.map((c) => [c.id, c]));
  const clipRows: Array<{
    id: string;
    track_id: string;
    position: number;
    data: ReturnType<typeof clipToJSON>;
  }> = [];

  for (const track of tracks) {
    for (let pos = 0; pos < track.clipIds.length; pos++) {
      const clip = clipById.get(track.clipIds[pos]);
      if (!clip) continue;
      clipRows.push({
        id: clip.id,
        track_id: track.id,
        position: pos,
        data: clipToJSON(clip),
      });
    }
  }

  if (clipRows.length > 0) {
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
  const supabase = createClient('studio');

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
 * Clear tracks and clips for a project from Supabase.
 */
export async function clearTimeline(projectId: string) {
  const supabase = createClient('studio');

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

  // Delete tracks
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
    const clipIds: string[] = [];

    if (track.clips) {
      const sortedClips = [...track.clips].sort(
        (a, b) => a.position - b.position
      );
      for (const clip of sortedClips) {
        allClips.push(clip.data);
        clipIds.push(clip.id);
      }
    }

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
