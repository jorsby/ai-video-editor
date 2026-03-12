-- Translation idempotency + observability for narration localization.
-- Used by /api/translate-languages to prevent duplicate translation/TTS pipelines.

CREATE TABLE IF NOT EXISTS translation_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id         UUID NOT NULL,
  storyboard_id      UUID NOT NULL,
  source_language    TEXT NOT NULL,
  target_language    TEXT NOT NULL,
  idempotency_key    TEXT NOT NULL,
  script_hash        TEXT NOT NULL,
  voice_profile_hash TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'processing',
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_translation_jobs_idempotency_key
  ON translation_jobs(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_user_id
  ON translation_jobs(user_id);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_project_id
  ON translation_jobs(project_id);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_storyboard_id
  ON translation_jobs(storyboard_id);

CREATE INDEX IF NOT EXISTS idx_translation_jobs_status
  ON translation_jobs(status);

ALTER TABLE translation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own translation jobs" ON translation_jobs;
CREATE POLICY "Users can manage own translation jobs"
  ON translation_jobs
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
