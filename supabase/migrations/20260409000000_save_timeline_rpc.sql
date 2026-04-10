-- Atomic save_timeline RPC: wraps delete-then-insert in a single transaction.
-- If any step fails, the entire operation rolls back — no partial data loss.
CREATE OR REPLACE FUNCTION studio.save_timeline(
  p_project_id UUID,
  p_video_id UUID DEFAULT NULL,
  p_tracks JSONB DEFAULT '[]'::JSONB,
  p_clips JSONB DEFAULT '[]'::JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = studio
AS $$
DECLARE
  v_existing_track_ids TEXT[];
BEGIN
  -- 1. Collect existing track IDs
  IF p_video_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(id), '{}')
    INTO v_existing_track_ids
    FROM studio.tracks
    WHERE project_id = p_project_id AND video_id = p_video_id;
  ELSE
    SELECT COALESCE(array_agg(id), '{}')
    INTO v_existing_track_ids
    FROM studio.tracks
    WHERE project_id = p_project_id;
  END IF;

  -- 2. Delete existing clips + tracks
  IF array_length(v_existing_track_ids, 1) > 0 THEN
    DELETE FROM studio.clips WHERE track_id = ANY(v_existing_track_ids);
    DELETE FROM studio.tracks WHERE id = ANY(v_existing_track_ids);
  END IF;

  -- 3. Insert new tracks (skip if empty array)
  IF jsonb_array_length(p_tracks) > 0 THEN
    INSERT INTO studio.tracks (id, project_id, video_id, position, data)
    SELECT
      t->>'id',
      p_project_id,
      p_video_id,
      (t->>'position')::INT,
      (t->'data')::JSONB
    FROM jsonb_array_elements(p_tracks) AS t;
  END IF;

  -- 4. Insert new clips (skip if empty array)
  IF jsonb_array_length(p_clips) > 0 THEN
    INSERT INTO studio.clips (id, track_id, position, data)
    SELECT
      c->>'id',
      c->>'track_id',
      (c->>'position')::INT,
      (c->'data')::JSONB
    FROM jsonb_array_elements(p_clips) AS c;
  END IF;
END;
$$;
