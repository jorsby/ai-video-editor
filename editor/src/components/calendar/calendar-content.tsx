'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Globe } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CalendarGrid } from './calendar-grid';
import { CalendarWeekView } from './calendar-week-view';
import { CalendarDayView } from './calendar-day-view';
import { PostDetailDialog } from './post-detail-dialog';
import { CalendarFilterBar } from './calendar-filter-bar';
import type { MixpostPost, MixpostPostTag } from '@/types/calendar';
import type { MixpostAccount, AccountGroupWithMembers } from '@/types/mixpost';

type StatusFilter = 'all' | 'scheduled' | 'published' | 'failed';
type CalendarView = 'month' | 'week' | 'day';

function formatDateParam(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = -day; // rewind to Sunday (day 0 → 0, day 1 → -1, …, day 6 → -6)
  d.setDate(d.getDate() + diff);
  return d;
}

const COMMON_TIMEZONES = [
  { value: 'local', label: 'Local time' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'New York (ET)' },
  { value: 'America/Chicago', label: 'Chicago (CT)' },
  { value: 'America/Denver', label: 'Denver (MT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
  { value: 'America/Anchorage', label: 'Anchorage (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Honolulu (HT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET)' },
  { value: 'Europe/Helsinki', label: 'Helsinki (EET)' },
  { value: 'Europe/Istanbul', label: 'Istanbul (TRT)' },
  { value: 'Europe/Moscow', label: 'Moscow (MSK)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Karachi', label: 'Karachi (PKT)' },
  { value: 'Asia/Kolkata', label: 'Mumbai/Kolkata (IST)' },
  { value: 'Asia/Dhaka', label: 'Dhaka (BST)' },
  { value: 'Asia/Bangkok', label: 'Bangkok (ICT)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Seoul', label: 'Seoul (KST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST)' },
];

function getMonthsToFetch(date: Date, view: CalendarView): Date[] {
  if (view === 'month' || view === 'day') {
    return [new Date(date.getFullYear(), date.getMonth(), 1)];
  }
  // Week view: may span two months
  const weekStart = getWeekStart(date);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const startMonth = new Date(weekStart.getFullYear(), weekStart.getMonth(), 1);
  if (
    weekEnd.getMonth() !== weekStart.getMonth() ||
    weekEnd.getFullYear() !== weekStart.getFullYear()
  ) {
    return [startMonth, new Date(weekEnd.getFullYear(), weekEnd.getMonth(), 1)];
  }
  return [startMonth];
}

function buildNavLabel(date: Date, view: CalendarView): string {
  if (view === 'month') {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  if (view === 'day') {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }
  // Week
  const weekStart = getWeekStart(date);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (sameMonth) {
    return `${startStr} – ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
  }
  const endStr = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${startStr} – ${endStr}, ${weekEnd.getFullYear()}`;
}

export function CalendarContent() {
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [timezoneValue, setTimezoneValue] = useState<string>('local');
  const timezone = timezoneValue === 'local' ? undefined : timezoneValue;
  const [posts, setPosts] = useState<MixpostPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<MixpostPost | null>(null);

  const [accounts, setAccounts] = useState<MixpostAccount[]>([]);
  const [groups, setGroups] = useState<AccountGroupWithMembers[]>([]);
  const [selectedAccountUuids, setSelectedAccountUuids] = useState<Set<string>>(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [selectedTagUuids, setSelectedTagUuids] = useState<Set<string>>(new Set());

  const fetchPosts = useCallback(async (months: Date[], filter: StatusFilter) => {
    setIsLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        months.map(async (month) => {
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
          return (data.posts || []).filter((p) => !p.trashed);
        })
      );
      // Deduplicate across months
      const seen = new Set<string>();
      const combined: MixpostPost[] = [];
      for (const batch of results) {
        for (const p of batch) {
          if (!seen.has(p.uuid)) {
            seen.add(p.uuid);
            combined.push(p);
          }
        }
      }
      setPosts(combined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch posts');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts(getMonthsToFetch(currentDate, calendarView), statusFilter);
  }, [fetchPosts, currentDate, calendarView, statusFilter]);

  useEffect(() => {
    Promise.all([
      fetch('/api/mixpost/accounts').then((r) => r.json()),
      fetch('/api/account-groups').then((r) => r.json()),
    ]).then(([a, g]) => {
      setAccounts(a.accounts ?? []);
      setGroups(g.groups ?? []);
    }).catch((err) => console.error('Failed to fetch filter data:', err));
  }, []);

  const toggleAccount = useCallback((uuid: string) => {
    setSelectedAccountUuids((prev) => { const n = new Set(prev); n.has(uuid) ? n.delete(uuid) : n.add(uuid); return n; });
  }, []);
  const toggleGroup = useCallback((id: string) => {
    setSelectedGroupIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const toggleTag = useCallback((uuid: string) => {
    setSelectedTagUuids((prev) => { const n = new Set(prev); n.has(uuid) ? n.delete(uuid) : n.add(uuid); return n; });
  }, []);
  const clearAllFilters = useCallback(() => {
    setSelectedAccountUuids(new Set());
    setSelectedGroupIds(new Set());
    setSelectedTagUuids(new Set());
  }, []);

  const postTags = useMemo<MixpostPostTag[]>(() => {
    const seen = new Map<string, MixpostPostTag>();
    for (const post of posts) {
      for (const tag of post.tags) {
        if (!seen.has(tag.uuid)) seen.set(tag.uuid, tag);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [posts]);

  const groupAccountUuids = useMemo<Set<string>>(() => {
    const uuids = new Set<string>();
    for (const group of groups) {
      if (selectedGroupIds.has(group.id)) {
        for (const uuid of group.account_uuids) uuids.add(uuid);
      }
    }
    return uuids;
  }, [groups, selectedGroupIds]);

  const filteredPosts = useMemo<MixpostPost[]>(() => {
    const noChannel = selectedAccountUuids.size === 0;
    const noGroup   = selectedGroupIds.size === 0;
    const noTag     = selectedTagUuids.size === 0;
    if (noChannel && noGroup && noTag) return posts;

    return posts.filter((post) => {
      if (!noChannel || !noGroup) {
        const uuids = post.accounts.map((a) => a.uuid);
        const matchesChannel = !noChannel && uuids.some((u) => selectedAccountUuids.has(u));
        const matchesGroup   = !noGroup   && uuids.some((u) => groupAccountUuids.has(u));
        if (!matchesChannel && !matchesGroup) return false;
      }
      if (!noTag) {
        const postTagUuids = new Set(post.tags.map((t) => t.uuid));
        if (!Array.from(selectedTagUuids).some((u) => postTagUuids.has(u))) return false;
      }
      return true;
    });
  }, [posts, selectedAccountUuids, selectedGroupIds, selectedTagUuids, groupAccountUuids]);

  const hasActiveFilters =
    selectedAccountUuids.size > 0 || selectedGroupIds.size > 0 || selectedTagUuids.size > 0;

  const counts = useMemo(() => {
    let queued = 0, published = 0, failed = 0;
    for (const p of filteredPosts) {
      if (p.status === 'scheduled') queued++;
      else if (p.status === 'published') published++;
      else if (p.status === 'failed') failed++;
    }
    return { queued, published, failed };
  }, [filteredPosts]);

  const postsByDate = useMemo(() => {
    const map = new Map<string, MixpostPost[]>();
    for (const post of filteredPosts) {
      const dateStr = post.published_at || post.scheduled_at;
      if (!dateStr) continue;
      const dayKey = dateStr.slice(0, 10);
      const existing = map.get(dayKey) || [];
      existing.push(post);
      map.set(dayKey, existing);
    }
    return map;
  }, [filteredPosts]);

  const goToPrev = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (calendarView === 'month') return new Date(d.getFullYear(), d.getMonth() - 1, 1);
      d.setDate(d.getDate() - (calendarView === 'week' ? 7 : 1));
      return d;
    });
  }, [calendarView]);

  const goToNext = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (calendarView === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1);
      d.setDate(d.getDate() + (calendarView === 'week' ? 7 : 1));
      return d;
    });
  }, [calendarView]);

  const goToToday = useCallback(() => setCurrentDate(new Date()), []);

  const navLabel = buildNavLabel(currentDate, calendarView);

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
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchPosts(getMonthsToFetch(currentDate, calendarView), statusFilter)}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Navigation + view switcher + status counts */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: prev/next + label */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={goToPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="min-w-[220px] text-center text-xl font-semibold text-foreground">
            {navLabel}
          </h2>
          <Button variant="outline" size="icon" onClick={goToNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Center: view switcher */}
        <div className="flex items-center rounded-md border border-border/50 bg-muted/30 p-0.5">
          {(['month', 'week', 'day'] as CalendarView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setCalendarView(v)}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                calendarView === v
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Right: status counts + timezone + today */}
        <div className="flex items-center gap-2">
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
          <div className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Select value={timezoneValue} onValueChange={setTimezoneValue}>
              <SelectTrigger size="sm" className="h-7 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" className="max-h-[300px]">
                {COMMON_TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value} className="text-xs">
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={goToToday}>
            Today
          </Button>
        </div>
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

      {/* Channel / group / tag filter bar */}
      <CalendarFilterBar
        accounts={accounts}
        selectedAccountUuids={selectedAccountUuids}
        onToggleAccount={toggleAccount}
        groups={groups}
        selectedGroupIds={selectedGroupIds}
        onToggleGroup={toggleGroup}
        postTags={postTags}
        selectedTagUuids={selectedTagUuids}
        onToggleTag={toggleTag}
        hasActiveFilters={hasActiveFilters}
        onClearAll={clearAllFilters}
      />

      {/* Calendar view */}
      {isLoading ? (
        calendarView === 'month' ? (
          <CalendarGridSkeleton />
        ) : calendarView === 'week' ? (
          <CalendarWeekSkeleton />
        ) : (
          <CalendarDaySkeleton />
        )
      ) : calendarView === 'month' ? (
        <CalendarGrid
          currentMonth={new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)}
          postsByDate={postsByDate}
          onPostClick={setSelectedPost}
          timezone={timezone}
        />
      ) : calendarView === 'week' ? (
        <CalendarWeekView
          weekStart={getWeekStart(currentDate)}
          postsByDate={postsByDate}
          onPostClick={setSelectedPost}
          timezone={timezone}
        />
      ) : (
        <CalendarDayView
          date={currentDate}
          posts={postsByDate.get(formatDateKey(currentDate)) || []}
          onPostClick={setSelectedPost}
          timezone={timezone}
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
          <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">
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

function CalendarWeekSkeleton() {
  return (
    <div className="grid grid-cols-7 gap-1">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="space-y-1">
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-[400px] rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function CalendarDaySkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-6 w-48 rounded" />
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-16 rounded-lg" />
      ))}
    </div>
  );
}
