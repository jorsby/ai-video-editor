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
 * Save timeline (tracks and clips) to Supabase.
 * When videoId is provided, only the tracks for that video are replaced.
 * When videoId is omitted, all tracks for the project are replaced (legacy behaviour).
 */
export async function saveTimeline(
  projectId: string,
  tracks: StudioTrack[],
  clips: IClip[],
  videoId?: string | null
) {
  const supabase = createClient('studio');

  // Build track rows for RPC
  const trackRows = tracks.map((track, i) => ({
    id: track.id,
    position: i,
    data: track,
  }));

  // Build clip rows (track-first: use track.clipIds as authoritative order)
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

  // Single transactional RPC call — all-or-nothing
  const { error } = await supabase.rpc('save_timeline', {
    p_project_id: projectId,
    p_video_id: videoId ?? null,
    p_tracks: trackRows,
    p_clips: clipRows,
  });

  if (error) throw error;
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
 * Load timeline from Supabase.
 * When videoId is provided, only tracks for that video are loaded.
 */
export async function loadTimeline(
  projectId: string,
  videoId?: string | null
): Promise<TrackWithClips[] | null> {
  const supabase = createClient('studio');

  let query = supabase
    .from('tracks')
    .select('*, clips(*)')
    .eq('project_id', projectId);

  if (videoId) {
    query = query.eq('video_id', videoId);
  }

  const { data: tracks, error } = await query.order('position');

  if (error) {
    console.error('Failed to load timeline:', error);
    return null;
  }

  return tracks as TrackWithClips[];
}

/**
 * Clear tracks and clips from Supabase.
 * When videoId is provided, only that video's tracks are cleared.
 */
export async function clearTimeline(
  projectId: string,
  videoId?: string | null
) {
  const supabase = createClient('studio');

  // Fetch track IDs
  let query = supabase.from('tracks').select('id').eq('project_id', projectId);
  if (videoId) query = query.eq('video_id', videoId);

  const { data: tracks, error: fetchError } = await query;
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
  if (trackIds.length > 0) {
    const { error: deleteTracksError } = await supabase
      .from('tracks')
      .delete()
      .in('id', trackIds);
    if (deleteTracksError) throw deleteTracksError;
  }
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
