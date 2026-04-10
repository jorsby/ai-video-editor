import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface VideoChapterSummary {
  id: string;
  name: string | null;
  bible: string | null;
  genre: string | null;
  tone: string | null;
}

export type ChapterStatus = 'ready' | 'draft' | 'planned';

export interface VideoChapterItem {
  id: string;
  chapterNumber: number;
  title: string | null;
  synopsis: string | null;
  storyboardId: string | null;
  storyboardPlanStatus: string | null;
  status: ChapterStatus;
}

interface UseVideoChaptersResult {
  isLoading: boolean;
  video: VideoChapterSummary | null;
  chapters: VideoChapterItem[];
  error: string | null;
}

interface ChapterRow {
  id: string;
  order: number;
  title: string | null;
  synopsis: string | null;
  storyboard_id: string | null;
}

interface StoryboardStatusRow {
  id: string;
  plan_status: string | null;
}

function resolveChapterStatus(
  storyboardId: string | null,
  storyboardPlanStatus: string | null
): ChapterStatus {
  if (!storyboardId) {
    return 'planned';
  }

  if (storyboardPlanStatus === 'approved') {
    return 'ready';
  }

  return 'draft';
}

export function useVideoChapters(
  projectId: string | null
): UseVideoChaptersResult {
  const [isLoading, setIsLoading] = useState(true);
  const [video, setVideo] = useState<VideoChapterSummary | null>(null);
  const [chapters, setChapters] = useState<VideoChapterItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadVideoChapters() {
      if (!projectId) {
        if (!cancelled) {
          setIsLoading(false);
          setVideo(null);
          setChapters([]);
          setError(null);
        }
        return;
      }

      if (!cancelled) {
        setIsLoading(true);
        setError(null);
      }

      const supabase = createClient('studio');

      try {
        const { data: linkedVideo, error: videoLookupError } = await supabase
          .from('videos')
          .select('id')
          .eq('project_id', projectId)
          .limit(1)
          .maybeSingle();

        if (videoLookupError) {
          throw new Error(videoLookupError.message);
        }

        const foundVideoId = linkedVideo?.id ?? null;

        if (!foundVideoId) {
          if (!cancelled) {
            setVideo(null);
            setChapters([]);
            setIsLoading(false);
          }
          return;
        }

        const { data: videoData, error: videoError } = await supabase
          .from('videos')
          .select('id, name, bible, genre, tone')
          .eq('id', foundVideoId)
          .maybeSingle();

        if (videoError) {
          throw new Error(videoError.message);
        }

        const { data: chaptersData, error: chaptersError } = await supabase
          .from('chapters')
          .select('id, order, title, synopsis, storyboard_id')
          .eq('video_id', foundVideoId)
          .order('order', { ascending: true });

        if (chaptersError) {
          throw new Error(chaptersError.message);
        }

        const storyboardIds = Array.from(
          new Set(
            ((chaptersData ?? []) as ChapterRow[])
              .map((chapter) => chapter.storyboard_id)
              .filter((id): id is string => !!id)
          )
        );

        const storyboardStatusById = new Map<string, string | null>();

        if (storyboardIds.length > 0) {
          const { data: storyboardData, error: storyboardError } =
            await supabase
              .from('storyboards')
              .select('id, plan_status')
              .in('id', storyboardIds);

          if (storyboardError) {
            throw new Error(storyboardError.message);
          }

          for (const storyboard of (storyboardData ??
            []) as StoryboardStatusRow[]) {
            storyboardStatusById.set(storyboard.id, storyboard.plan_status);
          }
        }

        const parsedChapters: VideoChapterItem[] = (
          (chaptersData ?? []) as ChapterRow[]
        ).map((chapter) => {
          const storyboardPlanStatus = chapter.storyboard_id
            ? (storyboardStatusById.get(chapter.storyboard_id) ?? null)
            : null;

          return {
            id: chapter.id,
            chapterNumber: chapter.order,
            title: chapter.title,
            synopsis: chapter.synopsis,
            storyboardId: chapter.storyboard_id,
            storyboardPlanStatus,
            status: resolveChapterStatus(
              chapter.storyboard_id,
              storyboardPlanStatus
            ),
          };
        });

        if (!cancelled) {
          setVideo(
            videoData
              ? {
                  id: videoData.id,
                  name: videoData.name,
                  bible: videoData.bible,
                  genre: videoData.genre,
                  tone: videoData.tone,
                }
              : null
          );
          setChapters(parsedChapters);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load video chapters'
          );
          setVideo(null);
          setChapters([]);
          setIsLoading(false);
        }
      }
    }

    loadVideoChapters();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { isLoading, video, chapters, error };
}
