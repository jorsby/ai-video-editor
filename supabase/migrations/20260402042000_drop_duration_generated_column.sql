-- Drop the generated `duration` column from scenes.
-- We now use audio_duration and video_duration directly everywhere.
-- The generated column was COALESCE(audio_duration, video_duration)
-- which was misleading since both source columns were often stale/null.

ALTER TABLE studio.scenes DROP COLUMN IF EXISTS duration;
