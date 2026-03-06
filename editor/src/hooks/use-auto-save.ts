import { useEffect, useRef, useState, useCallback } from 'react';
import { useStudioStore } from '@/stores/studio-store';
import { useProjectId } from '@/contexts/project-context';
import { useLanguageStore } from '@/stores/language-store';
import { saveTimeline } from '@/lib/supabase/timeline-service';

const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// Shared ref so the language-switch hook can await any in-flight save
let saveInFlightPromise: Promise<void> | null = null;

export function waitForSave(): Promise<void> {
  return saveInFlightPromise ?? Promise.resolve();
}

export function useAutoSave() {
  const { studio } = useStudioStore();
  const projectId = useProjectId();
  const isSavingRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const performSave = useCallback(async () => {
    const state = useStudioStore.getState();
    if (state.isExporting) return;
    if (isSavingRef.current || !state.studio) return;

    // Skip save if a language switch is in progress
    const { isLanguageSwitching } = useLanguageStore.getState();
    if (isLanguageSwitching) return;

    isSavingRef.current = true;
    setSaveStatus('saving');
    clearTimeout(savedTimerRef.current);

    const { activeLanguage } = useLanguageStore.getState();

    const promise = (async () => {
      try {
        await saveTimeline(
          projectId,
          state.studio!.tracks,
          state.studio!.clips,
          activeLanguage
        );
        setSaveStatus('saved');
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (error) {
        console.error(
          'Save failed:',
          error instanceof Error ? error.message : JSON.stringify(error)
        );
        setSaveStatus('error');
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
      } finally {
        isSavingRef.current = false;
        saveInFlightPromise = null;
      }
    })();

    saveInFlightPromise = promise;
    await promise;
  }, [projectId]);

  // Auto-save interval
  useEffect(() => {
    if (!studio) return;

    const intervalId = setInterval(performSave, AUTO_SAVE_INTERVAL);

    return () => {
      clearInterval(intervalId);
      clearTimeout(savedTimerRef.current);
      // Sync save on unmount (best effort)
      if (studio && studio.clips.length > 0) {
        const { activeLanguage } = useLanguageStore.getState();
        saveTimeline(
          projectId,
          studio.tracks,
          studio.clips,
          activeLanguage
        ).catch(console.error);
      }
    };
  }, [studio, projectId, performSave]);

  // Cmd+S / Ctrl+S shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        performSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [performSave]);

  return { saveNow: performSave, saveStatus };
}
