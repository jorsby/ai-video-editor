BEGIN;

-- -----------------------------------------------------------------------------
-- Series Production Engine — creates series, assets, variants, episodes
-- Reuses existing enums: character_image_angle, character_image_kind,
--                         character_image_source (from character hub migration)
-- -----------------------------------------------------------------------------

-- series_asset_type enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'studio' AND t.typname = 'series_asset_type'
  ) THEN
    CREATE TYPE studio.series_asset_type AS ENUM ('character', 'location', 'prop');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS studio.series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  genre TEXT,
  tone TEXT,
  bible TEXT,
  visual_style JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio.series_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES studio.series(id) ON DELETE CASCADE,
  type studio.series_asset_type NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  character_id UUID REFERENCES studio.characters(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio.series_asset_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES studio.series_assets(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio.series_asset_variant_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES studio.series_asset_variants(id) ON DELETE CASCADE,
  angle studio.character_image_angle NOT NULL DEFAULT 'front',
  kind studio.character_image_kind NOT NULL DEFAULT 'reference',
  url TEXT,
  storage_path TEXT NOT NULL,
  source studio.character_image_source NOT NULL DEFAULT 'upload',
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio.series_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES studio.series(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES studio.projects(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL CHECK (episode_number > 0),
  title TEXT,
  synopsis TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (series_id, episode_number),
  UNIQUE (series_id, project_id)
);

CREATE TABLE IF NOT EXISTS studio.episode_asset_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES studio.series_episodes(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES studio.series_assets(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES studio.series_asset_variants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (episode_id, asset_id)
);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_series_updated_at'
      AND tgrelid = 'studio.series'::regclass
  ) THEN
    CREATE TRIGGER trg_series_updated_at
    BEFORE UPDATE ON studio.series
    FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_series_assets_updated_at'
      AND tgrelid = 'studio.series_assets'::regclass
  ) THEN
    CREATE TRIGGER trg_series_assets_updated_at
    BEFORE UPDATE ON studio.series_assets
    FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_series_asset_variants_updated_at'
      AND tgrelid = 'studio.series_asset_variants'::regclass
  ) THEN
    CREATE TRIGGER trg_series_asset_variants_updated_at
    BEFORE UPDATE ON studio.series_asset_variants
    FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_series_asset_variant_images_updated_at'
      AND tgrelid = 'studio.series_asset_variant_images'::regclass
  ) THEN
    CREATE TRIGGER trg_series_asset_variant_images_updated_at
    BEFORE UPDATE ON studio.series_asset_variant_images
    FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_series_episodes_updated_at'
      AND tgrelid = 'studio.series_episodes'::regclass
  ) THEN
    CREATE TRIGGER trg_series_episodes_updated_at
    BEFORE UPDATE ON studio.series_episodes
    FOR EACH ROW EXECUTE FUNCTION studio.set_updated_at();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_series_user_id
  ON studio.series(user_id);

CREATE INDEX IF NOT EXISTS idx_series_assets_series_id
  ON studio.series_assets(series_id);

CREATE INDEX IF NOT EXISTS idx_series_assets_type
  ON studio.series_assets(series_id, type);

CREATE INDEX IF NOT EXISTS idx_series_asset_variants_asset_id
  ON studio.series_asset_variants(asset_id);

CREATE INDEX IF NOT EXISTS idx_series_asset_variant_images_variant_id
  ON studio.series_asset_variant_images(variant_id);

CREATE INDEX IF NOT EXISTS idx_series_episodes_series_id
  ON studio.series_episodes(series_id);

CREATE INDEX IF NOT EXISTS idx_series_episodes_project_id
  ON studio.series_episodes(project_id);

CREATE INDEX IF NOT EXISTS idx_episode_asset_variants_episode_id
  ON studio.episode_asset_variants(episode_id);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
ALTER TABLE studio.series ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.series_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.series_asset_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.series_asset_variant_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.series_episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.episode_asset_variants ENABLE ROW LEVEL SECURITY;

-- series: direct ownership
DROP POLICY IF EXISTS series_select_own ON studio.series;
CREATE POLICY series_select_own ON studio.series
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS series_insert_own ON studio.series;
CREATE POLICY series_insert_own ON studio.series
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS series_update_own ON studio.series;
CREATE POLICY series_update_own ON studio.series
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS series_delete_own ON studio.series;
CREATE POLICY series_delete_own ON studio.series
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS series_service_all ON studio.series;
CREATE POLICY series_service_all ON studio.series
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- series_assets: via series ownership
DROP POLICY IF EXISTS series_assets_select_own ON studio.series_assets;
CREATE POLICY series_assets_select_own ON studio.series_assets
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series s
    WHERE s.id = studio.series_assets.series_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_assets_insert_own ON studio.series_assets;
CREATE POLICY series_assets_insert_own ON studio.series_assets
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.series s
    WHERE s.id = studio.series_assets.series_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_assets_update_own ON studio.series_assets;
CREATE POLICY series_assets_update_own ON studio.series_assets
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series s
    WHERE s.id = studio.series_assets.series_id AND s.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.series s
    WHERE s.id = studio.series_assets.series_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_assets_delete_own ON studio.series_assets;
CREATE POLICY series_assets_delete_own ON studio.series_assets
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series s
    WHERE s.id = studio.series_assets.series_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_assets_service_all ON studio.series_assets;
CREATE POLICY series_assets_service_all ON studio.series_assets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- series_asset_variants: via asset → series ownership
DROP POLICY IF EXISTS series_asset_variants_select_own ON studio.series_asset_variants;
CREATE POLICY series_asset_variants_select_own ON studio.series_asset_variants
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series_assets sa
    JOIN studio.series s ON s.id = sa.series_id
    WHERE sa.id = studio.series_asset_variants.asset_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_asset_variants_insert_own ON studio.series_asset_variants;
CREATE POLICY series_asset_variants_insert_own ON studio.series_asset_variants
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.series_assets sa
    JOIN studio.series s ON s.id = sa.series_id
    WHERE sa.id = studio.series_asset_variants.asset_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_asset_variants_update_own ON studio.series_asset_variants;
CREATE POLICY series_asset_variants_update_own ON studio.series_asset_variants
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series_assets sa
    JOIN studio.series s ON s.id = sa.series_id
    WHERE sa.id = studio.series_asset_variants.asset_id AND s.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.series_assets sa
    JOIN studio.series s ON s.id = sa.series_id
    WHERE sa.id = studio.series_asset_variants.asset_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_asset_variants_delete_own ON studio.series_asset_variants;
CREATE POLICY series_asset_variants_delete_own ON studio.series_asset_variants
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series_assets sa
    JOIN studio.series s ON s.id = sa.series_id
    WHERE sa.id = studio.series_asset_variants.asset_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_asset_variants_service_all ON studio.series_asset_variants;
CREATE POLICY series_asset_variants_service_all ON studio.series_asset_variants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- series_asset_variant_images: via variant → asset → series
DROP POLICY IF EXISTS series_asset_variant_images_select_own ON studio.series_asset_variant_images;
CREATE POLICY series_asset_variant_images_select_own ON studio.series_asset_variant_images
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series_asset_variants sav
    JOIN studio.series_assets sa ON sa.id = sav.asset_id
    JOIN studio.series s ON s.id = sa.series_id
    WHERE sav.id = studio.series_asset_variant_images.variant_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_asset_variant_images_insert_own ON studio.series_asset_variant_images;
CREATE POLICY series_asset_variant_images_insert_own ON studio.series_asset_variant_images
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.series_asset_variants sav
    JOIN studio.series_assets sa ON sa.id = sav.asset_id
    JOIN studio.series s ON s.id = sa.series_id
    WHERE sav.id = studio.series_asset_variant_images.variant_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_asset_variant_images_delete_own ON studio.series_asset_variant_images;
CREATE POLICY series_asset_variant_images_delete_own ON studio.series_asset_variant_images
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series_asset_variants sav
    JOIN studio.series_assets sa ON sa.id = sav.asset_id
    JOIN studio.series s ON s.id = sa.series_id
    WHERE sav.id = studio.series_asset_variant_images.variant_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_asset_variant_images_service_all ON studio.series_asset_variant_images;
CREATE POLICY series_asset_variant_images_service_all ON studio.series_asset_variant_images
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- series_episodes: via series ownership
DROP POLICY IF EXISTS series_episodes_select_own ON studio.series_episodes;
CREATE POLICY series_episodes_select_own ON studio.series_episodes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series s
    WHERE s.id = studio.series_episodes.series_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_episodes_insert_own ON studio.series_episodes;
CREATE POLICY series_episodes_insert_own ON studio.series_episodes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.series s
    WHERE s.id = studio.series_episodes.series_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_episodes_update_own ON studio.series_episodes;
CREATE POLICY series_episodes_update_own ON studio.series_episodes
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series s
    WHERE s.id = studio.series_episodes.series_id AND s.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.series s
    WHERE s.id = studio.series_episodes.series_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_episodes_delete_own ON studio.series_episodes;
CREATE POLICY series_episodes_delete_own ON studio.series_episodes
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series s
    WHERE s.id = studio.series_episodes.series_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS series_episodes_service_all ON studio.series_episodes;
CREATE POLICY series_episodes_service_all ON studio.series_episodes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- episode_asset_variants: via episode → series ownership
DROP POLICY IF EXISTS episode_asset_variants_select_own ON studio.episode_asset_variants;
CREATE POLICY episode_asset_variants_select_own ON studio.episode_asset_variants
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series_episodes se
    JOIN studio.series s ON s.id = se.series_id
    WHERE se.id = studio.episode_asset_variants.episode_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS episode_asset_variants_insert_own ON studio.episode_asset_variants;
CREATE POLICY episode_asset_variants_insert_own ON studio.episode_asset_variants
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM studio.series_episodes se
    JOIN studio.series s ON s.id = se.series_id
    WHERE se.id = studio.episode_asset_variants.episode_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS episode_asset_variants_delete_own ON studio.episode_asset_variants;
CREATE POLICY episode_asset_variants_delete_own ON studio.episode_asset_variants
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM studio.series_episodes se
    JOIN studio.series s ON s.id = se.series_id
    WHERE se.id = studio.episode_asset_variants.episode_id AND s.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS episode_asset_variants_service_all ON studio.episode_asset_variants;
CREATE POLICY episode_asset_variants_service_all ON studio.episode_asset_variants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Storage bucket for series variant images
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('series-assets', 'series-assets', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS series_assets_storage_select ON storage.objects;
CREATE POLICY series_assets_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'series-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS series_assets_storage_insert ON storage.objects;
CREATE POLICY series_assets_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'series-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS series_assets_storage_update ON storage.objects;
CREATE POLICY series_assets_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'series-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'series-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS series_assets_storage_delete ON storage.objects;
CREATE POLICY series_assets_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'series-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS series_assets_storage_service_all ON storage.objects;
CREATE POLICY series_assets_storage_service_all ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'series-assets')
  WITH CHECK (bucket_id = 'series-assets');

COMMIT;
