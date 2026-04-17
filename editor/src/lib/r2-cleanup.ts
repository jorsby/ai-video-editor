import type { R2StorageService } from '@/lib/r2';

type SupabaseClient = ReturnType<
  typeof import('@/lib/supabase/admin').createServiceClient
>;

/**
 * Collect all R2 URLs owned by a single video (scenes + video-scoped asset variants).
 * Does NOT include project-level music (ON DELETE SET NULL makes it project-level).
 */
export async function collectVideoR2Urls(
  db: SupabaseClient,
  videoId: string
): Promise<string[]> {
  const urls: string[] = [];

  // Scene audio + video URLs (via chapters)
  const { data: scenes } = await db
    .from('scenes')
    .select('audio_url, video_url, chapters!inner(video_id)')
    .eq('chapters.video_id', videoId);

  if (scenes) {
    for (const s of scenes) {
      if (s.audio_url) urls.push(s.audio_url);
      if (s.video_url) urls.push(s.video_url);
    }
  }

  // Video-scoped asset variant images
  const [charV, locV, propV] = await Promise.all([
    db
      .from('character_variants')
      .select('image_url, characters!inner(video_id)')
      .eq('characters.video_id', videoId)
      .not('image_url', 'is', null),
    db
      .from('location_variants')
      .select('image_url, locations!inner(video_id)')
      .eq('locations.video_id', videoId)
      .not('image_url', 'is', null),
    db
      .from('prop_variants')
      .select('image_url, props!inner(video_id)')
      .eq('props.video_id', videoId)
      .not('image_url', 'is', null),
  ]);

  for (const v of [
    ...(charV.data ?? []),
    ...(locV.data ?? []),
    ...(propV.data ?? []),
  ]) {
    if (v.image_url) urls.push(v.image_url);
  }

  return urls;
}

/**
 * Collect ALL R2 URLs owned by a project (all videos + project-level assets + music + rendered videos).
 */
export async function collectProjectR2Urls(
  db: SupabaseClient,
  projectId: string
): Promise<string[]> {
  const urls: string[] = [];

  // All scene audio + video URLs (via chapters → videos)
  const { data: scenes } = await db
    .from('scenes')
    .select(
      'audio_url, video_url, chapters!inner(video_id, videos!inner(project_id))'
    )
    .eq('chapters.videos.project_id', projectId);

  if (scenes) {
    for (const s of scenes) {
      if (s.audio_url) urls.push(s.audio_url);
      if (s.video_url) urls.push(s.video_url);
    }
  }

  // ALL asset variant images (both project-level and video-scoped)
  const [charVP, locVP, propVP] = await Promise.all([
    db
      .from('character_variants')
      .select('image_url, characters!inner(project_id)')
      .eq('characters.project_id', projectId)
      .not('image_url', 'is', null),
    db
      .from('location_variants')
      .select('image_url, locations!inner(project_id)')
      .eq('locations.project_id', projectId)
      .not('image_url', 'is', null),
    db
      .from('prop_variants')
      .select('image_url, props!inner(project_id)')
      .eq('props.project_id', projectId)
      .not('image_url', 'is', null),
  ]);

  for (const v of [
    ...(charVP.data ?? []),
    ...(locVP.data ?? []),
    ...(propVP.data ?? []),
  ]) {
    if (v.image_url) urls.push(v.image_url);
  }

  // Project music audio + cover images
  const { data: music } = await db
    .from('musics')
    .select('audio_url, cover_image_url')
    .eq('project_id', projectId);

  if (music) {
    for (const m of music) {
      if (m.audio_url) urls.push(m.audio_url);
      if (m.cover_image_url) urls.push(m.cover_image_url);
    }
  }

  // Rendered videos
  const { data: renders } = await db
    .from('rendered_videos')
    .select('url')
    .eq('project_id', projectId)
    .not('url', 'is', null);

  if (renders) {
    for (const r of renders) {
      if (r.url) urls.push(r.url);
    }
  }

  return urls;
}

/**
 * Best-effort delete of R2 objects. Logs failures but never throws.
 */
export async function deleteR2Objects(
  r2: R2StorageService,
  urls: string[]
): Promise<{ deleted: number; failed: number }> {
  const keys = urls
    .map((url) => r2.extractKeyFromUrl(url))
    .filter((k): k is string => k !== null);

  if (keys.length === 0) return { deleted: 0, failed: 0 };

  const results = await Promise.allSettled(
    keys.map((key) => r2.deleteObject(key))
  );

  let deleted = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') deleted++;
    else {
      failed++;
      console.error('[r2-cleanup] Failed to delete object:', r.reason);
    }
  }

  if (failed > 0) {
    console.warn(`[r2-cleanup] ${failed}/${keys.length} R2 deletions failed`);
  }

  return { deleted, failed };
}
