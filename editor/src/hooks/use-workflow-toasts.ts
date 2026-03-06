'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type {
  PlanStatus,
  StoryboardRow,
} from '@/lib/supabase/workflow-service';

/**
 * Shows toast notifications for workflow status changes via Supabase Realtime.
 * Mount once in the editor layout so it works globally.
 */
export function useWorkflowToasts(projectId: string | null) {
  useEffect(() => {
    if (!projectId) return;

    const supabase = createClient('studio');

    // Track storyboard plan_status changes
    const sbChannel = supabase
      .channel(`toast_storyboards_${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'studio',
          table: 'storyboards',
        },
        (payload) => {
          const row = payload.new as StoryboardRow;
          if (row.project_id !== projectId) return;
          handlePlanStatusChange(row.plan_status);
        }
      )
      .subscribe();

    // Track grid_images status changes
    const gridChannel = supabase
      .channel(`toast_grid_images_${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'studio',
          table: 'grid_images',
        },
        (payload) => {
          const row = payload.new as { status: string };
          if (row.status === 'failed') {
            toast.error('Grid image generation failed');
          }
        }
      )
      .subscribe();

    // Track scene video_status changes
    const sceneChannel = supabase
      .channel(`toast_scenes_${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'studio',
          table: 'scenes',
        },
        (payload) => {
          const row = payload.new as {
            video_status: string | null;
            order: number;
          };
          if (row.video_status === 'processing') {
            toast.loading(`Generating scene ${row.order + 1} video...`, {
              id: `video_scene_${row.order}`,
            });
          } else if (row.video_status === 'success') {
            toast.success(`Scene ${row.order + 1} video complete`, {
              id: `video_scene_${row.order}`,
            });
          } else if (row.video_status === 'failed') {
            toast.error(`Scene ${row.order + 1} video failed`, {
              id: `video_scene_${row.order}`,
            });
          }
        }
      )
      .subscribe();

    // Track first_frames status changes
    const ffChannel = supabase
      .channel(`toast_first_frames_${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'studio',
          table: 'first_frames',
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            image_edit_status: string | null;
          };
          if (
            row.image_edit_status === 'enhancing' ||
            row.image_edit_status === 'outpainting'
          ) {
            toast.loading('Enhancing image...', { id: `ff_edit_${row.id}` });
          } else if (row.image_edit_status === 'success') {
            toast.success('Image enhanced', { id: `ff_edit_${row.id}` });
          } else if (row.image_edit_status === 'failed') {
            toast.error('Image enhancement failed', {
              id: `ff_edit_${row.id}`,
            });
          }
        }
      )
      .subscribe();

    // Track voiceovers status changes
    const voChannel = supabase
      .channel(`toast_voiceovers_${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'voiceovers',
        },
        (payload) => {
          if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE')
            return;
          const row = payload.new as { status: string; id: string };
          if (row.status === 'processing') {
            toast.loading('Generating voiceover...', { id: `vo_${row.id}` });
          } else if (row.status === 'success') {
            toast.success('Voiceover ready', { id: `vo_${row.id}` });
          } else if (row.status === 'failed') {
            toast.error('Voiceover generation failed', { id: `vo_${row.id}` });
          }
        }
      )
      .subscribe();

    const channels = [
      sbChannel,
      gridChannel,
      sceneChannel,
      ffChannel,
      voChannel,
    ];

    return () => {
      for (const ch of channels) {
        supabase.removeChannel(ch);
      }
    };
  }, [projectId]);
}

function handlePlanStatusChange(status: PlanStatus) {
  const id = 'storyboard_status';
  switch (status) {
    case 'generating':
      toast.loading('Generating grid images...', { id });
      break;
    case 'splitting':
      toast.loading('Splitting grid images...', { id });
      break;
    case 'grid_ready':
      toast.success('Grid ready for review', { id });
      break;
    case 'approved':
      toast.success('Storyboard approved', { id });
      break;
    case 'failed':
      toast.error('Generation failed', { id });
      break;
  }
}
