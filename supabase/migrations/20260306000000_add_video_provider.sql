ALTER TABLE studio.scenes
ADD COLUMN IF NOT EXISTS video_provider text DEFAULT NULL;

COMMENT ON COLUMN studio.scenes.video_provider IS
  'Video generation provider: null for fal.ai (default), skyreels for SkyReels API';
