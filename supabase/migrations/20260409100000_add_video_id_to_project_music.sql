-- Add optional video_id to project_music so music can be scoped per video.
-- Existing rows keep video_id = NULL (project-wide music).
-- ON DELETE SET NULL: if a video is deleted, the music stays (becomes project-wide).
ALTER TABLE studio.project_music
  ADD COLUMN IF NOT EXISTS video_id UUID REFERENCES studio.videos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_music_video_id
  ON studio.project_music(video_id);
