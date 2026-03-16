'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Clapperboard, Trash2 } from 'lucide-react';
import { CreateSeriesDialog } from './create-series-dialog';
import { SeriesDetailPage } from './series-detail-page';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type {
  Series,
  SeriesWithAssets,
  SeriesEpisodeWithVariants,
} from '@/lib/supabase/series-service';

// ── Series card ────────────────────────────────────────────────────────────────

function SeriesCard({
  series,
  onClick,
  onDelete,
}: {
  series: Series;
  onClick: () => void;
  onDelete: (id: string) => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="text-left w-full border border-border/50 rounded-xl p-5 hover:border-primary/40 hover:bg-muted/30 transition-all group relative"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <h3 className="font-semibold text-sm group-hover:text-primary transition-colors pr-16">
              {series.name}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {series.genre && (
                <Badge variant="secondary" className="text-xs font-normal">
                  {series.genre}
                </Badge>
              )}
              {series.tone && (
                <Badge variant="outline" className="text-xs font-normal">
                  {series.tone}
                </Badge>
              )}
            </div>
          </div>
        </div>
        {series.bible && (
          <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
            {series.bible}
          </p>
        )}
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-muted-foreground/50">
            {new Date(series.updated_at).toLocaleDateString()}
          </p>
          <button
            type="button"
            className="md:opacity-0 md:group-hover:opacity-100 transition-opacity p-2 sm:p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              setShowConfirm(true);
            }}
            title="Delete series"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </button>
      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title={`Delete "${series.name}"?`}
        description="This will permanently delete the series and all its assets. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => onDelete(series.id)}
      />
    </>
  );
}

// ── Main content ───────────────────────────────────────────────────────────────

export function SeriesContent() {
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Detail view state
  const [detailSeries, setDetailSeries] = useState<SeriesWithAssets | null>(
    null
  );
  const [detailEpisodes, setDetailEpisodes] = useState<
    SeriesEpisodeWithVariants[]
  >([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchSeries = useCallback(async () => {
    try {
      const res = await fetch('/api/series');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setSeriesList(data.series ?? []);
    } catch (err) {
      console.error('Failed to fetch series:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSeries();
  }, [fetchSeries]);

  const openDetail = async (s: Series) => {
    setLoadingDetail(true);
    try {
      const [seriesRes, episodesRes] = await Promise.all([
        fetch(`/api/series/${s.id}`),
        fetch(`/api/series/${s.id}/episodes`),
      ]);
      if (!seriesRes.ok) throw new Error('Not found');
      const { series } = await seriesRes.json();
      const { episodes } = episodesRes.ok
        ? await episodesRes.json()
        : { episodes: [] };
      setDetailSeries(series);
      setDetailEpisodes(episodes);
    } catch (err) {
      console.error('Failed to open series detail:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const refreshDetail = async () => {
    if (!detailSeries) return;
    await openDetail(detailSeries as Series);
    await fetchSeries();
  };

  const handleCreated = (newSeries: Series) => {
    setShowCreateDialog(false);
    // Open the new series detail view
    openDetail(newSeries);
  };

  const handleDeleteSeries = async (id: string) => {
    try {
      const res = await fetch(`/api/series/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      setSeriesList((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Delete series error:', err);
    }
  };

  const filtered = searchQuery
    ? seriesList.filter(
        (s) =>
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.genre?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.tone?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : seriesList;

  // ── Detail view ──
  if (detailSeries) {
    return (
      <SeriesDetailPage
        series={detailSeries}
        episodes={detailEpisodes}
        onBack={() => {
          setDetailSeries(null);
          setDetailEpisodes([]);
        }}
        onRefresh={refreshDetail}
      />
    );
  }

  if (loadingDetail) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Series</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your serialized productions — characters, locations, props,
            and episodes in one place.
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Series
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search series..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-pulse text-muted-foreground">
            Loading series...
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Clapperboard className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground">
            {searchQuery ? 'No series found' : 'No series yet'}
          </h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
            {searchQuery
              ? 'Try a different search term.'
              : 'Create your first series to start organising episodes, characters, and assets together.'}
          </p>
          {!searchQuery && (
            <Button className="mt-4" onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Series
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((s) => (
            <SeriesCard
              key={s.id}
              series={s}
              onClick={() => openDetail(s)}
              onDelete={handleDeleteSeries}
            />
          ))}
        </div>
      )}

      <CreateSeriesDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleCreated}
      />
    </div>
  );
}
