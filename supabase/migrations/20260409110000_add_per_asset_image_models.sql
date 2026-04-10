-- Per-asset-type image model configuration
-- Stores t2i model per asset type: {"character":"z-image","location":"gpt-image/1.5-text-to-image","prop":"z-image"}
ALTER TABLE studio.videos
  ADD COLUMN IF NOT EXISTS image_models JSONB;

-- Backfill existing videos: preserve current Flux 2 Pro behavior
UPDATE studio.videos
SET image_models = jsonb_build_object(
  'character', COALESCE(image_model, 'flux-2/pro-text-to-image'),
  'location', COALESCE(image_model, 'flux-2/pro-text-to-image'),
  'prop', COALESCE(image_model, 'flux-2/pro-text-to-image')
)
WHERE image_models IS NULL;
