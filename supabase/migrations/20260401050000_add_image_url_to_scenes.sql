-- Add image_url column to scenes for first-frame/generated image storage.
-- This stores the reference image generated from the scene's visual prompt,
-- used as input for video generation (image-to-video).

ALTER TABLE studio.scenes ADD COLUMN IF NOT EXISTS image_url TEXT;
