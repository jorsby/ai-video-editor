import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface SeriesEpisodeSummary {
  id: string;
  name: string | null;
  bible: string | null;
  genre: string | null;
  tone: string | null;
}

export type EpisodeStatus = 'ready' | 'draft' | 'planned';

export interface SeriesEpisodeItem {
  id: string;
  episodeNumber: number;
  title: string | null;
  synopsis: string | null;
  storyboardId: string | null;
  storyboardPlanStatus: string | null;
  status: EpisodeStatus;
}

interface UseSeriesEpisodesResult {
  isLoading: boolean;
  series: SeriesEpisodeSummary | null;
  episodes: SeriesEpisodeItem[];
  error: string | null;
}

interface EpisodeRow {
  id: string;
  episode_number: number;
  title: string | null;
  synopsis: string | null;
  storyboard_id: string | null;
}

interface StoryboardStatusRow {
  id: string;
  plan_status: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function resolveEpisodeStatus(
  storyboardId: string | null,
  storyboardPlanStatus: string | null
): EpisodeStatus {
  if (!storyboardId) {
    return 'planned';
  }

  if (storyboardPlanStatus === 'approved') {
    return 'ready';
  }

  return 'draft';
}

export function useSeriesEpisodes(
  projectId: string | null
): UseSeriesEpisodesResult {
  const [isLoading, setIsLoading] = useState(true);
  const [series, setSeries] = useState<SeriesEpisodeSummary | null>(null);
  const [episodes, setEpisodes] = useState<SeriesEpisodeItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSeriesEpisodes() {
      if (!projectId) {
        if (!cancelled) {
          setIsLoading(false);
          setSeries(null);
          setEpisodes([]);
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
        let foundSeriesId: string | null = null;

        try {
          const projectResponse = await fetch(`/api/projects/${projectId}`);
          if (projectResponse.ok) {
            const projectData: unknown = await projectResponse.json();
            const project = isRecord(projectData) ? projectData.project : null;
            const settings =
              isRecord(project) && isRecord(project.settings)
                ? project.settings
                : null;

            if (settings?.series_id && typeof settings.series_id === 'string') {
              foundSeriesId = settings.series_id;
            }
          }
        } catch {
          // Fall back to series.project_id lookup below.
        }

        if (!foundSeriesId) {
          const { data: fallbackSeries, error: fallbackError } = await supabase
            .from('series')
            .select('id')
            .eq('project_id', projectId)
            .limit(1)
            .maybeSingle();

          if (fallbackError) {
            throw new Error(fallbackError.message);
          }

          foundSeriesId = fallbackSeries?.id ?? null;
        }

        if (!foundSeriesId) {
          if (!cancelled) {
            setSeries(null);
            setEpisodes([]);
            setIsLoading(false);
          }
          return;
        }

        const { data: seriesData, error: seriesError } = await supabase
          .from('series')
          .select('id, name, bible, genre, tone')
          .eq('id', foundSeriesId)
          .maybeSingle();

        if (seriesError) {
          throw new Error(seriesError.message);
        }

        const { data: episodesData, error: episodesError } = await supabase
          .from('series_episodes')
          .select('id, episode_number, title, synopsis, storyboard_id')
          .eq('series_id', foundSeriesId)
          .order('episode_number', { ascending: true });

        if (episodesError) {
          throw new Error(episodesError.message);
        }

        const storyboardIds = Array.from(
          new Set(
            ((episodesData ?? []) as EpisodeRow[])
              .map((episode) => episode.storyboard_id)
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

        const parsedEpisodes: SeriesEpisodeItem[] = (
          (episodesData ?? []) as EpisodeRow[]
        ).map((episode) => {
          const storyboardPlanStatus = episode.storyboard_id
            ? (storyboardStatusById.get(episode.storyboard_id) ?? null)
            : null;

          return {
            id: episode.id,
            episodeNumber: episode.episode_number,
            title: episode.title,
            synopsis: episode.synopsis,
            storyboardId: episode.storyboard_id,
            storyboardPlanStatus,
            status: resolveEpisodeStatus(
              episode.storyboard_id,
              storyboardPlanStatus
            ),
          };
        });

        if (!cancelled) {
          setSeries(
            seriesData
              ? {
                  id: seriesData.id,
                  name: seriesData.name,
                  bible: seriesData.bible,
                  genre: seriesData.genre,
                  tone: seriesData.tone,
                }
              : null
          );
          setEpisodes(parsedEpisodes);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load series episodes'
          );
          setSeries(null);
          setEpisodes([]);
          setIsLoading(false);
        }
      }
    }

    loadSeriesEpisodes();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { isLoading, series, episodes, error };
}
