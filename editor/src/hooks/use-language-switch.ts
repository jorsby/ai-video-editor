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
  removeLanguageData,
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

        if (savedData === null) {
          // loadTimeline only returns null on actual DB/network error
          toast.error('Failed to load timeline. Please try again.');
          setIsLanguageSwitching(false);
          return;
        }

        if (savedData.length > 0) {
          const projectJson = reconstructProjectJSON(savedData);
          await studio.loadFromJSON(projectJson as any);
        } else {
          // Genuinely empty — first time this language is used
          studio.clear();
        }

        // Update active language
        setActiveLanguage(targetLanguage);

        // Refresh available languages — merge DB results with current store
        // to prevent losing languages that have no DB footprint (e.g. "Start empty")
        const dbLangs = await getAvailableLanguages(projectId);
        const { availableLanguages: currentLangs } = useLanguageStore.getState();
        const merged = [...new Set([...currentLangs, ...dbLangs, targetLanguage])];
        setAvailableLanguages(merged);
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

  const copyToMultiple = useCallback(
    async (targetLanguages: LanguageCode[]) => {
      const { activeLanguage, setAvailableLanguages } =
        useLanguageStore.getState();
      const { studio } = useStudioStore.getState();

      if (!studio || targetLanguages.length === 0) return;

      // Wait for any in-flight auto-save
      await waitForSave();

      // Save current language first
      await saveTimeline(projectId, studio.tracks, studio.clips, activeLanguage);

      // Copy to each target sequentially to avoid DB connection pool issues
      for (const lang of targetLanguages) {
        await copyTimeline(projectId, activeLanguage, lang);
      }

      // Refresh available languages, ensuring all targets are included
      const langs = await getAvailableLanguages(projectId);
      for (const lang of targetLanguages) {
        if (!langs.includes(lang)) langs.push(lang);
      }
      setAvailableLanguages(langs);
    },
    [projectId]
  );

  const addEmptyLanguages = useCallback(
    async (targetLanguages: LanguageCode[]) => {
      const { setAvailableLanguages } = useLanguageStore.getState();

      const langs = await getAvailableLanguages(projectId);
      for (const lang of targetLanguages) {
        if (!langs.includes(lang)) langs.push(lang);
      }
      setAvailableLanguages(langs);
    },
    [projectId]
  );

  const removeLanguage = useCallback(
    async (language: LanguageCode) => {
      const { activeLanguage, availableLanguages, setAvailableLanguages, setIsLanguageSwitching } =
        useLanguageStore.getState();
      const { studio } = useStudioStore.getState();

      if (availableLanguages.length <= 1) {
        toast.error('Cannot remove the only language.');
        return;
      }

      setIsLanguageSwitching(true);

      try {
        await waitForSave();

        // If removing the active language, switch to another one first
        if (language === activeLanguage && studio) {
          const remaining = availableLanguages.filter((l) => l !== language);
          await switchLanguage(remaining[0]);
        }

        // Delete all data for this language
        await removeLanguageData(projectId, language);

        // Update available languages
        const { availableLanguages: currentLangs } = useLanguageStore.getState();
        setAvailableLanguages(currentLangs.filter((l) => l !== language));

        toast.success(`Removed ${language.toUpperCase()} language.`);
      } catch (error) {
        console.error('Remove language error:', error);
        toast.error('Failed to remove language.');
      } finally {
        setIsLanguageSwitching(false);
      }
    },
    [projectId, switchLanguage]
  );

  return { switchLanguage, copyAndSwitch, copyToMultiple, addEmptyLanguages, removeLanguage };
}
