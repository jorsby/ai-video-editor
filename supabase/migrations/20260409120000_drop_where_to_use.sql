-- Remove the where_to_use column from project_asset_variants (no longer used)
ALTER TABLE studio.project_asset_variants DROP COLUMN IF EXISTS where_to_use;
