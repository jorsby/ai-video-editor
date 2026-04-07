-- Restore archived_at column (was dropped in phase2 schema reset)
ALTER TABLE studio.projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_archived_at ON studio.projects (user_id, archived_at)
  WHERE archived_at IS NULL;
