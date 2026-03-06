import { createClient } from '@/lib/supabase/client';

/**
 * Save (upsert) a transcription result to Supabase.
 * Uses the unique constraint on (project_id, source_url, model) for upsert.
 */
export async function saveTranscription(
  projectId: string,
  sourceUrl: string,
  data: Record<string, unknown>,
  model: string = 'nova-3'
) {
  const supabase = createClient('studio');

  const { error } = await supabase.from('transcriptions').upsert(
    {
      project_id: projectId,
      source_url: sourceUrl,
      model,
      data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,source_url,model' }
  );

  if (error) throw error;
}

/**
 * Load a cached transcription from Supabase.
 * Returns the transcription data or null if not found.
 */
export async function loadTranscription(
  projectId: string,
  sourceUrl: string,
  model: string = 'nova-3'
): Promise<Record<string, unknown> | null> {
  const supabase = createClient('studio');

  const { data, error } = await supabase
    .from('transcriptions')
    .select('data')
    .eq('project_id', projectId)
    .eq('source_url', sourceUrl)
    .eq('model', model)
    .maybeSingle();

  if (error) {
    console.error('Failed to load transcription:', error);
    return null;
  }

  return data?.data ?? null;
}

/**
 * Delete a specific transcription by ID.
 */
export async function deleteTranscription(transcriptionId: string) {
  const supabase = createClient('studio');

  const { error } = await supabase
    .from('transcriptions')
    .delete()
    .eq('id', transcriptionId);

  if (error) throw error;
}
