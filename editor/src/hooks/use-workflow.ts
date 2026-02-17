import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getLatestStoryboardWithScenes,
  getLatestStoryboard,
  getStoryboardWithScenesById,
  subscribeToSceneUpdates,
  type GridImage,
  type Background,
  type RefObject,
  type Storyboard,
  type StoryboardWithScenes,
  type SceneRow,
  type StoryboardRow,
} from '@/lib/supabase/workflow-service';

const fetchStoryboardData = async (
  storyboardId: string | null | undefined,
  projectId: string | null,
  includeScenes: boolean
): Promise<StoryboardWithScenes | Storyboard | null> => {
  if (storyboardId) {
    return getStoryboardWithScenesById(storyboardId);
  }
  if (includeScenes && projectId) {
    return getLatestStoryboardWithScenes(projectId);
  }
  if (projectId) {
    return getLatestStoryboard(projectId);
  }
  return null;
};

interface UseWorkflowOptions {
  /** Whether to subscribe to real-time updates */
  realtime?: boolean;
  /** Whether to include scenes data */
  includeScenes?: boolean;
  /** Optional specific storyboard ID to fetch. If provided, fetches that storyboard instead of latest */
  storyboardId?: string | null;
}

interface UseWorkflowResult {
  /** The latest storyboard data */
  storyboard: StoryboardWithScenes | Storyboard | null;
  /** The latest grid image data (derived from storyboard for backward compatibility) */
  gridImage: GridImage | null;
  /** All grid images (for ref_to_video mode with multiple grids) */
  gridImages: GridImage[];
  /** Whether data is being loaded */
  loading: boolean;
  /** Any error that occurred */
  error: Error | null;
  /** Manually refresh the data */
  refresh: () => Promise<void>;
  /** Whether the workflow is complete (all first_frames are success/failed) */
  isComplete: boolean;
  /** Whether the workflow is in progress */
  isProcessing: boolean;
  /** Whether the grid is being split into scenes (first_frames processing with no url) */
  isSplitting: boolean;
}

/**
 * Hook to fetch and optionally subscribe to the latest workflow for a project
 */
export function useWorkflow(
  projectId: string | null,
  options: UseWorkflowOptions = {}
): UseWorkflowResult {
  const { realtime = false, includeScenes = true, storyboardId } = options;

  const [storyboard, setStoryboard] = useState<
    StoryboardWithScenes | Storyboard | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const hasFetchedRef = useRef(false);

  // All grid images
  const gridImages = useMemo((): GridImage[] => {
    if (!storyboard) return [];
    if ('grid_images' in storyboard) {
      return storyboard.grid_images || [];
    }
    return [];
  }, [storyboard]);

  // Derive gridImage from storyboard for backward compatibility (first grid)
  const gridImage = useMemo((): GridImage | null => {
    return gridImages[0] || null;
  }, [gridImages]);

  const fetchData = useCallback(async () => {
    // If storyboardId is provided, use it; otherwise require projectId
    if (!storyboardId && !projectId) {
      setStoryboard(null);
      setLoading(false);
      return;
    }

    // Only show loading spinner on initial fetch, not on refreshes
    if (!hasFetchedRef.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const data = await fetchStoryboardData(
        storyboardId,
        projectId,
        includeScenes
      );
      setStoryboard(data);
      hasFetchedRef.current = true;
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch workflow')
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, includeScenes, storyboardId]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Real-time subscription for grid_images, first_frames, and voiceovers
  // Use the first grid image ID as the subscription key (the handler updates all grids by ID match)
  useEffect(() => {
    if (!realtime || !gridImage?.id) return;

    const unsubscribe = subscribeToSceneUpdates(
      gridImage.id,
      {
        onGridImageUpdate: (updated) => {
          setStoryboard((prev) => {
            if (!prev || !('grid_images' in prev)) return prev;
            const exists = prev.grid_images.some((gi) => gi.id === updated.id);
            const updatedGridImages = exists
              ? prev.grid_images.map((gi) =>
                  gi.id === updated.id ? updated : gi
                )
              : prev.grid_images;
            return { ...prev, grid_images: updatedGridImages };
          });
        },
        onFirstFrameUpdate: (updatedFrame) => {
          setStoryboard((prev) => {
            if (!prev || !('scenes' in prev)) return prev;
            const updatedScenes = prev.scenes.map((scene) => ({
              ...scene,
              first_frames: scene.first_frames.map((ff) =>
                ff.id === updatedFrame.id ? updatedFrame : ff
              ),
            }));
            return { ...prev, scenes: updatedScenes };
          });
        },
        onSceneUpdate: (updatedScene: SceneRow) => {
          setStoryboard((prev) => {
            if (!prev || !('scenes' in prev)) return prev;
            const updatedScenes = prev.scenes.map((scene) =>
              scene.id === updatedScene.id
                ? { ...scene, ...updatedScene }
                : scene
            );
            return { ...prev, scenes: updatedScenes };
          });
        },
        onVoiceoverUpdate: (updatedVoiceover) => {
          setStoryboard((prev) => {
            if (!prev || !('scenes' in prev)) return prev;
            const updatedScenes = prev.scenes.map((scene) => {
              const existingIndex = scene.voiceovers.findIndex(
                (vo) => vo.id === updatedVoiceover.id
              );
              if (existingIndex >= 0) {
                return {
                  ...scene,
                  voiceovers: scene.voiceovers.map((vo) =>
                    vo.id === updatedVoiceover.id ? updatedVoiceover : vo
                  ),
                };
              } else if (scene.id === updatedVoiceover.scene_id) {
                return {
                  ...scene,
                  voiceovers: [...scene.voiceovers, updatedVoiceover],
                };
              }
              return scene;
            });
            return { ...prev, scenes: updatedScenes };
          });
        },
        onBackgroundUpdate: (updatedBg: Background) => {
          setStoryboard((prev) => {
            if (!prev || !('scenes' in prev)) return prev;
            const updatedScenes = prev.scenes.map((scene) => {
              const existingIndex = scene.backgrounds.findIndex(
                (bg) => bg.id === updatedBg.id
              );
              if (existingIndex >= 0) {
                return {
                  ...scene,
                  backgrounds: scene.backgrounds.map((bg) =>
                    bg.id === updatedBg.id ? updatedBg : bg
                  ),
                };
              } else if (scene.id === updatedBg.scene_id) {
                return {
                  ...scene,
                  backgrounds: [...scene.backgrounds, updatedBg],
                };
              }
              return scene;
            });
            return { ...prev, scenes: updatedScenes };
          });
        },
        onObjectUpdate: (updatedObj: RefObject) => {
          setStoryboard((prev) => {
            if (!prev || !('scenes' in prev)) return prev;
            const updatedScenes = prev.scenes.map((scene) => {
              const existingIndex = scene.objects.findIndex(
                (obj) => obj.id === updatedObj.id
              );
              if (existingIndex >= 0) {
                return {
                  ...scene,
                  objects: scene.objects.map((obj) =>
                    obj.id === updatedObj.id ? updatedObj : obj
                  ),
                };
              } else if (scene.id === updatedObj.scene_id) {
                return {
                  ...scene,
                  objects: [...scene.objects, updatedObj],
                };
              }
              return scene;
            });
            return { ...prev, scenes: updatedScenes };
          });
        },
        onStoryboardUpdate: (updatedSb: StoryboardRow) => {
          setStoryboard((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              plan_status: updatedSb.plan_status,
            } as typeof prev;
          });
          // When plan_status transitions to 'approved', refetch to get new scenes
          if (updatedSb.plan_status === 'approved') {
            fetchData();
          }
        },
      },
      storyboard?.id
    );

    return unsubscribe;
  }, [realtime, gridImage?.id, storyboard?.id]);

  // Compute derived state
  const isProcessing =
    storyboard?.plan_status === 'generating' ||
    gridImages.some(
      (gi) => gi.status === 'pending' || gi.status === 'processing'
    );

  const scenes = storyboard && 'scenes' in storyboard ? storyboard.scenes : [];

  const isSplitting = (() => {
    // For ref_to_video, splitting state is plan_status === 'splitting'
    if (storyboard?.plan_status === 'splitting') {
      return true;
    }
    // For i2v, check first_frames
    if (!gridImage || gridImage.status !== 'generated') return false;
    if (!scenes.length) return false;
    return scenes.some((scene) =>
      scene.first_frames.some((ff) => ff.status === 'processing' && !ff.url)
    );
  })();

  const isComplete = (() => {
    if (!gridImage) return false;
    if (gridImage.status === 'failed') return true;
    if (gridImage.status !== 'success') return false;

    if (scenes.length > 0) {
      return scenes.every((scene) =>
        scene.first_frames.every(
          (ff) => ff.status === 'success' || ff.status === 'failed'
        )
      );
    }

    return gridImage.status === 'success';
  })();

  return {
    storyboard,
    gridImage,
    gridImages,
    loading,
    error,
    refresh: fetchData,
    isComplete,
    isProcessing,
    isSplitting,
  };
}

/**
 * Hook to poll for workflow completion
 * Useful when real-time subscriptions are not available or desired
 */
export function useWorkflowPolling(
  projectId: string | null,
  options: { pollInterval?: number; enabled?: boolean } = {}
) {
  const { pollInterval = 3000, enabled = true } = options;
  const workflow = useWorkflow(projectId, { includeScenes: true });

  useEffect(() => {
    if (!enabled || !projectId || workflow.isComplete) return;

    const interval = setInterval(() => {
      workflow.refresh();
    }, pollInterval);

    return () => clearInterval(interval);
  }, [enabled, projectId, workflow.isComplete, pollInterval, workflow.refresh]);

  return workflow;
}
