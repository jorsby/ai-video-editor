-- =============================================================================
-- Episode Asset Map (simple episode-level asset whitelist, no variant override)
-- =============================================================================

CREATE TABLE IF NOT EXISTS studio.episode_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES studio.series_episodes(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES studio.series_assets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (episode_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_episode_assets_episode_id
  ON studio.episode_assets(episode_id);

CREATE INDEX IF NOT EXISTS idx_episode_assets_asset_id
  ON studio.episode_assets(asset_id);

ALTER TABLE studio.episode_assets ENABLE ROW LEVEL SECURITY;

-- episode_assets: via episode -> series ownership
DROP POLICY IF EXISTS episode_assets_select_own ON studio.episode_assets;
CREATE POLICY episode_assets_select_own ON studio.episode_assets
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM studio.series_episodes se
    JOIN studio.series s ON s.id = se.series_id
    WHERE se.id = studio.episode_assets.episode_id
      AND s.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS episode_assets_insert_own ON studio.episode_assets;
CREATE POLICY episode_assets_insert_own ON studio.episode_assets
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1
    FROM studio.series_episodes se
    JOIN studio.series s ON s.id = se.series_id
    WHERE se.id = studio.episode_assets.episode_id
      AND s.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS episode_assets_delete_own ON studio.episode_assets;
CREATE POLICY episode_assets_delete_own ON studio.episode_assets
FOR DELETE USING (
  EXISTS (
    SELECT 1
    FROM studio.series_episodes se
    JOIN studio.series s ON s.id = se.series_id
    WHERE se.id = studio.episode_assets.episode_id
      AND s.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS episode_assets_service_all ON studio.episode_assets;
CREATE POLICY episode_assets_service_all ON studio.episode_assets
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
