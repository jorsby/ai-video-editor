-- Convert multi_shots from boolean to jsonb to store per-shot duration metadata
-- e.g. [{"duration": "7"}, {"duration": "4"}]
ALTER TABLE studio.scenes
  ALTER COLUMN multi_shots DROP DEFAULT,
  ALTER COLUMN multi_shots TYPE jsonb USING NULL,
  ALTER COLUMN multi_shots SET DEFAULT NULL;

COMMENT ON COLUMN studio.scenes.multi_shots IS 'Per-shot metadata for multi_prompt scenes. Array of {duration: string}. Falls back to even split if null.';
