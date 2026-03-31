-- Add audio_duration + video_duration to scenes
-- duration becomes a generated column: COALESCE(audio_duration, video_duration)
-- Priority: audio wins because it drives the narrative pace

-- Step 1: Add the two real source columns
ALTER TABLE studio.scenes ADD COLUMN IF NOT EXISTS audio_duration double precision;
ALTER TABLE studio.scenes ADD COLUMN IF NOT EXISTS video_duration double precision;

-- Step 2: Drop the old manual duration column and recreate as generated
ALTER TABLE studio.scenes DROP COLUMN IF EXISTS duration;
ALTER TABLE studio.scenes ADD COLUMN duration double precision
  GENERATED ALWAYS AS (COALESCE(audio_duration, video_duration)) STORED;
