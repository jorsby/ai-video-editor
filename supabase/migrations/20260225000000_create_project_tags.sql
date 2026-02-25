CREATE TABLE project_tags (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  UNIQUE(user_id, project_id, tag)
);

CREATE INDEX idx_project_tags_lookup ON project_tags (user_id, project_id);

ALTER TABLE project_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tags"
  ON project_tags FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own tags"
  ON project_tags FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own tags"
  ON project_tags FOR DELETE
  USING (user_id = auth.uid());
