BEGIN;

-- =============================================================================
-- Phase 2 schema reset (destructive by design)
-- Final hierarchy:
--   projects -> series -> series_assets -> series_asset_variants -> episodes -> scenes
-- =============================================================================

-- Keep updated_at behavior consistent across final tables.
CREATE OR REPLACE FUNCTION studio.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Final enums
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'studio' AND t.typname = 'content_mode'
  ) THEN
    CREATE TYPE studio.content_mode AS ENUM ('narrative', 'cinematic', 'hybrid');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'studio' AND t.typname = 'asset_type'
  ) THEN
    CREATE TYPE studio.asset_type AS ENUM ('character', 'location', 'prop');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'studio' AND t.typname = 'plan_status'
  ) THEN
    CREATE TYPE studio.plan_status AS ENUM ('draft', 'finalized');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'studio' AND t.typname = 'episode_status'
  ) THEN
    CREATE TYPE studio.episode_status AS ENUM ('draft', 'ready', 'in_progress', 'done');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'studio' AND t.typname = 'scene_status'
  ) THEN
    CREATE TYPE studio.scene_status AS ENUM ('draft', 'ready', 'in_progress', 'done', 'failed');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Drop removed / legacy tables (storyboard-era and deprecated links)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS studio.episode_assets CASCADE;
DROP TABLE IF EXISTS studio.episode_asset_variants CASCADE;
DROP TABLE IF EXISTS studio.series_asset_variant_images CASCADE;
DROP TABLE IF EXISTS studio.generation_logs CASCADE;
DROP TABLE IF EXISTS studio.first_frames CASCADE;
DROP TABLE IF EXISTS studio.voiceovers CASCADE;
DROP TABLE IF EXISTS studio.objects CASCADE;
DROP TABLE IF EXISTS studio.backgrounds CASCADE;
DROP TABLE IF EXISTS studio.grid_images CASCADE;
DROP TABLE IF EXISTS studio.storyboards CASCADE;
DROP TABLE IF EXISTS studio.series_generation_jobs CASCADE;

-- Reset core hierarchy tables so only approved columns remain.
DROP TABLE IF EXISTS studio.scenes CASCADE;
DROP TABLE IF EXISTS studio.series_episodes CASCADE;
DROP TABLE IF EXISTS studio.episodes CASCADE;
DROP TABLE IF EXISTS studio.series_asset_variants CASCADE;
DROP TABLE IF EXISTS studio.series_assets CASCADE;
DROP TABLE IF EXISTS studio.series CASCADE;

-- No longer used in final model.
DROP TYPE IF EXISTS studio.series_asset_type;

-- -----------------------------------------------------------------------------
-- Projects normalization (root table remains)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS studio.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE studio.projects
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE studio.projects
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE studio.projects
  DROP COLUMN IF EXISTS archived_at;

-- -----------------------------------------------------------------------------
-- Final hierarchy tables
-- -----------------------------------------------------------------------------
CREATE TABLE studio.series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES studio.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  genre TEXT,
  tone TEXT,
  bible TEXT,

  content_mode studio.content_mode NOT NULL DEFAULT 'narrative',

  language TEXT,
  aspect_ratio TEXT,

  video_model TEXT,
  image_model TEXT,
  voice_id TEXT,
  tts_speed NUMERIC,

  visual_style TEXT,

  creative_brief JSONB,
  plan_status studio.plan_status NOT NULL DEFAULT 'draft',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE studio.series_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES studio.series(id) ON DELETE CASCADE,

  type studio.asset_type NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slug TEXT NOT NULL CHECK (length(trim(slug)) > 0),
  description TEXT,

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_series_assets_series_slug UNIQUE (series_id, slug)
);

CREATE TABLE studio.series_asset_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES studio.series_assets(id) ON DELETE CASCADE,

  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  slug TEXT NOT NULL CHECK (length(trim(slug)) > 0),
  prompt TEXT,
  image_url TEXT,

  is_default BOOLEAN NOT NULL DEFAULT false,

  where_to_use TEXT,
  reasoning TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_series_asset_variants_asset_slug UNIQUE (asset_id, slug)
);

CREATE TABLE studio.episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES studio.series(id) ON DELETE CASCADE,

  "order" INTEGER NOT NULL CHECK ("order" > 0),
  title TEXT,
  synopsis TEXT,

  audio_content TEXT,
  visual_outline TEXT,

  asset_variant_map JSONB NOT NULL DEFAULT '{"characters": [], "locations": [], "props": []}'::jsonb,
  plan_json JSONB,

  status studio.episode_status NOT NULL DEFAULT 'draft',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_episodes_series_order UNIQUE (series_id, "order"),
  CONSTRAINT episodes_asset_variant_map_shape_chk CHECK (
    jsonb_typeof(asset_variant_map) = 'object'
    AND COALESCE(jsonb_typeof(asset_variant_map -> 'characters'), '') = 'array'
    AND COALESCE(jsonb_typeof(asset_variant_map -> 'locations'), '') = 'array'
    AND COALESCE(jsonb_typeof(asset_variant_map -> 'props'), '') = 'array'
  )
);

CREATE TABLE studio.scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES studio.episodes(id) ON DELETE CASCADE,

  "order" INTEGER NOT NULL CHECK ("order" > 0),
  title TEXT,

  duration INTEGER CHECK (duration IS NULL OR duration > 0),
  content_mode studio.content_mode,

  visual_direction TEXT,
  prompt TEXT,

  location_variant_slug TEXT,
  character_variant_slugs TEXT[] NOT NULL DEFAULT '{}'::text[],
  prop_variant_slugs TEXT[] NOT NULL DEFAULT '{}'::text[],

  audio_text TEXT,
  audio_url TEXT,

  video_url TEXT,
  status studio.scene_status NOT NULL DEFAULT 'draft',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_scenes_episode_order UNIQUE (episode_id, "order"),
  CONSTRAINT scenes_character_variant_slugs_no_null_chk CHECK (array_position(character_variant_slugs, NULL) IS NULL),
  CONSTRAINT scenes_prop_variant_slugs_no_null_chk CHECK (array_position(prop_variant_slugs, NULL) IS NULL)
);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_projects_updated_at ON studio.projects;
CREATE TRIGGER trg_projects_updated_at
BEFORE UPDATE ON studio.projects
FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();

CREATE TRIGGER trg_series_updated_at
BEFORE UPDATE ON studio.series
FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();

CREATE TRIGGER trg_series_assets_updated_at
BEFORE UPDATE ON studio.series_assets
FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();

CREATE TRIGGER trg_series_asset_variants_updated_at
BEFORE UPDATE ON studio.series_asset_variants
FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();

CREATE TRIGGER trg_episodes_updated_at
BEFORE UPDATE ON studio.episodes
FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();

CREATE TRIGGER trg_scenes_updated_at
BEFORE UPDATE ON studio.scenes
FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX idx_series_project_id ON studio.series(project_id);
CREATE INDEX idx_series_user_id ON studio.series(user_id);

CREATE INDEX idx_series_assets_series_id ON studio.series_assets(series_id);
CREATE INDEX idx_series_assets_series_type ON studio.series_assets(series_id, type);

CREATE INDEX idx_series_asset_variants_asset_id ON studio.series_asset_variants(asset_id);
CREATE INDEX idx_series_asset_variants_slug ON studio.series_asset_variants(slug);
CREATE UNIQUE INDEX uq_series_asset_variants_default_per_asset
  ON studio.series_asset_variants(asset_id)
  WHERE is_default;

CREATE INDEX idx_episodes_series_id ON studio.episodes(series_id);
CREATE INDEX idx_episodes_status ON studio.episodes(status);
CREATE INDEX idx_episodes_asset_variant_map_gin ON studio.episodes USING GIN (asset_variant_map);

CREATE INDEX idx_scenes_episode_id ON studio.scenes(episode_id);
CREATE INDEX idx_scenes_status ON studio.scenes(status);
CREATE INDEX idx_scenes_location_variant_slug ON studio.scenes(location_variant_slug);
CREATE INDEX idx_scenes_character_variant_slugs_gin ON studio.scenes USING GIN (character_variant_slugs);
CREATE INDEX idx_scenes_prop_variant_slugs_gin ON studio.scenes USING GIN (prop_variant_slugs);

-- -----------------------------------------------------------------------------
-- RLS reset + final policies
-- -----------------------------------------------------------------------------
ALTER TABLE studio.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.series ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.series_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.series_asset_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.scenes ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
  pol RECORD;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'projects',
    'series',
    'series_assets',
    'series_asset_variants',
    'episodes',
    'scenes'
  ]
  LOOP
    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'studio' AND tablename = tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON studio.%I', pol.policyname, tbl);
    END LOOP;
  END LOOP;
END $$;

-- projects
CREATE POLICY projects_select_own ON studio.projects
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY projects_insert_own ON studio.projects
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY projects_update_own ON studio.projects
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY projects_delete_own ON studio.projects
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY projects_service_all ON studio.projects
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- series
CREATE POLICY series_select_own ON studio.series
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY series_insert_own ON studio.series
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY series_update_own ON studio.series
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY series_delete_own ON studio.series
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY series_service_all ON studio.series
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- series_assets
CREATE POLICY series_assets_select_own ON studio.series_assets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM studio.series s
      WHERE s.id = series_assets.series_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY series_assets_insert_own ON studio.series_assets
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM studio.series s
      WHERE s.id = series_assets.series_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY series_assets_update_own ON studio.series_assets
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM studio.series s
      WHERE s.id = series_assets.series_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM studio.series s
      WHERE s.id = series_assets.series_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY series_assets_delete_own ON studio.series_assets
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM studio.series s
      WHERE s.id = series_assets.series_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY series_assets_service_all ON studio.series_assets
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- series_asset_variants
CREATE POLICY series_asset_variants_select_own ON studio.series_asset_variants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM studio.series_assets sa
      JOIN studio.series s ON s.id = sa.series_id
      WHERE sa.id = series_asset_variants.asset_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY series_asset_variants_insert_own ON studio.series_asset_variants
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM studio.series_assets sa
      JOIN studio.series s ON s.id = sa.series_id
      WHERE sa.id = series_asset_variants.asset_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY series_asset_variants_update_own ON studio.series_asset_variants
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM studio.series_assets sa
      JOIN studio.series s ON s.id = sa.series_id
      WHERE sa.id = series_asset_variants.asset_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM studio.series_assets sa
      JOIN studio.series s ON s.id = sa.series_id
      WHERE sa.id = series_asset_variants.asset_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY series_asset_variants_delete_own ON studio.series_asset_variants
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM studio.series_assets sa
      JOIN studio.series s ON s.id = sa.series_id
      WHERE sa.id = series_asset_variants.asset_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY series_asset_variants_service_all ON studio.series_asset_variants
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- episodes
CREATE POLICY episodes_select_own ON studio.episodes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM studio.series s
      WHERE s.id = episodes.series_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY episodes_insert_own ON studio.episodes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM studio.series s
      WHERE s.id = episodes.series_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY episodes_update_own ON studio.episodes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM studio.series s
      WHERE s.id = episodes.series_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM studio.series s
      WHERE s.id = episodes.series_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY episodes_delete_own ON studio.episodes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM studio.series s
      WHERE s.id = episodes.series_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY episodes_service_all ON studio.episodes
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- scenes
CREATE POLICY scenes_select_own ON studio.scenes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM studio.episodes e
      JOIN studio.series s ON s.id = e.series_id
      WHERE e.id = scenes.episode_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY scenes_insert_own ON studio.scenes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM studio.episodes e
      JOIN studio.series s ON s.id = e.series_id
      WHERE e.id = scenes.episode_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY scenes_update_own ON studio.scenes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM studio.episodes e
      JOIN studio.series s ON s.id = e.series_id
      WHERE e.id = scenes.episode_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM studio.episodes e
      JOIN studio.series s ON s.id = e.series_id
      WHERE e.id = scenes.episode_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY scenes_delete_own ON studio.scenes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM studio.episodes e
      JOIN studio.series s ON s.id = e.series_id
      WHERE e.id = scenes.episode_id
        AND s.user_id = auth.uid()
    )
  );

CREATE POLICY scenes_service_all ON studio.scenes
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
