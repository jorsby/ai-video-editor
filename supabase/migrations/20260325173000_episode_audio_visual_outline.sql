-- =============================================================================
-- Episode-level single-workflow fields (Step 2)
-- =============================================================================

ALTER TABLE studio.series_episodes
  ADD COLUMN IF NOT EXISTS audio_content TEXT;

ALTER TABLE studio.series_episodes
  ADD COLUMN IF NOT EXISTS visual_outline TEXT;
