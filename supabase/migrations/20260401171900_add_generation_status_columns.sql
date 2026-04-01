-- Phase 1: Add generation status tracking columns
-- scenes: TTS + Video generation tracking
-- series_asset_variants: Image generation tracking

-- ── scenes ─────────────────────────────────────────────────────────────────────
ALTER TABLE studio.scenes
  ADD COLUMN IF NOT EXISTS tts_task_id    text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tts_status     text DEFAULT 'idle' NOT NULL,
  ADD COLUMN IF NOT EXISTS video_task_id  text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS video_status   text DEFAULT 'idle' NOT NULL;

COMMENT ON COLUMN studio.scenes.tts_task_id   IS 'Active kie.ai task ID for TTS generation';
COMMENT ON COLUMN studio.scenes.tts_status    IS 'idle | generating | done | failed';
COMMENT ON COLUMN studio.scenes.video_task_id IS 'Active kie.ai task ID for video generation';
COMMENT ON COLUMN studio.scenes.video_status  IS 'idle | generating | done | failed';

-- ── series_asset_variants ──────────────────────────────────────────────────────
ALTER TABLE studio.series_asset_variants
  ADD COLUMN IF NOT EXISTS image_task_id     text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS image_gen_status  text DEFAULT 'idle' NOT NULL;

COMMENT ON COLUMN studio.series_asset_variants.image_task_id    IS 'Active kie.ai task ID for image generation';
COMMENT ON COLUMN studio.series_asset_variants.image_gen_status IS 'idle | generating | done | failed';
