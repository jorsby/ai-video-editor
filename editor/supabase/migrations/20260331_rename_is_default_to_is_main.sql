-- Rename is_default → is_main on series_asset_variants
-- Also make prompt and where_to_use NOT NULL with empty string default

BEGIN;

-- 1. Rename column
ALTER TABLE studio.series_asset_variants
  RENAME COLUMN is_default TO is_main;

-- 2. Make prompt NOT NULL (backfill NULLs first)
UPDATE studio.series_asset_variants SET prompt = '' WHERE prompt IS NULL;
ALTER TABLE studio.series_asset_variants
  ALTER COLUMN prompt SET NOT NULL,
  ALTER COLUMN prompt SET DEFAULT '';

-- 3. Make where_to_use NOT NULL (backfill NULLs first)
UPDATE studio.series_asset_variants SET where_to_use = '' WHERE where_to_use IS NULL;
ALTER TABLE studio.series_asset_variants
  ALTER COLUMN where_to_use SET NOT NULL,
  ALTER COLUMN where_to_use SET DEFAULT '';

COMMIT;
