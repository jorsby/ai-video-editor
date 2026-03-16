-- Character Hub: tables, enums, indexes, triggers, RLS, storage policies
-- Migration: 20260313183700_create_character_hub
-- Author: Ops (jorsby-ops) + Video Editor Dev
-- Status: REVIEW BEFORE APPLYING TO PROD

BEGIN;

-- -----------------------------------------------------------------------------
-- Prereqs
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS studio;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'studio' AND t.typname = 'character_image_angle'
  ) THEN
    CREATE TYPE studio.character_image_angle AS ENUM (
      'front',
      'left_profile',
      'right_profile',
      'three_quarter_left',
      'three_quarter_right',
      'back'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'studio' AND t.typname = 'character_image_kind'
  ) THEN
    CREATE TYPE studio.character_image_kind AS ENUM (
      'frontal',
      'reference',
      'video_reference'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'studio' AND t.typname = 'character_image_source'
  ) THEN
    CREATE TYPE studio.character_image_source AS ENUM (
      'upload',
      'generated',
      'imported'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'studio' AND t.typname = 'project_character_role'
  ) THEN
    CREATE TYPE studio.project_character_role AS ENUM (
      'main',
      'supporting',
      'extra'
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Shared trigger function: updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION studio.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS studio.characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studio.character_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID NOT NULL REFERENCES studio.characters(id) ON DELETE CASCADE,
  angle studio.character_image_angle NOT NULL,
  kind studio.character_image_kind NOT NULL DEFAULT 'reference',
  url TEXT,
  storage_path TEXT NOT NULL, -- expected: {user_id}/{character_id}/{filename}
  source studio.character_image_source NOT NULL DEFAULT 'upload',
  width INT CHECK (width IS NULL OR width > 0),
  height INT CHECK (height IS NULL OR height > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (kind <> 'frontal' OR angle = 'front')
);

CREATE TABLE IF NOT EXISTS studio.project_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES studio.projects(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES studio.characters(id) ON DELETE CASCADE,
  element_index INT NOT NULL CHECK (element_index >= 1),
  role studio.project_character_role NOT NULL DEFAULT 'main',
  description_snapshot TEXT,
  resolved_image_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_characters_unique_project_element UNIQUE (project_id, element_index),
  CONSTRAINT project_characters_unique_project_character UNIQUE (project_id, character_id)
);

-- Add nullable FK on existing objects table (for backfill/linking)
ALTER TABLE studio.objects
  ADD COLUMN IF NOT EXISTS character_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'objects_character_id_fkey'
      AND conrelid = 'studio.objects'::regclass
  ) THEN
    ALTER TABLE studio.objects
      ADD CONSTRAINT objects_character_id_fkey
      FOREIGN KEY (character_id)
      REFERENCES studio.characters(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Ownership guard trigger (defense in depth)
-- Ensures project.user_id == character.user_id
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION studio.ensure_project_character_same_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_project_user UUID;
  v_character_user UUID;
BEGIN
  SELECT p.user_id INTO v_project_user
  FROM studio.projects p
  WHERE p.id = NEW.project_id;

  IF v_project_user IS NULL THEN
    RAISE EXCEPTION 'Project % not found', NEW.project_id;
  END IF;

  SELECT c.user_id INTO v_character_user
  FROM studio.characters c
  WHERE c.id = NEW.character_id;

  IF v_character_user IS NULL THEN
    RAISE EXCEPTION 'Character % not found', NEW.character_id;
  END IF;

  IF v_project_user <> v_character_user THEN
    RAISE EXCEPTION 'Project and character must belong to the same user';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_project_characters_same_owner'
      AND tgrelid = 'studio.project_characters'::regclass
  ) THEN
    CREATE TRIGGER trg_project_characters_same_owner
    BEFORE INSERT OR UPDATE ON studio.project_characters
    FOR EACH ROW
    EXECUTE FUNCTION studio.ensure_project_character_same_owner();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_characters_updated_at'
      AND tgrelid = 'studio.characters'::regclass
  ) THEN
    CREATE TRIGGER trg_characters_updated_at
    BEFORE UPDATE ON studio.characters
    FOR EACH ROW
    EXECUTE FUNCTION studio.set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_character_images_updated_at'
      AND tgrelid = 'studio.character_images'::regclass
  ) THEN
    CREATE TRIGGER trg_character_images_updated_at
    BEFORE UPDATE ON studio.character_images
    FOR EACH ROW
    EXECUTE FUNCTION studio.set_updated_at();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_project_characters_updated_at'
      AND tgrelid = 'studio.project_characters'::regclass
  ) THEN
    CREATE TRIGGER trg_project_characters_updated_at
    BEFORE UPDATE ON studio.project_characters
    FOR EACH ROW
    EXECUTE FUNCTION studio.set_updated_at();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_characters_user_id
  ON studio.characters(user_id);

CREATE INDEX IF NOT EXISTS idx_character_images_character_id
  ON studio.character_images(character_id);

CREATE INDEX IF NOT EXISTS idx_character_images_character_kind
  ON studio.character_images(character_id, kind);

CREATE INDEX IF NOT EXISTS idx_project_characters_project_id
  ON studio.project_characters(project_id);

CREATE INDEX IF NOT EXISTS idx_project_characters_character_id
  ON studio.project_characters(character_id);

CREATE INDEX IF NOT EXISTS idx_objects_character_id
  ON studio.objects(character_id);

-- One frontal and one video_reference max per character (references can be many)
CREATE UNIQUE INDEX IF NOT EXISTS uq_character_images_one_frontal_per_character
  ON studio.character_images(character_id)
  WHERE kind = 'frontal';

CREATE UNIQUE INDEX IF NOT EXISTS uq_character_images_one_video_reference_per_character
  ON studio.character_images(character_id)
  WHERE kind = 'video_reference';

-- -----------------------------------------------------------------------------
-- RLS: studio tables
-- -----------------------------------------------------------------------------
ALTER TABLE studio.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.character_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio.project_characters ENABLE ROW LEVEL SECURITY;

-- characters policies
DROP POLICY IF EXISTS characters_select_own ON studio.characters;
CREATE POLICY characters_select_own
ON studio.characters
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS characters_insert_own ON studio.characters;
CREATE POLICY characters_insert_own
ON studio.characters
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS characters_update_own ON studio.characters;
CREATE POLICY characters_update_own
ON studio.characters
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS characters_delete_own ON studio.characters;
CREATE POLICY characters_delete_own
ON studio.characters
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- character_images policies (inherit ownership through character)
DROP POLICY IF EXISTS character_images_select_own ON studio.character_images;
CREATE POLICY character_images_select_own
ON studio.character_images
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM studio.characters c
    WHERE c.id = studio.character_images.character_id
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS character_images_insert_own ON studio.character_images;
CREATE POLICY character_images_insert_own
ON studio.character_images
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM studio.characters c
    WHERE c.id = studio.character_images.character_id
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS character_images_update_own ON studio.character_images;
CREATE POLICY character_images_update_own
ON studio.character_images
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM studio.characters c
    WHERE c.id = studio.character_images.character_id
      AND c.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM studio.characters c
    WHERE c.id = studio.character_images.character_id
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS character_images_delete_own ON studio.character_images;
CREATE POLICY character_images_delete_own
ON studio.character_images
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM studio.characters c
    WHERE c.id = studio.character_images.character_id
      AND c.user_id = auth.uid()
  )
);

-- project_characters policies (must own both project + character)
DROP POLICY IF EXISTS project_characters_select_own ON studio.project_characters;
CREATE POLICY project_characters_select_own
ON studio.project_characters
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM studio.projects p
    WHERE p.id = studio.project_characters.project_id
      AND p.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM studio.characters c
    WHERE c.id = studio.project_characters.character_id
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS project_characters_insert_own ON studio.project_characters;
CREATE POLICY project_characters_insert_own
ON studio.project_characters
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM studio.projects p
    WHERE p.id = studio.project_characters.project_id
      AND p.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM studio.characters c
    WHERE c.id = studio.project_characters.character_id
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS project_characters_update_own ON studio.project_characters;
CREATE POLICY project_characters_update_own
ON studio.project_characters
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM studio.projects p
    WHERE p.id = studio.project_characters.project_id
      AND p.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM studio.characters c
    WHERE c.id = studio.project_characters.character_id
      AND c.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM studio.projects p
    WHERE p.id = studio.project_characters.project_id
      AND p.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM studio.characters c
    WHERE c.id = studio.project_characters.character_id
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS project_characters_delete_own ON studio.project_characters;
CREATE POLICY project_characters_delete_own
ON studio.project_characters
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM studio.projects p
    WHERE p.id = studio.project_characters.project_id
      AND p.user_id = auth.uid()
  )
  AND EXISTS (
    SELECT 1
    FROM studio.characters c
    WHERE c.id = studio.project_characters.character_id
      AND c.user_id = auth.uid()
  )
);

-- Service role bypass (for API routes using admin client)
DROP POLICY IF EXISTS characters_service_role ON studio.characters;
CREATE POLICY characters_service_role
ON studio.characters
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS character_images_service_role ON studio.character_images;
CREATE POLICY character_images_service_role
ON studio.character_images
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS project_characters_service_role ON studio.project_characters;
CREATE POLICY project_characters_service_role
ON studio.project_characters
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Storage: character-assets bucket
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'character-assets',
  'character-assets',
  false,
  10485760, -- 10MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'video/mp4']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS character_assets_select ON storage.objects;
CREATE POLICY character_assets_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'character-assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS character_assets_insert ON storage.objects;
CREATE POLICY character_assets_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'character-assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS character_assets_update ON storage.objects;
CREATE POLICY character_assets_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'character-assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'character-assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS character_assets_delete ON storage.objects;
CREATE POLICY character_assets_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'character-assets'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Service role bypass for storage
DROP POLICY IF EXISTS character_assets_service_role ON storage.objects;
CREATE POLICY character_assets_service_role
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'character-assets')
WITH CHECK (bucket_id = 'character-assets');

COMMIT;
