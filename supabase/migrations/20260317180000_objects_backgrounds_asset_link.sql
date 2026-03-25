-- Add series_asset_variant_id to objects and backgrounds for live asset resolution
-- When present, the UI resolves the latest image from the variant instead of using stored url/final_url

ALTER TABLE studio.objects ADD COLUMN IF NOT EXISTS series_asset_variant_id uuid REFERENCES studio.series_asset_variants(id);
ALTER TABLE studio.backgrounds ADD COLUMN IF NOT EXISTS series_asset_variant_id uuid REFERENCES studio.series_asset_variants(id);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_objects_series_asset_variant_id ON studio.objects(series_asset_variant_id) WHERE series_asset_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_backgrounds_series_asset_variant_id ON studio.backgrounds(series_asset_variant_id) WHERE series_asset_variant_id IS NOT NULL;
