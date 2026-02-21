'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CalendarGrid } from './calendar-grid';
import { PostDetailDialog } from './post-detail-dialog';
import type { MixpostPost } from '@/types/calendar';

type StatusFilter = 'all' | 'scheduled' | 'published' | 'failed';

function formatDateParam(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export function CalendarContent() {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [posts, setPosts] = useState<MixpostPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<MixpostPost | null>(null);

  const fetchPosts = useCallback(async (month: Date, filter: StatusFilter) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        date: formatDateParam(month),
        calendar_type: 'month',
      });
      if (filter !== 'all') params.set('status', filter);

      const res = await fetch(`/api/mixpost/posts/list?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to fetch posts');
      }

      const data: { posts: MixpostPost[] } = await res.json();
      setPosts((data.posts || []).filter((p) => !p.trashed));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch posts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts(currentMonth, statusFilter);
  }, [fetchPosts, currentMonth, statusFilter]);

  // Status counts from loaded posts
  const counts = useMemo(() => {
    let queued = 0, published = 0, failed = 0;
    for (const p of posts) {
      if (p.status === 'scheduled') queued++;
      else if (p.status === 'published') published++;
      else if (p.status === 'failed') failed++;
    }
    return { queued, published, failed };
  }, [posts]);

  // Group posts by date key "YYYY-MM-DD"
  const postsByDate = useMemo(() => {
    const map = new Map<string, MixpostPost[]>();
    for (const post of posts) {
      const dateStr = post.published_at || post.scheduled_at;
      if (!dateStr) continue;
      const dayKey = dateStr.slice(0, 10);
      const existing = map.get(dayKey) || [];
      existing.push(post);
      map.set(dayKey, existing);
    }
    return map;
  }, [posts]);

  const goToPrevMonth = () => {
    setCurrentMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
    );
  };

  const goToNextMonth = () => {
    setCurrentMonth(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
    );
  };

  const goToToday = () => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const monthLabel = currentMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const filterTabs: { label: string; value: StatusFilter; color: string }[] = [
    { label: 'All', value: 'all', color: '' },
    { label: 'Queued', value: 'scheduled', color: 'text-blue-400' },
    { label: 'Published', value: 'published', color: 'text-emerald-400' },
    { label: 'Failed', value: 'failed', color: 'text-red-400' },
  ];

  if (error) {
    return (
      <div className="space-y-2 py-12 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => fetchPosts(currentMonth, statusFilter)}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Month navigation + status counts */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={goToPrevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="min-w-[200px] text-center text-xl font-semibold text-foreground">
            {monthLabel}
          </h2>
          <Button variant="outline" size="icon" onClick={goToNextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Status count badges */}
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-blue-400">
            Queued: {counts.queued}
          </span>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-400">
            Published: {counts.published}
          </span>
          {counts.failed > 0 && (
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-red-400">
              Failed: {counts.failed}
            </span>
          )}
        </div>

        <Button variant="ghost" size="sm" onClick={goToToday}>
          Today
        </Button>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-muted/30 p-1 w-fit">
        {filterTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              statusFilter === tab.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
              tab.color && statusFilter === tab.value ? tab.color : ''
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Calendar grid */}
      {isLoading ? (
        <CalendarGridSkeleton />
      ) : (
        <CalendarGrid
          currentMonth={currentMonth}
          postsByDate={postsByDate}
          onPostClick={setSelectedPost}
        />
      )}

      {/* Post detail dialog */}
      <PostDetailDialog
        post={selectedPost}
        onClose={() => setSelectedPost(null)}
      />
    </div>
  );
}

function CalendarGridSkeleton() {
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-7 gap-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div
            key={d}
            className="py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, row) => (
        <div key={row} className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, col) => (
            <Skeleton key={col} className="h-[100px] rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}
