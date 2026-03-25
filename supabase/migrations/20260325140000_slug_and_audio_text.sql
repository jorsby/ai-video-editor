-- =============================================================================
-- Slug-based asset matching + voiceover_text → audio_text rename
-- =============================================================================

-- ── 1. Add slug to series_assets ─────────────────────────────────────────────

ALTER TABLE studio.series_assets
  ADD COLUMN IF NOT EXISTS slug TEXT;

-- Auto-generate slugs from existing names:
-- lowercase, replace non-alphanumeric with underscore, collapse multiple underscores, trim edges
UPDATE studio.series_assets
SET slug = regexp_replace(
  regexp_replace(
    regexp_replace(lower(name), '[^a-z0-9]', '_', 'g'),
    '_+', '_', 'g'
  ),
  '^_|_$', '', 'g'
)
WHERE slug IS NULL;

-- Now make it NOT NULL
ALTER TABLE studio.series_assets
  ALTER COLUMN slug SET NOT NULL;

-- Unique per series (two assets in same series can't have same slug)
CREATE UNIQUE INDEX IF NOT EXISTS idx_series_assets_slug_unique
  ON studio.series_assets(series_id, slug);

-- ── 2. Auto-generate slug on INSERT via trigger ──────────────────────────────

CREATE OR REPLACE FUNCTION studio.generate_asset_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := regexp_replace(
      regexp_replace(
        regexp_replace(lower(NEW.name), '[^a-z0-9]', '_', 'g'),
        '_+', '_', 'g'
      ),
      '^_|_$', '', 'g'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_series_assets_generate_slug ON studio.series_assets;
CREATE TRIGGER trg_series_assets_generate_slug
  BEFORE INSERT OR UPDATE OF name ON studio.series_assets
  FOR EACH ROW
  EXECUTE FUNCTION studio.generate_asset_slug();

-- ── 3. Add scene-level columns (audio_text, visual_direction, etc.) ──────────
-- These columns support the new single-prompt scene model.

ALTER TABLE studio.scenes ADD COLUMN IF NOT EXISTS audio_text TEXT;
ALTER TABLE studio.scenes ADD COLUMN IF NOT EXISTS visual_direction TEXT;
ALTER TABLE studio.scenes ADD COLUMN IF NOT EXISTS shot_durations JSONB;
ALTER TABLE studio.scenes ADD COLUMN IF NOT EXISTS duration INTEGER;
ALTER TABLE studio.scenes ADD COLUMN IF NOT EXISTS background_name TEXT;
ALTER TABLE studio.scenes ADD COLUMN IF NOT EXISTS object_names JSONB;
ALTER TABLE studio.scenes ADD COLUMN IF NOT EXISTS language VARCHAR(5);
