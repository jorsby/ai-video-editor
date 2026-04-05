-- ============================================================================
-- Migration: Characters, Backgrounds, First/Last Frame system
--
-- Creates:
--   1. project_characters + project_character_variants (face grid based)
--   2. project_backgrounds (flat, no variants)
--   3. Adds first/last frame fields + background_slug to scenes
--   4. Drops old location_variant_slug from scenes
--   5. Removes character/location rows from project_assets (props only)
-- ============================================================================
BEGIN;

-- ─── 1. project_characters ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS studio.project_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES studio.projects(id) ON DELETE CASCADE,

  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slug TEXT NOT NULL CHECK (length(trim(slug)) > 0),
  description TEXT,

  -- 4-up turnaround grid image (front/back/left/right in one image)
  face_grid_url TEXT,
  face_grid_status TEXT NOT NULL DEFAULT 'idle',
  face_grid_task_id TEXT,

  is_reviewed BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_project_characters_project_slug UNIQUE (project_id, slug)
);

CREATE INDEX idx_project_characters_project_id ON studio.project_characters(project_id);

-- ─── 2. project_character_variants ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS studio.project_character_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES studio.project_characters(id) ON DELETE CASCADE,

  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slug TEXT NOT NULL CHECK (length(trim(slug)) > 0),
  prompt TEXT NOT NULL DEFAULT '',
  image_url TEXT,

  is_main BOOLEAN NOT NULL DEFAULT false,

  image_task_id TEXT,
  image_gen_status TEXT NOT NULL DEFAULT 'idle',

  is_reviewed BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_project_char_variants_char_slug UNIQUE (character_id, slug)
);

CREATE INDEX idx_project_char_variants_character_id ON studio.project_character_variants(character_id);

-- ─── 3. project_backgrounds ─────────────────────────────────────────────────
-- Flat table — no variants. First/last frame system handles scene-level variation.
CREATE TABLE IF NOT EXISTS studio.project_backgrounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES studio.projects(id) ON DELETE CASCADE,

  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slug TEXT NOT NULL CHECK (length(trim(slug)) > 0),
  description TEXT,

  prompt TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  image_gen_status TEXT NOT NULL DEFAULT 'idle',
  image_task_id TEXT,

  is_reviewed BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_project_backgrounds_project_slug UNIQUE (project_id, slug)
);

CREATE INDEX idx_project_backgrounds_project_id ON studio.project_backgrounds(project_id);

-- ─── 4. Scenes: add first/last frame + background_slug ─────────────────────
ALTER TABLE studio.scenes
  ADD COLUMN IF NOT EXISTS background_slug TEXT,
  ADD COLUMN IF NOT EXISTS first_frame_url TEXT,
  ADD COLUMN IF NOT EXISTS first_frame_prompt TEXT,
  ADD COLUMN IF NOT EXISTS first_frame_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS first_frame_task_id TEXT,
  ADD COLUMN IF NOT EXISTS last_frame_url TEXT,
  ADD COLUMN IF NOT EXISTS last_frame_prompt TEXT,
  ADD COLUMN IF NOT EXISTS last_frame_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS last_frame_task_id TEXT;

CREATE INDEX IF NOT EXISTS idx_scenes_background_slug ON studio.scenes(background_slug);

-- ─── 5. Drop old location_variant_slug from scenes ─────────────────────────
DROP INDEX IF EXISTS studio.idx_scenes_location_variant_slug;
ALTER TABLE studio.scenes DROP COLUMN IF EXISTS location_variant_slug;

-- ─── 6. Clean up project_assets: remove character/location rows ─────────────
-- project_assets now only holds props.
-- Cascade deletes their variants too.
DELETE FROM studio.project_assets WHERE type IN ('character', 'location');

-- ─── 7. RLS policies for new tables ────────────────────────────────────────
ALTER TABLE studio.project_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.project_character_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.project_backgrounds ENABLE ROW LEVEL SECURITY;

-- project_characters: users can see/edit their own project's characters
CREATE POLICY "Users can manage own project characters"
  ON studio.project_characters FOR ALL
  USING (
    project_id IN (SELECT id FROM studio.projects WHERE user_id = auth.uid())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM studio.projects WHERE user_id = auth.uid())
  );

-- Service role bypass
CREATE POLICY "Service role full access to project_characters"
  ON studio.project_characters FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- project_character_variants: users can manage variants of their characters
CREATE POLICY "Users can manage own character variants"
  ON studio.project_character_variants FOR ALL
  USING (
    character_id IN (
      SELECT c.id FROM studio.project_characters c
      JOIN studio.projects p ON p.id = c.project_id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    character_id IN (
      SELECT c.id FROM studio.project_characters c
      JOIN studio.projects p ON p.id = c.project_id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role full access to project_character_variants"
  ON studio.project_character_variants FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- project_backgrounds: users can manage own project's backgrounds
CREATE POLICY "Users can manage own project backgrounds"
  ON studio.project_backgrounds FOR ALL
  USING (
    project_id IN (SELECT id FROM studio.projects WHERE user_id = auth.uid())
  )
  WITH CHECK (
    project_id IN (SELECT id FROM studio.projects WHERE user_id = auth.uid())
  );

CREATE POLICY "Service role full access to project_backgrounds"
  ON studio.project_backgrounds FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── 8. updated_at triggers ────────────────────────────────────────────────
CREATE TRIGGER trg_project_characters_updated_at
  BEFORE UPDATE ON studio.project_characters
  FOR EACH ROW EXECUTE FUNCTION studio.update_updated_at();

CREATE TRIGGER trg_project_character_variants_updated_at
  BEFORE UPDATE ON studio.project_character_variants
  FOR EACH ROW EXECUTE FUNCTION studio.update_updated_at();

CREATE TRIGGER trg_project_backgrounds_updated_at
  BEFORE UPDATE ON studio.project_backgrounds
  FOR EACH ROW EXECUTE FUNCTION studio.update_updated_at();

COMMIT;
