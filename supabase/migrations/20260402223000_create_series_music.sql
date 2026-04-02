-- Create series_music table for Suno-generated music assets
CREATE TABLE IF NOT EXISTS studio.series_music (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES studio.series(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  music_type TEXT NOT NULL CHECK (music_type IN ('lyrical', 'instrumental')),
  prompt TEXT,
  style TEXT,
  title TEXT,
  audio_url TEXT,
  cover_image_url TEXT,
  duration FLOAT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'done', 'failed')),
  task_id TEXT,
  suno_track_id TEXT,
  generation_metadata JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_series_music_series_id ON studio.series_music(series_id);

-- updated_at trigger
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_series_music_updated_at'
      AND tgrelid = 'studio.series_music'::regclass
  ) THEN
    CREATE TRIGGER trg_series_music_updated_at
    BEFORE UPDATE ON studio.series_music
    FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();
  END IF;
END $$;

-- RLS
ALTER TABLE studio.series_music ENABLE ROW LEVEL SECURITY;

CREATE POLICY series_music_select ON studio.series_music
  FOR SELECT USING (
    series_id IN (SELECT id FROM studio.series WHERE user_id = auth.uid())
  );

CREATE POLICY series_music_insert ON studio.series_music
  FOR INSERT WITH CHECK (
    series_id IN (SELECT id FROM studio.series WHERE user_id = auth.uid())
  );

CREATE POLICY series_music_update ON studio.series_music
  FOR UPDATE USING (
    series_id IN (SELECT id FROM studio.series WHERE user_id = auth.uid())
  );

CREATE POLICY series_music_delete ON studio.series_music
  FOR DELETE USING (
    series_id IN (SELECT id FROM studio.series WHERE user_id = auth.uid())
  );
