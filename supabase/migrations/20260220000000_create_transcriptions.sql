-- Create transcriptions table to cache Deepgram transcription results
CREATE TABLE transcriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'nova-3',
  language TEXT,
  duration REAL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, source_url, model)
);

CREATE INDEX idx_transcriptions_project_source
  ON transcriptions(project_id, source_url);

-- Enable RLS
ALTER TABLE transcriptions ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can only access transcriptions for their own projects
CREATE POLICY "Users can view own transcriptions"
  ON transcriptions FOR SELECT
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own transcriptions"
  ON transcriptions FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own transcriptions"
  ON transcriptions FOR UPDATE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own transcriptions"
  ON transcriptions FOR DELETE
  USING (
    project_id IN (
      SELECT id FROM projects WHERE user_id = auth.uid()
    )
  );
