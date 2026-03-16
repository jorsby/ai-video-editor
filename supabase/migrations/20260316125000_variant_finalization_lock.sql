BEGIN;

ALTER TABLE studio.series_asset_variants
  ADD COLUMN IF NOT EXISTS is_finalized BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_series_asset_variants_is_finalized
  ON studio.series_asset_variants(is_finalized);

COMMIT;
