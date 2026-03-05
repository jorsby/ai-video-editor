'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { ProviderIcon } from '@/components/dashboard/provider-icon';
import {
  STATUS_COLORS,
  getEffectiveStatus,
  getPostThumbnail,
  getPostTime,
} from './calendar-day-cell';
import type { SocialPost, SocialPostAccount } from '@/types/social';

interface CalendarDayViewProps {
  date: Date;
  posts: SocialPost[];
  onPostClick: (post: SocialPost) => void;
  timezone?: string;
}

const MAX_ICONS = 6;

function getPostCaption(post: SocialPost): string {
  return post.caption || '(no content)';
}

function getPostSortKey(post: SocialPost): number {
  const dateStr = post.scheduled_at || post.created_at;
  if (!dateStr) return Infinity;
  return new Date(dateStr.replace(' ', 'T')).getTime();
}

const DayPostCard = React.memo(function DayPostCard({
  post,
  onPostClick,
  timezone,
}: {
  post: SocialPost;
  onPostClick: (post: SocialPost) => void;
  timezone?: string;
}) {
  const status = getEffectiveStatus(post);
  const colorClass = STATUS_COLORS[status] || STATUS_COLORS.draft;
  const caption = getPostCaption(post);
  const thumbnail = getPostThumbnail(post);
  const time = getPostTime(post, timezone);
  const accounts = post.accounts || [];

  const statusLabel: Record<string, string> = {
    published: 'Published',
    scheduled: 'Scheduled',
    draft: 'Draft',
    failed: 'Failed',
  };

  return (
    <button
      type="button"
      onClick={() => onPostClick(post)}
      className={cn(
        'flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-opacity hover:opacity-80',
        colorClass
      )}
      title={caption}
    >
      {thumbnail && (
        <img
          src={thumbnail}
          alt=""
          className="h-12 w-12 shrink-0 rounded-md object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-snug">
          {caption.length > 120 ? caption.slice(0, 120) + '...' : caption}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {time && (
            <span className="text-[11px] font-medium opacity-80">{time}</span>
          )}
          <span className="text-[10px] opacity-60">{statusLabel[status] ?? status}</span>
          {accounts.length > 0 && (
            <div className="ml-auto flex items-center gap-1">
              {accounts.slice(0, MAX_ICONS).map((a: SocialPostAccount) => (
                <ProviderIcon key={a.octupost_account_id} provider={a.platform} className="h-4 w-4" />
              ))}
              {accounts.length > MAX_ICONS && (
                <span className="text-[10px] opacity-70">+{accounts.length - MAX_ICONS}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
});

export const CalendarDayView = React.memo(function CalendarDayView({
  date,
  posts,
  onPostClick,
  timezone,
}: CalendarDayViewProps) {
  const dayLabel = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const sorted = [...posts].sort((a, b) => getPostSortKey(a) - getPostSortKey(b));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">{dayLabel}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {posts.length} {posts.length === 1 ? 'post' : 'posts'}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-border/50 bg-card">
          <p className="text-sm text-muted-foreground">No posts for this day</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((post) => (
            <DayPostCard key={post.id} post={post} onPostClick={onPostClick} timezone={timezone} />
          ))}
        </div>
      )}
    </div>
  );
});
