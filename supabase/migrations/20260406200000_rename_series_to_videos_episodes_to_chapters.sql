-- =============================================================================
-- Rename series → videos, episodes → chapters
-- Pure semantic rename — no logic changes
-- =============================================================================
BEGIN;

-- ─── 1. Drop dependent objects first ────────────────────────────────────────

-- Drop RLS policies on series
DROP POLICY IF EXISTS "Users can view own series" ON studio.series;
DROP POLICY IF EXISTS "Users can insert own series" ON studio.series;
DROP POLICY IF EXISTS "Users can update own series" ON studio.series;
DROP POLICY IF EXISTS "Users can delete own series" ON studio.series;
DROP POLICY IF EXISTS "Service role full access to series" ON studio.series;

-- Drop RLS policies on episodes
DROP POLICY IF EXISTS "Users can view own episodes" ON studio.episodes;
DROP POLICY IF EXISTS "Users can insert own episodes" ON studio.episodes;
DROP POLICY IF EXISTS "Users can update own episodes" ON studio.episodes;
DROP POLICY IF EXISTS "Users can delete own episodes" ON studio.episodes;
DROP POLICY IF EXISTS "Service role full access to episodes" ON studio.episodes;

-- Drop RLS policies on series_music
DROP POLICY IF EXISTS series_music_select ON studio.series_music;
DROP POLICY IF EXISTS series_music_insert ON studio.series_music;
DROP POLICY IF EXISTS series_music_update ON studio.series_music;
DROP POLICY IF EXISTS series_music_delete ON studio.series_music;

-- Drop indexes that reference old names
DROP INDEX IF EXISTS studio.idx_series_project_id;
DROP INDEX IF EXISTS studio.idx_series_user_id;
DROP INDEX IF EXISTS studio.idx_episodes_series_id;
DROP INDEX IF EXISTS studio.idx_episodes_status;
DROP INDEX IF EXISTS studio.idx_episodes_asset_variant_map_gin;
DROP INDEX IF EXISTS studio.idx_series_music_series_id;

-- Drop triggers
DROP TRIGGER IF EXISTS set_updated_at ON studio.series;
DROP TRIGGER IF EXISTS set_updated_at ON studio.episodes;
DROP TRIGGER IF EXISTS set_updated_at ON studio.series_music;

-- ─── 2. Rename tables ──────────────────────────────────────────────────────

ALTER TABLE studio.series RENAME TO videos;
ALTER TABLE studio.episodes RENAME TO chapters;
ALTER TABLE studio.series_music RENAME TO video_music;

-- ─── 3. Rename columns ─────────────────────────────────────────────────────

-- chapters: series_id → video_id
ALTER TABLE studio.chapters RENAME COLUMN series_id TO video_id;

-- scenes: episode_id → chapter_id
ALTER TABLE studio.scenes RENAME COLUMN episode_id TO chapter_id;

-- video_music: series_id → video_id
ALTER TABLE studio.video_music RENAME COLUMN series_id TO video_id;

-- series_assets: series_id → video_id (table stays as-is since it's project_assets now)
-- Check if series_assets still exists and has series_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'studio' AND table_name = 'series_assets' AND column_name = 'series_id'
  ) THEN
    ALTER TABLE studio.series_assets RENAME COLUMN series_id TO video_id;
  END IF;
END $$;

-- ─── 4. Recreate indexes with new names ─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_videos_project_id ON studio.videos(project_id);
CREATE INDEX IF NOT EXISTS idx_videos_user_id ON studio.videos(user_id);
CREATE INDEX IF NOT EXISTS idx_chapters_video_id ON studio.chapters(video_id);
CREATE INDEX IF NOT EXISTS idx_chapters_status ON studio.chapters(status);
CREATE INDEX IF NOT EXISTS idx_chapters_asset_variant_map_gin ON studio.chapters USING GIN (asset_variant_map);
CREATE INDEX IF NOT EXISTS idx_scenes_chapter_id ON studio.scenes(chapter_id);
CREATE INDEX IF NOT EXISTS idx_video_music_video_id ON studio.video_music(video_id);

-- Drop old scene index if exists
DROP INDEX IF EXISTS studio.idx_scenes_episode_id;

-- ─── 5. Recreate triggers ──────────────────────────────────────────────────

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON studio.videos
  FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON studio.chapters
  FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON studio.video_music
  FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();

-- ─── 6. Recreate RLS policies ──────────────────────────────────────────────

-- videos
ALTER TABLE studio.videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own videos"
  ON studio.videos FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own videos"
  ON studio.videos FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own videos"
  ON studio.videos FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own videos"
  ON studio.videos FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Service role full access to videos"
  ON studio.videos FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- chapters
ALTER TABLE studio.chapters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chapters"
  ON studio.chapters FOR SELECT
  USING (
    video_id IN (SELECT id FROM studio.videos WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can insert own chapters"
  ON studio.chapters FOR INSERT
  WITH CHECK (
    video_id IN (SELECT id FROM studio.videos WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can update own chapters"
  ON studio.chapters FOR UPDATE
  USING (
    video_id IN (SELECT id FROM studio.videos WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can delete own chapters"
  ON studio.chapters FOR DELETE
  USING (
    video_id IN (SELECT id FROM studio.videos WHERE user_id = auth.uid())
  );

CREATE POLICY "Service role full access to chapters"
  ON studio.chapters FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- video_music
ALTER TABLE studio.video_music ENABLE ROW LEVEL SECURITY;

CREATE POLICY video_music_select ON studio.video_music
  FOR SELECT USING (
    video_id IN (SELECT id FROM studio.videos WHERE user_id = auth.uid())
  );

CREATE POLICY video_music_insert ON studio.video_music
  FOR INSERT WITH CHECK (
    video_id IN (SELECT id FROM studio.videos WHERE user_id = auth.uid())
  );

CREATE POLICY video_music_update ON studio.video_music
  FOR UPDATE USING (
    video_id IN (SELECT id FROM studio.videos WHERE user_id = auth.uid())
  );

CREATE POLICY video_music_delete ON studio.video_music
  FOR DELETE USING (
    video_id IN (SELECT id FROM studio.videos WHERE user_id = auth.uid())
  );

-- ─── 7. Update scene RLS if it references episodes ─────────────────────────

-- Drop old scene policies that reference episodes
DROP POLICY IF EXISTS "Users can view own scenes" ON studio.scenes;
DROP POLICY IF EXISTS "Users can insert own scenes" ON studio.scenes;
DROP POLICY IF EXISTS "Users can update own scenes" ON studio.scenes;
DROP POLICY IF EXISTS "Users can delete own scenes" ON studio.scenes;

-- Recreate with chapters reference
CREATE POLICY "Users can view own scenes"
  ON studio.scenes FOR SELECT
  USING (
    chapter_id IN (
      SELECT c.id FROM studio.chapters c
      JOIN studio.videos v ON v.id = c.video_id
      WHERE v.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own scenes"
  ON studio.scenes FOR INSERT
  WITH CHECK (
    chapter_id IN (
      SELECT c.id FROM studio.chapters c
      JOIN studio.videos v ON v.id = c.video_id
      WHERE v.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own scenes"
  ON studio.scenes FOR UPDATE
  USING (
    chapter_id IN (
      SELECT c.id FROM studio.chapters c
      JOIN studio.videos v ON v.id = c.video_id
      WHERE v.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own scenes"
  ON studio.scenes FOR DELETE
  USING (
    chapter_id IN (
      SELECT c.id FROM studio.chapters c
      JOIN studio.videos v ON v.id = c.video_id
      WHERE v.user_id = auth.uid()
    )
  );

COMMIT;
