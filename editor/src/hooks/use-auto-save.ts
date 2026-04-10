import { useEffect, useRef, useState, useCallback } from 'react';
import { useStudioStore } from '@/stores/studio-store';
import { useProjectId } from '@/contexts/project-context';
import { useVideoSelectorStore } from '@/stores/video-selector-store';
import { saveTimeline } from '@/lib/supabase/timeline-service';

const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// Shared ref so other hooks can await any in-flight save
let saveInFlightPromise: Promise<void> | null = null;

export function waitForSave(): Promise<void> {
  return saveInFlightPromise ?? Promise.resolve();
}

// When true, auto-save is paused (e.g. during video swap)
let autoSavePaused = false;
export function pauseAutoSave() {
  autoSavePaused = true;
}
export function resumeAutoSave() {
  autoSavePaused = false;
}

// Dirty flag: true when Studio has unsaved changes
let isDirty = false;

export function useAutoSave() {
  const { studio } = useStudioStore();
  const projectId = useProjectId();
  const { getVideoId } = useVideoSelectorStore();
  const isSavingRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const debouncedSaveTimerRef =
    useRef<ReturnType<typeof setTimeout>>(undefined);
  const DEBOUNCE_DELAY = 5000; // 5 seconds

  const performSave = useCallback(async () => {
    if (autoSavePaused) return;
    const state = useStudioStore.getState();
    if (state.isExporting) return;
    if (isSavingRef.current || !state.studio) return;

    isSavingRef.current = true;
    setSaveStatus('saving');
    clearTimeout(savedTimerRef.current);

    const currentVideoId = getVideoId(projectId) ?? undefined;

    const promise = (async () => {
      try {
        await saveTimeline(
          projectId,
          state.studio!.tracks,
          state.studio!.clips,
          currentVideoId
        );
        isDirty = false;
        clearTimeout(debouncedSaveTimerRef.current);
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
  }, [projectId, getVideoId]);

  // Schedule a debounced save when Studio state changes
  const scheduleDebouncedSave = useCallback(() => {
    if (autoSavePaused) return;
    isDirty = true;
    clearTimeout(debouncedSaveTimerRef.current);
    debouncedSaveTimerRef.current = setTimeout(performSave, DEBOUNCE_DELAY);
  }, [performSave]);

  // Listen to Studio change events for change-triggered saves
  useEffect(() => {
    if (!studio) return;
    const CHANGE_EVENTS = [
      'clip:added',
      'clips:added',
      'clip:removed',
      'clips:removed',
      'clip:updated',
      'clip:replaced',
      'track:added',
      'track:removed',
      'track:order-changed',
      'studio:restored',
    ];

    for (const event of CHANGE_EVENTS) {
      studio.on(event, scheduleDebouncedSave);
    }
    return () => {
      for (const event of CHANGE_EVENTS) {
        studio.off(event, scheduleDebouncedSave);
      }
      clearTimeout(debouncedSaveTimerRef.current);
    };
  }, [studio, scheduleDebouncedSave]);

  // Auto-save interval
  useEffect(() => {
    if (!studio) return;

    const intervalId = setInterval(performSave, AUTO_SAVE_INTERVAL);

    return () => {
      clearInterval(intervalId);
      clearTimeout(savedTimerRef.current);
      // Sync save on unmount (best effort, only if dirty)
      if (isDirty && studio && studio.clips.length > 0) {
        const currentVideoId = getVideoId(projectId) ?? undefined;
        saveTimeline(
          projectId,
          studio.tracks,
          studio.clips,
          currentVideoId
        ).catch(console.error);
      }
    };
  }, [studio, projectId, performSave, getVideoId]);

  // Warn on tab close if unsaved changes; save when tab goes to background
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isDirty) {
        performSave();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [performSave]);

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
