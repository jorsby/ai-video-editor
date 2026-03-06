import { createClient } from '@/lib/supabase/client';
import { IndexedDBAdapter } from '@/lib/storage/indexeddb-adapter';
import type { SavedTextPreset } from '@/types/text-presets';
import type { SavedTextPresetsData } from '@/types/text-presets';

export async function migrateIndexedDBPresetsToSupabase(): Promise<void> {
  try {
    if (localStorage.getItem('text_presets_migrated') === '1') return;

    const adapter = new IndexedDBAdapter<SavedTextPresetsData>(
      'video-editor-saved-text-presets',
      'saved-text-presets'
    );

    const data = await adapter.get('user-text-presets');
    if (data && data.presets.length > 0) {
      const supabase = createClient('studio');
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('text_presets').upsert(
        data.presets.map((preset) => ({
          id: preset.id,
          user_id: user.id,
          name: preset.name,
          style: preset.style,
          clip_properties: preset.clipProperties,
        }))
      );
      await adapter.remove('user-text-presets');
    }

    localStorage.setItem('text_presets_migrated', '1');
  } catch {
    // silently ignore — migration failure must not break the app
  }
}

export async function loadTextPresets(): Promise<SavedTextPreset[]> {
  const supabase = createClient('studio');

  const { data, error } = await supabase
    .from('text_presets')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    style: row.style,
    clipProperties: row.clip_properties,
    createdAt: row.created_at,
  }));
}

export async function saveTextPreset(preset: SavedTextPreset): Promise<void> {
  const supabase = createClient('studio');

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase.from('text_presets').insert({
    id: preset.id,
    user_id: user.id,
    name: preset.name,
    style: preset.style,
    clip_properties: preset.clipProperties,
  });

  if (error) throw error;
}

export async function removeTextPreset(presetId: string): Promise<void> {
  const supabase = createClient('studio');

  const { error } = await supabase
    .from('text_presets')
    .delete()
    .eq('id', presetId);

  if (error) throw error;
}
