-- Create text_presets table to store user-saved text style presets
CREATE TABLE text_presets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  style JSONB NOT NULL,
  clip_properties JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_text_presets_user_id ON text_presets(user_id);

-- Enable RLS
ALTER TABLE text_presets ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can only access their own presets
CREATE POLICY "Users can view own text presets"
  ON text_presets FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own text presets"
  ON text_presets FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own text presets"
  ON text_presets FOR DELETE
  USING (user_id = auth.uid());
