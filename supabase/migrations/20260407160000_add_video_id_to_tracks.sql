-- Add video_id column to tracks table so each video has its own timeline
ALTER TABLE studio.tracks
  ADD COLUMN IF NOT EXISTS video_id UUID REFERENCES studio.videos(id) ON DELETE CASCADE;

-- Backfill existing tracks: assign them to the first video of their project
UPDATE studio.tracks t
SET video_id = (
  SELECT v.id FROM studio.videos v
  WHERE v.project_id = t.project_id
  ORDER BY v.created_at ASC
  LIMIT 1
)
WHERE t.video_id IS NULL;

-- Create index for fast lookup
CREATE INDEX IF NOT EXISTS idx_tracks_video_id ON studio.tracks(video_id);
