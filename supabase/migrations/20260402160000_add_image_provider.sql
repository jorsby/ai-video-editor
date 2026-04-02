-- Add image_provider column to series table.
-- Controls which provider is used for image generation (text-to-image and edit).
-- Default is 'kie' (Kie.ai). Alternative: 'fal' (fal.ai) for projects
-- that need relaxed content moderation (safety_tolerance).

ALTER TABLE studio.series
  ADD COLUMN IF NOT EXISTS image_provider text NOT NULL DEFAULT 'kie';

COMMENT ON COLUMN studio.series.image_provider IS 'Image generation provider: kie | fal';
