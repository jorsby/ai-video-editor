'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { PostPill } from './calendar-day-cell';
import type { SocialPost } from '@/types/social';

interface CalendarWeekViewProps {
  weekStart: Date; // Always a Sunday
  postsByDate: Map<string, SocialPost[]>;
  onPostClick: (post: SocialPost) => void;
  timezone?: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY_POSTS: SocialPost[] = [];

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const CalendarWeekView = React.memo(function CalendarWeekView({
  weekStart,
  postsByDate,
  onPostClick,
  timezone,
}: CalendarWeekViewProps) {
  const todayKey = formatDateKey(new Date());

  // Build the 7 days starting from weekStart (Sunday)
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);
    const dateKey = formatDateKey(date);
    return { date, dateKey, isToday: dateKey === todayKey };
  });

  return (
    <div className="grid grid-cols-7 gap-1">
      {days.map(({ date, dateKey, isToday }, i) => {
        const posts = postsByDate.get(dateKey) ?? EMPTY_POSTS;
        return (
          <div key={dateKey} className="flex flex-col">
            {/* Column header */}
            <div
              className={cn(
                'mb-1 flex flex-col items-center justify-center rounded-lg py-2 text-center',
                isToday ? 'bg-primary/10' : ''
              )}
            >
              <span className="text-[11px] font-medium text-muted-foreground">
                {WEEKDAYS[i]}
              </span>
              <span
                className={cn(
                  'mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
                  isToday
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground'
                )}
              >
                {date.getDate()}
              </span>
            </div>

            {/* Posts column */}
            <div
              className={cn(
                'min-h-[400px] flex-1 rounded-lg border p-1.5',
                isToday ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-card'
              )}
            >
              {posts.length === 0 ? (
                <div className="flex h-full min-h-[60px] items-center justify-center">
                  <span className="text-[10px] text-muted-foreground/40">—</span>
                </div>
              ) : (
                <div
                  className="space-y-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40"
                  style={{ maxHeight: '560px' }}
                >
                  {posts.map((post) => (
                    <PostPill key={post.id} post={post} onPostClick={onPostClick} timezone={timezone} />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});
