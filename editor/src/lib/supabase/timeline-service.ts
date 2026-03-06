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
 * Save timeline (tracks and clips) to Supabase
 */
export async function saveTimeline(
  projectId: string,
  tracks: StudioTrack[],
  clips: IClip[],
  language: LanguageCode = 'en'
) {
  const supabase = createClient('studio');

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
  projectId: string,
  language: LanguageCode = 'en'
): Promise<TrackWithClips[] | null> {
  const supabase = createClient('studio');

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
  const supabase = createClient('studio');

  // Fetch track IDs for this project (optionally filtered by language)
  let query = supabase.from('tracks').select('id').eq('project_id', projectId);
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
 * Get distinct languages available for a project.
 * Merges languages from three sources:
 *   1. Saved timeline tracks
 *   2. Voiceover records (catches translations made before timeline is built)
 *   3. Storyboard plan (source language)
 */
export async function getAvailableLanguages(
  projectId: string
): Promise<LanguageCode[]> {
  const supabase = createClient('studio');

  // 1. Languages from saved timeline tracks
  const { data: trackData, error: trackError } = await supabase
    .from('tracks')
    .select('language')
    .eq('project_id', projectId);

  if (trackError) {
    console.error('Failed to get track languages:', trackError);
  }

  const allLangs = new Set<string>(
    (trackData ?? []).map((t) => t.language as string)
  );

  // 2. Languages from voiceover records (via ALL storyboards → scenes → voiceovers)
  const { data: storyboards } = await supabase
    .from('storyboards')
    .select('id')
    .eq('project_id', projectId);

  if (storyboards && storyboards.length > 0) {
    const sbIds = storyboards.map((s) => s.id);
    const { data: scenes } = await supabase
      .from('scenes')
      .select('id')
      .in('storyboard_id', sbIds);

    if (scenes && scenes.length > 0) {
      const sceneIds = scenes.map((s) => s.id);
      const { data: voData, error: voError } = await supabase
        .from('voiceovers')
        .select('language')
        .in('scene_id', sceneIds);

      if (voError) {
        console.error('Failed to get voiceover languages:', voError);
      } else {
        for (const row of voData ?? []) {
          allLangs.add(row.language as string);
        }
      }
    }
  }

  // 3. Languages from storyboard plan (source language)
  const planLangs = await getProjectLanguagesFromStoryboard(projectId);
  for (const lang of planLangs) {
    allLangs.add(lang);
  }

  return [...allLangs] as LanguageCode[];
}

/**
 * Get the source language(s) for a project from its storyboard plan.
 * Used as a fallback when no tracks exist yet.
 */
export async function getProjectLanguagesFromStoryboard(
  projectId: string
): Promise<LanguageCode[]> {
  const supabase = createClient('studio');

  const { data: allStoryboards } = await supabase
    .from('storyboards')
    .select('plan')
    .eq('project_id', projectId);

  const allLangs = new Set<string>();
  for (const sb of allStoryboards ?? []) {
    if (sb.plan) {
      const voiceoverList = (sb.plan as Record<string, unknown>).voiceover_list;
      if (voiceoverList && typeof voiceoverList === 'object') {
        for (const lang of Object.keys(
          voiceoverList as Record<string, unknown>
        )) {
          allLangs.add(lang);
        }
      }
    }
  }
  return allLangs.size > 0 ? ([...allLangs] as LanguageCode[]) : [];
}

/**
 * Remove all data for a specific language from a project.
 * Deletes: tracks + clips, voiceovers, and rendered videos.
 */
export async function removeLanguageData(
  projectId: string,
  language: LanguageCode
) {
  // 1. Clear timeline (tracks + clips)
  await clearTimeline(projectId, language);

  const supabase = createClient('studio');

  // 2. Delete voiceovers for this language
  const { data: storyboards } = await supabase
    .from('storyboards')
    .select('id')
    .eq('project_id', projectId);

  if (storyboards && storyboards.length > 0) {
    const sbIds = storyboards.map((s) => s.id);
    const { data: scenes } = await supabase
      .from('scenes')
      .select('id')
      .in('storyboard_id', sbIds);

    if (scenes && scenes.length > 0) {
      const sceneIds = scenes.map((s) => s.id);
      const { error: voError } = await supabase
        .from('voiceovers')
        .delete()
        .in('scene_id', sceneIds)
        .eq('language', language);
      if (voError) throw voError;
    }
  }

  // 3. Delete rendered videos for this language
  const { error: rvError } = await supabase
    .from('rendered_videos')
    .delete()
    .eq('project_id', projectId)
    .eq('language', language);
  if (rvError) throw rvError;
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

  const supabase = createClient('studio');

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
