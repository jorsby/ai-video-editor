-- Add has_speech boolean to scenes (NULL = unknown, true = speech, false = no speech)
ALTER TABLE studio.scenes ADD COLUMN IF NOT EXISTS has_speech boolean DEFAULT NULL;
