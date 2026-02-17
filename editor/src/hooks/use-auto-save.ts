import { useEffect, useRef } from 'react';
import { useStudioStore } from '@/stores/studio-store';
import { useProjectId } from '@/contexts/project-context';
import { saveTimeline } from '@/lib/supabase/timeline-service';

const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

export function useAutoSave() {
  const { studio, isExporting } = useStudioStore();
  const projectId = useProjectId();
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (!studio) return;

    const autoSave = async () => {
      if (useStudioStore.getState().isExporting) return;
      if (isSavingRef.current || !studio) return;
      isSavingRef.current = true;
      try {
        await saveTimeline(projectId, studio.tracks, studio.clips);
        console.log('Auto-saved');
      } catch (error) {
        console.error(
          'Auto-save failed:',
          error instanceof Error ? error.message : JSON.stringify(error)
        );
      } finally {
        isSavingRef.current = false;
      }
    };

    // Start interval
    const intervalId = setInterval(autoSave, AUTO_SAVE_INTERVAL);

    // Save on unmount
    return () => {
      clearInterval(intervalId);
      // Sync save on unmount (best effort)
      if (studio && studio.clips.length > 0) {
        saveTimeline(projectId, studio.tracks, studio.clips).catch(
          console.error
        );
      }
    };
  }, [studio, projectId]);
}
