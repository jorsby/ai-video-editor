-- Remove multi-language infrastructure from DB.
-- Single timeline per project, no language switching.

-- 1. Drop translation_jobs table entirely
DROP TABLE IF EXISTS studio.translation_jobs CASCADE;

-- 2. Remove language column from tracks
ALTER TABLE studio.tracks DROP COLUMN IF EXISTS language;

-- 3. Remove language column from scenes
ALTER TABLE studio.scenes DROP COLUMN IF EXISTS language;

-- 4. Remove language column from rendered_videos (if exists)
ALTER TABLE studio.rendered_videos DROP COLUMN IF EXISTS language;

-- 5. Remove language column from workflow_runs (if exists)
ALTER TABLE studio.workflow_runs DROP COLUMN IF EXISTS language;

-- 6. Remove language column from transcriptions (if exists)
ALTER TABLE studio.transcriptions DROP COLUMN IF EXISTS language;
