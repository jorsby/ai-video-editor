-- Add transcription JSONB columns to scenes for word-by-word transcription storage
ALTER TABLE studio.scenes
  ADD COLUMN IF NOT EXISTS video_transcription jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS voiceover_transcription jsonb DEFAULT NULL;
