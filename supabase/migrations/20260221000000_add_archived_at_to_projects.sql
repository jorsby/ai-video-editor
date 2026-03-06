-- Add archived_at column to projects table
ALTER TABLE projects ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;

-- Partial index for efficient filtering of active (non-archived) projects
CREATE INDEX idx_projects_archived_at ON projects (user_id, archived_at)
  WHERE archived_at IS NULL;
