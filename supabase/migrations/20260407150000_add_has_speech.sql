-- Add has_speech column to scenes table for speech detection
-- When true, video audio should be muted in timeline (speech conflicts with voiceover)
ALTER TABLE studio.scenes
  ADD COLUMN IF NOT EXISTS has_speech BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN studio.scenes.has_speech IS 'Whether the generated video contains speech audio (detected via Deepgram)';
