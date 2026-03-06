-- Create workflow_runs and workflow_run_lanes tables for batch publish observability.
-- Stores only linking metadata (mixpost_uuid per lane + status).
-- Post content (captions, media, accounts) lives exclusively in Mixpost.

CREATE TABLE workflow_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id    UUID,
  schedule_type TEXT NOT NULL,   -- 'now' | 'scheduled'
  base_date     TEXT,            -- YYYY-MM-DD (user's original date, before stagger offsets)
  base_time     TEXT,            -- HH:mm (user's original time, before stagger offsets)
  timezone      TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE workflow_run_lanes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id  UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  language         TEXT NOT NULL,
  mixpost_uuid     TEXT,          -- null until the Mixpost post is successfully created
  status           TEXT NOT NULL DEFAULT 'pending',
                                  -- pending | uploading | creating | scheduled | published | failed
  error_message    TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_workflow_runs_user_id    ON workflow_runs(user_id);
CREATE INDEX idx_workflow_runs_project_id ON workflow_runs(project_id);
CREATE INDEX idx_wrl_run_id              ON workflow_run_lanes(workflow_run_id);
CREATE INDEX idx_wrl_mixpost_uuid        ON workflow_run_lanes(mixpost_uuid)
  WHERE mixpost_uuid IS NOT NULL;

ALTER TABLE workflow_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_lanes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own workflow runs"
  ON workflow_runs FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Users can manage own workflow run lanes"
  ON workflow_run_lanes FOR ALL
  USING (workflow_run_id IN (
    SELECT id FROM workflow_runs WHERE user_id = auth.uid()
  ));
