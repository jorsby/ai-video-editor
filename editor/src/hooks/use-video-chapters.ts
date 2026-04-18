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
  status: string | null;
}

function resolveChapterStatus(rawStatus: string | null): ChapterStatus {
  if (rawStatus === 'ready') return 'ready';
  if (rawStatus === 'draft' || rawStatus === 'in_progress') return 'draft';
  return 'planned';
}

function stringFromSettings(
  settings: Record<string, unknown>,
  key: string
): string | null {
  const v = settings[key];
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
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
          .select('id, name')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true })
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

        // Creative fields (bible/genre/tone) live in projects.generation_settings
        // post-migration, not on the videos row.
        const { data: projectRow, error: projectError } = await supabase
          .from('projects')
          .select('generation_settings')
          .eq('id', projectId)
          .maybeSingle();

        if (projectError) {
          throw new Error(projectError.message);
        }

        const gs =
          (projectRow?.generation_settings as Record<string, unknown>) ?? {};

        const { data: chaptersData, error: chaptersError } = await supabase
          .from('chapters')
          .select('id, order, title, synopsis, status')
          .eq('video_id', foundVideoId)
          .order('order', { ascending: true });

        if (chaptersError) {
          throw new Error(chaptersError.message);
        }

        const parsedChapters: VideoChapterItem[] = (
          (chaptersData ?? []) as ChapterRow[]
        ).map((chapter) => ({
          id: chapter.id,
          chapterNumber: chapter.order,
          title: chapter.title,
          synopsis: chapter.synopsis,
          status: resolveChapterStatus(chapter.status),
        }));

        if (!cancelled) {
          setVideo({
            id: foundVideoId,
            name: linkedVideo?.name ?? null,
            bible: stringFromSettings(gs, 'bible'),
            genre: stringFromSettings(gs, 'genre'),
            tone: stringFromSettings(gs, 'tone'),
          });
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
