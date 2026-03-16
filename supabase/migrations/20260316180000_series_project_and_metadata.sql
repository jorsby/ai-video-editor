-- =============================================================================
-- Series: add project_id (1 project per series) + metadata column
-- Episodes: make project_id nullable, add storyboard_id
-- =============================================================================

-- 1. Add project_id to series (the project lives here now)
ALTER TABLE studio.series
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES studio.projects(id) ON DELETE SET NULL;

-- 2. Add metadata to series (mode, pacing, duration, voice_id, style_notes)
ALTER TABLE studio.series
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. Episodes: project_id nullable (backward compat, but no longer required)
ALTER TABLE studio.series_episodes
  ALTER COLUMN project_id DROP NOT NULL;

-- 4. Episodes: add storyboard_id (links episode to its storyboard in the shared project)
ALTER TABLE studio.series_episodes
  ADD COLUMN IF NOT EXISTS storyboard_id UUID REFERENCES studio.storyboards(id) ON DELETE SET NULL;

-- 5. Index for series → project lookup
CREATE INDEX IF NOT EXISTS idx_series_project_id
  ON studio.series(project_id);

-- 6. Index for episode → storyboard lookup  
CREATE INDEX IF NOT EXISTS idx_series_episodes_storyboard_id
  ON studio.series_episodes(storyboard_id);
