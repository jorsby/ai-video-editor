'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { SeriesDetailPage } from '@/components/series/series-detail-page';
import type {
  SeriesWithAssets,
  SeriesEpisodeWithVariants,
} from '@/lib/supabase/series-service';

export default function SeriesDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [series, setSeries] = useState<SeriesWithAssets | null>(null);
  const [episodes, setEpisodes] = useState<SeriesEpisodeWithVariants[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [seriesRes, episodesRes] = await Promise.all([
        fetch(`/api/series/${id}`),
        fetch(`/api/series/${id}/episodes`),
      ]);
      if (!seriesRes.ok) {
        setError(true);
        return;
      }
      const { series: s } = await seriesRes.json();
      const { episodes: eps } = episodesRes.ok
        ? await episodesRes.json()
        : { episodes: [] };
      setSeries(s);
      setEpisodes(eps);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-muted-foreground">
          Loading series...
        </div>
      </div>
    );
  }

  if (error || !series) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h3 className="text-lg font-medium text-muted-foreground">
          Series not found
        </h3>
        <button
          type="button"
          onClick={() => router.push('/series')}
          className="mt-4 text-sm text-primary hover:underline"
        >
          ← Back to Series
        </button>
      </div>
    );
  }

  return (
    <SeriesDetailPage
      series={series}
      episodes={episodes}
      onBack={() => router.push('/series')}
      onRefresh={fetchDetail}
    />
  );
}
