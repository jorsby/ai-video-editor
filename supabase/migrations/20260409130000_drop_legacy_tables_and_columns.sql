-- Remove legacy tables and unused columns

-- 1. Drop studio.assets (replaced by project_assets + project_asset_variants, 0 rows)
DROP TABLE IF EXISTS studio.assets;

-- 2. Drop studio.generation_log (never used, 0 rows)
DROP TABLE IF EXISTS studio.generation_log;

-- 3. Drop unused columns from studio.videos
ALTER TABLE studio.videos DROP COLUMN IF EXISTS image_provider;
ALTER TABLE studio.videos DROP COLUMN IF EXISTS image_model;

-- 4. Drop legacy suno_track_id from studio.project_music
ALTER TABLE studio.project_music DROP COLUMN IF EXISTS suno_track_id;
