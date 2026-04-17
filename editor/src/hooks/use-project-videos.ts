import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface ProjectVideo {
  id: string;
  name: string;
}

interface UseProjectVideosResult {
  videos: ProjectVideo[];
  isLoading: boolean;
}

export function useProjectVideos(
  projectId: string | null
): UseProjectVideosResult {
  const [videos, setVideos] = useState<ProjectVideo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const refresh = useCallback(() => {
    setRefreshNonce((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!projectId) {
        if (!cancelled) {
          setVideos([]);
          setIsLoading(false);
        }
        return;
      }

      const supabase = createClient('studio');

      const { data, error } = await supabase
        .from('videos')
        .select('id, name')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (!cancelled) {
        if (!error && data) {
          setVideos(
            data.map((row) => ({
              id: row.id as string,
              name: (row.name as string) || 'Untitled Video',
            }))
          );
        }
        setIsLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [projectId, refreshNonce]);

  // Realtime subscription for videos table
  useEffect(() => {
    if (!projectId) return;

    const supabase = createClient('studio');
    const channel = supabase
      .channel(`project-videos-list-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'videos',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, refresh]);

  return { videos, isLoading };
}
