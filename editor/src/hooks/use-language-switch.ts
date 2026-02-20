import { useCallback } from 'react';
import { toast } from 'sonner';
import { useStudioStore } from '@/stores/studio-store';
import { useLanguageStore } from '@/stores/language-store';
import { useProjectId } from '@/contexts/project-context';
import { waitForSave } from '@/hooks/use-auto-save';
import {
  saveTimeline,
  loadTimeline,
  reconstructProjectJSON,
  getAvailableLanguages,
  copyTimeline,
} from '@/lib/supabase/timeline-service';
import type { LanguageCode } from '@/lib/constants/languages';

export function useLanguageSwitch() {
  const projectId = useProjectId();

  const switchLanguage = useCallback(
    async (targetLanguage: LanguageCode) => {
      const { activeLanguage, setActiveLanguage, setIsLanguageSwitching, setAvailableLanguages } =
        useLanguageStore.getState();
      const { studio } = useStudioStore.getState();

      if (targetLanguage === activeLanguage) return;
      if (!studio) return;

      setIsLanguageSwitching(true);

      try {
        // Wait for any in-flight auto-save to complete
        await waitForSave();

        // Save current language's timeline
        try {
          await saveTimeline(
            projectId,
            studio.tracks,
            studio.clips,
            activeLanguage
          );
        } catch (error) {
          // Save failed — abort switch
          toast.error('Failed to save current timeline. Language switch aborted.');
          setIsLanguageSwitching(false);
          return;
        }

        // Load target language's timeline
        const savedData = await loadTimeline(projectId, targetLanguage);

        if (savedData && savedData.length > 0) {
          const projectJson = reconstructProjectJSON(savedData);
          await studio.loadFromJSON(projectJson as any);
        } else {
          // Empty timeline for new language
          studio.clear();
        }

        // Update active language
        setActiveLanguage(targetLanguage);

        // Refresh available languages
        const langs = await getAvailableLanguages(projectId);
        setAvailableLanguages(langs);
      } catch (error) {
        console.error('Language switch error:', error);
        toast.error('Failed to switch language.');
      } finally {
        setIsLanguageSwitching(false);
      }
    },
    [projectId]
  );

  const copyAndSwitch = useCallback(
    async (targetLanguage: LanguageCode) => {
      const { activeLanguage, setIsLanguageSwitching } =
        useLanguageStore.getState();
      const { studio } = useStudioStore.getState();

      if (!studio) return;

      setIsLanguageSwitching(true);

      try {
        // Wait for any in-flight auto-save
        await waitForSave();

        // Save current language first
        await saveTimeline(
          projectId,
          studio.tracks,
          studio.clips,
          activeLanguage
        );

        // Copy current language to target
        await copyTimeline(projectId, activeLanguage, targetLanguage);

        // Now switch to the target language
        await switchLanguage(targetLanguage);
      } catch (error) {
        console.error('Copy and switch error:', error);
        toast.error('Failed to copy timeline.');
        setIsLanguageSwitching(false);
      }
    },
    [projectId, switchLanguage]
  );

  return { switchLanguage, copyAndSwitch };
}
