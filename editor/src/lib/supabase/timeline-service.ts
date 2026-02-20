import { createClient } from '@/lib/supabase/client';
import { clipToJSON, type IClip } from 'openvideo';
import type { LanguageCode } from '@/lib/constants/languages';

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
  clips: IClip[],
  language: LanguageCode = 'en'
) {
  const supabase = createClient();

  // Fetch existing track IDs for this project+language
  const { data: existingTracks, error: fetchError } = await supabase
    .from('tracks')
    .select('id')
    .eq('project_id', projectId)
    .eq('language', language);
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

  // Delete existing tracks for this project+language
  const { error: deleteTracksError } = await supabase
    .from('tracks')
    .delete()
    .eq('project_id', projectId)
    .eq('language', language);
  if (deleteTracksError) throw deleteTracksError;

  // Insert tracks
  if (tracks.length > 0) {
    const trackRows = tracks.map((track, i) => ({
      id: track.id,
      project_id: projectId,
      language,
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
  projectId: string,
  language: LanguageCode = 'en'
): Promise<TrackWithClips[] | null> {
  const supabase = createClient();

  const { data: tracks, error } = await supabase
    .from('tracks')
    .select('*, clips(*)')
    .eq('project_id', projectId)
    .eq('language', language)
    .order('position');

  if (error) {
    console.error('Failed to load timeline:', error);
    return null;
  }

  return tracks as TrackWithClips[];
}

/**
 * Clear tracks and clips for a project from Supabase.
 * If language is provided, only clear that language's tracks/clips.
 * If omitted, clear all languages (backward compatible).
 */
export async function clearTimeline(
  projectId: string,
  language?: LanguageCode
) {
  const supabase = createClient();

  // Fetch track IDs for this project (optionally filtered by language)
  let query = supabase
    .from('tracks')
    .select('id')
    .eq('project_id', projectId);
  if (language) {
    query = query.eq('language', language);
  }
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
  let deleteQuery = supabase
    .from('tracks')
    .delete()
    .eq('project_id', projectId);
  if (language) {
    deleteQuery = deleteQuery.eq('language', language);
  }
  const { error: deleteTracksError } = await deleteQuery;
  if (deleteTracksError) throw deleteTracksError;
}

/**
 * Get distinct languages that have saved timelines for a project
 */
export async function getAvailableLanguages(
  projectId: string
): Promise<LanguageCode[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('tracks')
    .select('language')
    .eq('project_id', projectId);

  if (error) {
    console.error('Failed to get available languages:', error);
    return [];
  }

  const languages = [...new Set((data ?? []).map((t) => t.language))];
  return languages as LanguageCode[];
}

/**
 * Copy a timeline from one language to another.
 * Loads the source language timeline, generates new UUIDs, and inserts copies.
 */
export async function copyTimeline(
  projectId: string,
  fromLang: LanguageCode,
  toLang: LanguageCode
) {
  const sourceTracks = await loadTimeline(projectId, fromLang);
  if (!sourceTracks || sourceTracks.length === 0) return;

  const supabase = createClient();

  for (const track of sourceTracks) {
    const newTrackId = crypto.randomUUID();
    const oldToNewClipId = new Map<string, string>();

    // Map old clip IDs to new ones
    if (track.clips) {
      for (const clip of track.clips) {
        oldToNewClipId.set(clip.id, crypto.randomUUID());
      }
    }

    // Build new clipIds array
    const newClipIds = (track.data.clipIds || []).map(
      (oldId) => oldToNewClipId.get(oldId) || crypto.randomUUID()
    );

    // Insert new track
    const newTrackData = {
      ...track.data,
      id: newTrackId,
      clipIds: newClipIds,
    };
    const { error: trackError } = await supabase.from('tracks').insert({
      id: newTrackId,
      project_id: projectId,
      language: toLang,
      position: track.position,
      data: newTrackData,
    });
    if (trackError) throw trackError;

    // Insert new clips
    if (track.clips && track.clips.length > 0) {
      const clipRows = track.clips.map((clip) => {
        const newClipId = oldToNewClipId.get(clip.id) || crypto.randomUUID();
        return {
          id: newClipId,
          track_id: newTrackId,
          position: clip.position,
          data: { ...clip.data, id: newClipId },
        };
      });
      const { error: clipError } = await supabase
        .from('clips')
        .insert(clipRows);
      if (clipError) throw clipError;
    }
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
