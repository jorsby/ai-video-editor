-- =============================================================================
-- Prompt-Driven Generation
-- Phase 0: Series metadata production fields (stored in existing metadata jsonb)
-- Phase 1: generation_prompt, generation_meta, feedback columns + generation_logs table
-- =============================================================================

-- ── Phase 1a: Objects ────────────────────────────────────────────────────────

ALTER TABLE studio.objects
  ADD COLUMN IF NOT EXISTS generation_prompt text,
  ADD COLUMN IF NOT EXISTS generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS feedback text;

-- ── Phase 1a: Backgrounds ────────────────────────────────────────────────────

ALTER TABLE studio.backgrounds
  ADD COLUMN IF NOT EXISTS generation_prompt text,
  ADD COLUMN IF NOT EXISTS generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS feedback text;

-- ── Phase 1a: Scenes ─────────────────────────────────────────────────────────
-- Already has: prompt text, multi_prompt jsonb

ALTER TABLE studio.scenes
  ADD COLUMN IF NOT EXISTS generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS feedback text;

-- ── Phase 1a: Voiceovers ─────────────────────────────────────────────────────
-- Already has: text text

ALTER TABLE studio.voiceovers
  ADD COLUMN IF NOT EXISTS generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS feedback text;

-- ── Phase 1b: generation_logs table ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS studio.generation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('object', 'background', 'scene', 'voiceover')),
  entity_id uuid NOT NULL,
  storyboard_id uuid REFERENCES studio.storyboards(id) ON DELETE SET NULL,
  version int NOT NULL DEFAULT 1,
  prompt text,
  generation_meta jsonb,
  feedback text,
  result_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup: latest version per entity
CREATE INDEX IF NOT EXISTS idx_generation_logs_entity
  ON studio.generation_logs (entity_type, entity_id, version DESC);

-- Cross-episode queries
CREATE INDEX IF NOT EXISTS idx_generation_logs_storyboard
  ON studio.generation_logs (storyboard_id)
  WHERE storyboard_id IS NOT NULL;

-- ── RLS: generation_logs ─────────────────────────────────────────────────────

ALTER TABLE studio.generation_logs ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS; for user-facing reads, join through storyboard ownership
CREATE POLICY "generation_logs_service_all"
  ON studio.generation_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);
