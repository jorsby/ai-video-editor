-- Add scene-level fields for the new scene-based workflow
-- Scenes are now created individually (not from plan blob)

ALTER TABLE studio.scenes
  ADD COLUMN IF NOT EXISTS voiceover_text text,
  ADD COLUMN IF NOT EXISTS visual_direction text,
  ADD COLUMN IF NOT EXISTS shot_durations jsonb,
  ADD COLUMN IF NOT EXISTS background_name text,
  ADD COLUMN IF NOT EXISTS object_names jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS language text DEFAULT 'tr';

COMMENT ON COLUMN studio.scenes.voiceover_text IS 'Narration text for this scene (narrative mode)';
COMMENT ON COLUMN studio.scenes.visual_direction IS 'Visual direction from the split outline';
COMMENT ON COLUMN studio.scenes.shot_durations IS 'JSON array of per-shot durations in seconds';
COMMENT ON COLUMN studio.scenes.background_name IS 'Location name — matched to series_assets.name';
COMMENT ON COLUMN studio.scenes.object_names IS 'JSON array of character/prop names — matched to series_assets.name';
COMMENT ON COLUMN studio.scenes.language IS 'Language code for voiceover (tr, en, etc.)';
