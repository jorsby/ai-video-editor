import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  loadTextPresets,
  saveTextPreset as saveTextPresetToSupabase,
  removeTextPreset as removeTextPresetFromSupabase,
  migrateIndexedDBPresetsToSupabase,
} from '@/lib/supabase/text-presets-service';
import type { SavedTextPreset } from '@/types/text-presets';

export function useTextPresets() {
  const [savedPresets, setSavedPresets] = useState<SavedTextPreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    migrateIndexedDBPresetsToSupabase().then(() =>
      loadTextPresets().then((presets) => {
        setSavedPresets(presets);
        setIsLoading(false);
      })
    );

    const supabase = createClient();
    const channel = supabase
      .channel('text_presets_changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'text_presets' },
        (payload) => {
          const row = payload.new;
          const preset: SavedTextPreset = {
            id: row.id,
            name: row.name,
            style: row.style,
            clipProperties: row.clip_properties,
            createdAt: row.created_at,
          };
          setSavedPresets((prev) => {
            if (prev.some((p) => p.id === preset.id)) return prev;
            return [...prev, preset];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'text_presets' },
        (payload) => {
          setSavedPresets((prev) => prev.filter((p) => p.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const savePreset = useCallback(async (preset: SavedTextPreset) => {
    setSavedPresets((prev) => [...prev, preset]);
    await saveTextPresetToSupabase(preset);
  }, []);

  const removePreset = useCallback(async (presetId: string) => {
    setSavedPresets((prev) => prev.filter((p) => p.id !== presetId));
    await removeTextPresetFromSupabase(presetId);
  }, []);

  return { savedPresets, isLoading, savePreset, removePreset };
}
