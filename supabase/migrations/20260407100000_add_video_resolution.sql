-- Add video_resolution column to videos table (default 480p)
ALTER TABLE studio.videos ADD COLUMN IF NOT EXISTS video_resolution TEXT NOT NULL DEFAULT '480p';
