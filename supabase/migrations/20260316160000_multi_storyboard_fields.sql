BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Multi-Storyboard Support — Phase 1: Data Model
--
-- Adds fields to storyboards table to support:
--   - Multiple storyboards per project (already supported by FK)
--   - Storyboard title for identification
--   - Input type (voiceover_script vs cinematic_flow)
--   - Active storyboard flag
--   - Ordering
-- ─────────────────────────────────────────────────────────────────────────────

-- Title for storyboard identification (e.g. "Episode 1", "Trailer Cut", "Scene 3 Alt")
ALTER TABLE studio.storyboards
  ADD COLUMN IF NOT EXISTS title TEXT;

-- Input type: what kind of content the user provides
-- voiceover_script = narrative mode (existing behavior)
-- cinematic_flow   = cinematic mode (director flow brief)
ALTER TABLE studio.storyboards
  ADD COLUMN IF NOT EXISTS input_type TEXT NOT NULL DEFAULT 'voiceover_script';

-- Active storyboard flag (which one is currently being worked on)
ALTER TABLE studio.storyboards
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;

-- Sort order for storyboard list
ALTER TABLE studio.storyboards
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Index for fast active storyboard lookup
CREATE INDEX IF NOT EXISTS idx_storyboards_project_active
  ON studio.storyboards(project_id, is_active)
  WHERE is_active = true;

-- Index for ordering
CREATE INDEX IF NOT EXISTS idx_storyboards_project_sort
  ON studio.storyboards(project_id, sort_order);

COMMIT;
