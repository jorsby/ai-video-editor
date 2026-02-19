import { useState, useEffect, useCallback } from 'react';
import { storageService } from '@/lib/storage/storage-service';
import type { SavedTextPreset } from '@/types/text-presets';

export function useTextPresets() {
  const [savedPresets, setSavedPresets] = useState<SavedTextPreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    storageService.loadSavedTextPresets().then((data) => {
      setSavedPresets(data.presets);
      setIsLoading(false);
    });
  }, []);

  const savePreset = useCallback(async (preset: SavedTextPreset) => {
    setSavedPresets((prev) => [...prev, preset]);
    await storageService.saveTextPreset({ preset });
  }, []);

  const removePreset = useCallback(async (presetId: string) => {
    setSavedPresets((prev) => prev.filter((p) => p.id !== presetId));
    await storageService.removeTextPreset({ presetId });
  }, []);

  return { savedPresets, isLoading, savePreset, removePreset };
}
