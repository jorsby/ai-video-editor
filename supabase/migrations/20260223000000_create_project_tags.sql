CREATE TABLE project_tags (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  UNIQUE(user_id, project_id, tag)
);

CREATE INDEX idx_project_tags_lookup ON project_tags (user_id, project_id);
