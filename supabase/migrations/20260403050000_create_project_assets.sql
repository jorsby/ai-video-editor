-- ============================================================================
-- Migration: series_assets → project_assets, series_music → project_music
-- Moves asset and music ownership from series-level to project-level.
-- Preserves all UUIDs, slugs, and data exactly.
-- ============================================================================
BEGIN;

-- ─── 1. Create project_assets ───────────────────────────────────────────────
-- Mirrors studio.series_assets but with project_id instead of series_id
CREATE TABLE IF NOT EXISTS studio.project_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES studio.projects(id) ON DELETE CASCADE,

  type studio.asset_type NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slug TEXT NOT NULL CHECK (length(trim(slug)) > 0),
  description TEXT,

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_project_assets_project_slug UNIQUE (project_id, slug)
);

-- ─── 2. Create project_asset_variants ───────────────────────────────────────
-- Mirrors studio.series_asset_variants exactly (including is_main, image_task_id, image_gen_status)
CREATE TABLE IF NOT EXISTS studio.project_asset_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES studio.project_assets(id) ON DELETE CASCADE,

  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slug TEXT NOT NULL CHECK (length(trim(slug)) > 0),
  prompt TEXT NOT NULL DEFAULT '',
  image_url TEXT,

  is_main BOOLEAN NOT NULL DEFAULT false,

  where_to_use TEXT NOT NULL DEFAULT '',
  reasoning TEXT,

  image_task_id TEXT,
  image_gen_status TEXT NOT NULL DEFAULT 'idle',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_project_asset_variants_asset_slug UNIQUE (asset_id, slug)
);

-- Unique partial index: only one is_main=true per asset
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_asset_variants_main_per_asset
  ON studio.project_asset_variants (asset_id) WHERE is_main;

-- ─── 3. Create project_music ────────────────────────────────────────────────
-- Mirrors studio.series_music but with project_id instead of series_id
CREATE TABLE IF NOT EXISTS studio.project_music (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES studio.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  music_type TEXT NOT NULL CHECK (music_type IN ('lyrical', 'instrumental')),
  prompt TEXT,
  style TEXT,
  title TEXT,
  audio_url TEXT,
  cover_image_url TEXT,
  duration FLOAT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'done', 'failed')),
  task_id TEXT,
  suno_track_id TEXT,
  generation_metadata JSONB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4. Migrate data: series_assets → project_assets ────────────────────────
-- Preserves UUIDs exactly. Maps series_id → project_id via series.project_id.
INSERT INTO studio.project_assets (id, project_id, type, name, slug, description, sort_order, created_at, updated_at)
SELECT
  sa.id,
  s.project_id,
  sa.type,
  sa.name,
  sa.slug,
  sa.description,
  sa.sort_order,
  sa.created_at,
  sa.updated_at
FROM studio.series_assets sa
JOIN studio.series s ON s.id = sa.series_id
ON CONFLICT (id) DO NOTHING;

-- ─── 5. Migrate data: series_asset_variants → project_asset_variants ────────
INSERT INTO studio.project_asset_variants (id, asset_id, name, slug, prompt, image_url, is_main, where_to_use, reasoning, image_task_id, image_gen_status, created_at, updated_at)
SELECT
  sav.id,
  sav.asset_id,  -- same UUID, now points to project_assets
  sav.name,
  sav.slug,
  sav.prompt,
  sav.image_url,
  sav.is_main,
  sav.where_to_use,
  sav.reasoning,
  sav.image_task_id,
  sav.image_gen_status,
  sav.created_at,
  sav.updated_at
FROM studio.series_asset_variants sav
WHERE EXISTS (SELECT 1 FROM studio.project_assets pa WHERE pa.id = sav.asset_id)
ON CONFLICT (id) DO NOTHING;

-- ─── 6. Migrate data: series_music → project_music ──────────────────────────
INSERT INTO studio.project_music (id, project_id, name, music_type, prompt, style, title, audio_url, cover_image_url, duration, status, task_id, suno_track_id, generation_metadata, sort_order, created_at, updated_at)
SELECT
  sm.id,
  s.project_id,
  sm.name,
  sm.music_type,
  sm.prompt,
  sm.style,
  sm.title,
  sm.audio_url,
  sm.cover_image_url,
  sm.duration,
  sm.status,
  sm.task_id,
  sm.suno_track_id,
  sm.generation_metadata,
  sm.sort_order,
  sm.created_at,
  sm.updated_at
FROM studio.series_music sm
JOIN studio.series s ON s.id = sm.series_id
ON CONFLICT (id) DO NOTHING;

-- ─── 7. Indexes ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_project_assets_project_id
  ON studio.project_assets(project_id);

CREATE INDEX IF NOT EXISTS idx_project_assets_project_type
  ON studio.project_assets(project_id, type);

CREATE INDEX IF NOT EXISTS idx_project_asset_variants_asset_id
  ON studio.project_asset_variants(asset_id);

CREATE INDEX IF NOT EXISTS idx_project_asset_variants_slug
  ON studio.project_asset_variants(slug);

CREATE INDEX IF NOT EXISTS idx_project_music_project_id
  ON studio.project_music(project_id);

-- ─── 8. Updated_at triggers ─────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_project_assets_updated_at'
      AND tgrelid = 'studio.project_assets'::regclass
  ) THEN
    CREATE TRIGGER trg_project_assets_updated_at
    BEFORE UPDATE ON studio.project_assets
    FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_project_asset_variants_updated_at'
      AND tgrelid = 'studio.project_asset_variants'::regclass
  ) THEN
    CREATE TRIGGER trg_project_asset_variants_updated_at
    BEFORE UPDATE ON studio.project_asset_variants
    FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_project_music_updated_at'
      AND tgrelid = 'studio.project_music'::regclass
  ) THEN
    CREATE TRIGGER trg_project_music_updated_at
    BEFORE UPDATE ON studio.project_music
    FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();
  END IF;
END $$;

-- ─── 9. Enable Realtime ─────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE studio.project_assets;
ALTER PUBLICATION supabase_realtime ADD TABLE studio.project_asset_variants;
ALTER PUBLICATION supabase_realtime ADD TABLE studio.project_music;

-- ─── 10. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE studio.project_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.project_asset_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.project_music ENABLE ROW LEVEL SECURITY;

-- project_assets: via projects.user_id
CREATE POLICY project_assets_select_own ON studio.project_assets
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.projects p WHERE p.id = project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY project_assets_insert_own ON studio.project_assets
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.projects p WHERE p.id = project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY project_assets_update_own ON studio.project_assets
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.projects p WHERE p.id = project_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.projects p WHERE p.id = project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY project_assets_delete_own ON studio.project_assets
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.projects p WHERE p.id = project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY project_assets_service_all ON studio.project_assets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- project_asset_variants: via asset → project
CREATE POLICY project_asset_variants_select_own ON studio.project_asset_variants
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.project_assets pa
    JOIN studio.projects p ON p.id = pa.project_id
    WHERE pa.id = asset_id AND p.user_id = auth.uid()
  ));

CREATE POLICY project_asset_variants_insert_own ON studio.project_asset_variants
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.project_assets pa
    JOIN studio.projects p ON p.id = pa.project_id
    WHERE pa.id = asset_id AND p.user_id = auth.uid()
  ));

CREATE POLICY project_asset_variants_update_own ON studio.project_asset_variants
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.project_assets pa
    JOIN studio.projects p ON p.id = pa.project_id
    WHERE pa.id = asset_id AND p.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.project_assets pa
    JOIN studio.projects p ON p.id = pa.project_id
    WHERE pa.id = asset_id AND p.user_id = auth.uid()
  ));

CREATE POLICY project_asset_variants_delete_own ON studio.project_asset_variants
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.project_assets pa
    JOIN studio.projects p ON p.id = pa.project_id
    WHERE pa.id = asset_id AND p.user_id = auth.uid()
  ));

CREATE POLICY project_asset_variants_service_all ON studio.project_asset_variants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- project_music: via projects.user_id
CREATE POLICY project_music_select_own ON studio.project_music
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.projects p WHERE p.id = project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY project_music_insert_own ON studio.project_music
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.projects p WHERE p.id = project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY project_music_update_own ON studio.project_music
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.projects p WHERE p.id = project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY project_music_delete_own ON studio.project_music
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.projects p WHERE p.id = project_id AND p.user_id = auth.uid()
  ));

CREATE POLICY project_music_service_all ON studio.project_music
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─── 11. Verification ───────────────────────────────────────────────────────
DO $$
DECLARE
  old_assets INT;
  new_assets INT;
  old_variants INT;
  new_variants INT;
  old_music INT;
  new_music INT;
BEGIN
  SELECT count(*) INTO old_assets FROM studio.series_assets;
  SELECT count(*) INTO new_assets FROM studio.project_assets;
  SELECT count(*) INTO old_variants FROM studio.series_asset_variants;
  SELECT count(*) INTO new_variants FROM studio.project_asset_variants;
  SELECT count(*) INTO old_music FROM studio.series_music;
  SELECT count(*) INTO new_music FROM studio.project_music;

  RAISE NOTICE 'Migration verification:';
  RAISE NOTICE '  series_assets: % → project_assets: %', old_assets, new_assets;
  RAISE NOTICE '  series_asset_variants: % → project_asset_variants: %', old_variants, new_variants;
  RAISE NOTICE '  series_music: % → project_music: %', old_music, new_music;

  IF old_assets != new_assets THEN
    RAISE EXCEPTION 'MISMATCH: series_assets (%) != project_assets (%)', old_assets, new_assets;
  END IF;
  IF old_variants != new_variants THEN
    RAISE EXCEPTION 'MISMATCH: series_asset_variants (%) != project_asset_variants (%)', old_variants, new_variants;
  END IF;
  IF old_music != new_music THEN
    RAISE EXCEPTION 'MISMATCH: series_music (%) != project_music (%)', old_music, new_music;
  END IF;
END $$;

COMMIT;
