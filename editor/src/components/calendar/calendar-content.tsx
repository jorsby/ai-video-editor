'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarGrid } from './calendar-grid';
import { PostDetailDialog } from './post-detail-dialog';
import type { MixpostPost, MixpostPaginationMeta } from '@/types/calendar';

export function CalendarContent() {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [posts, setPosts] = useState<MixpostPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<MixpostPost | null>(null);

  const fetchAllPosts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const firstRes = await fetch('/api/mixpost/posts/list?page=1');
      if (!firstRes.ok) {
        const err = await firstRes.json();
        throw new Error(err.error || 'Failed to fetch posts');
      }

      const firstData: { posts: MixpostPost[]; meta: MixpostPaginationMeta } =
        await firstRes.json();
      let allPosts: MixpostPost[] = [...firstData.posts];

      // Fetch remaining pages in parallel
      if (firstData.meta.last_page > 1) {
        const pagePromises = [];
        for (let p = 2; p <= firstData.meta.last_page; p++) {
          pagePromises.push(
            fetch(`/api/mixpost/posts/list?page=${p}`).then((r) => r.json())
          );
        }
        const results = await Promise.all(pagePromises);
        for (const result of results) {
          if (result.posts) {
            allPosts = [...allPosts, ...result.posts];
          }
        }
      }

      // Keep only non-trashed posts that have a date
      setPosts(
        allPosts.filter(
          (p) => !p.trashed && (p.scheduled_at || p.published_at)
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch posts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllPosts();
  }, [fetchAllPosts]);

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

  if (error) {
    return (
      <div className="space-y-2 py-12 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchAllPosts}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
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
        <Button variant="ghost" size="sm" onClick={goToToday}>
          Today
        </Button>
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
