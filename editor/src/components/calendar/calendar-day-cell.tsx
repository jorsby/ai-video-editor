'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { ProviderIcon } from '@/components/dashboard/provider-icon';
import { WorkflowRunPill } from './workflow-run-pill';
import type { MixpostPost, MixpostMedia } from '@/types/calendar';
import type { WorkflowRun } from '@/types/workflow-run';

interface CalendarDayCellProps {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  posts: MixpostPost[];
  workflowRuns?: WorkflowRun[];
  onPostClick: (post: MixpostPost) => void;
  onWorkflowRunClick?: (run: WorkflowRun) => void;
  timezone?: string;
}

export const STATUS_COLORS: Record<string, string> = {
  published: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  scheduled: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  draft: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
};

export function getEffectiveStatus(post: MixpostPost): string {
  if (post.status === 'published') return 'published';
  if (post.scheduled_at && post.status !== 'failed') return 'scheduled';
  return post.status;
}

function getPostCaption(post: MixpostPost): string {
  const original = post.versions.find((v) => v.is_original);
  if (!original || original.content.length === 0) return '(no content)';
  return original.content[0].body || '(no text)';
}

export function getPostThumbnail(post: MixpostPost): string | null {
  const original = post.versions.find((v) => v.is_original);
  if (!original) return null;
  for (const content of original.content) {
    if (content.media.length > 0) {
      const first = content.media[0];
      if (typeof first === 'object' && first !== null) {
        return (first as MixpostMedia).thumb_url || (first as MixpostMedia).url || null;
      }
    }
  }
  return null;
}

export function getPostTime(post: MixpostPost, timezone?: string): string | null {
  const dateStr = post.scheduled_at || post.published_at;
  if (!dateStr) return null;
  const date = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

const MAX_VISIBLE = 3;
const MAX_ICONS = 4;

export function PostPill({
  post,
  onPostClick,
  timezone,
}: {
  post: MixpostPost;
  onPostClick: (post: MixpostPost) => void;
  timezone?: string;
}) {
  const status = getEffectiveStatus(post);
  const colorClass = STATUS_COLORS[status] || STATUS_COLORS.draft;
  const caption = getPostCaption(post);
  const thumbnail = getPostThumbnail(post);
  const time = getPostTime(post, timezone);
  const { accounts } = post;

  return (
    <button
      type="button"
      onClick={() => onPostClick(post)}
      className={cn(
        'flex w-full cursor-pointer items-start gap-1.5 rounded border px-1.5 py-1 text-left transition-opacity hover:opacity-80',
        colorClass
      )}
      title={caption}
    >
      {thumbnail && (
        <img
          src={thumbnail}
          alt=""
          className="h-7 w-7 shrink-0 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] leading-tight">
          {caption.length > 30 ? caption.slice(0, 30) + '…' : caption}
        </p>
        <div className="mt-0.5 flex items-center gap-1">
          {time && (
            <span className="text-[9px] leading-none opacity-70">{time}</span>
          )}
          {accounts.length > 0 && (
            <div className="ml-auto flex items-center gap-0.5">
              {accounts.slice(0, MAX_ICONS).map((a) => (
                <ProviderIcon key={a.uuid} provider={a.provider} className="h-3 w-3" />
              ))}
              {accounts.length > MAX_ICONS && (
                <span className="text-[9px] leading-none opacity-70">
                  +{accounts.length - MAX_ICONS}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export function CalendarDayCell({
  date,
  isCurrentMonth,
  isToday,
  posts,
  workflowRuns = [],
  onPostClick,
  onWorkflowRunClick,
  timezone,
}: CalendarDayCellProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const visiblePosts = posts.slice(0, MAX_VISIBLE);
  const overflowCount = posts.length - MAX_VISIBLE;
  const totalCount = posts.length + workflowRuns.length;

  return (
    <div
      className={cn(
        'min-h-[100px] rounded-lg border p-1.5 transition-colors',
        isCurrentMonth
          ? 'bg-card border-border/50'
          : 'bg-card/30 border-border/20'
      )}
    >
      {/* Day number */}
      <div className="mb-1 flex items-center justify-between">
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
            !isCurrentMonth && 'text-muted-foreground/40',
            isCurrentMonth && 'text-foreground',
            isToday && 'bg-primary text-primary-foreground'
          )}
        >
          {date.getDate()}
        </span>
        {totalCount > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {totalCount}
          </span>
        )}
      </div>

      {/* Post indicators */}
      <div className="space-y-0.5">
        {/* Workflow run pills first */}
        {workflowRuns.map((run) => (
          <WorkflowRunPill
            key={run.id}
            run={run}
            onClick={onWorkflowRunClick ?? (() => {})}
          />
        ))}
        {/* Solo post pills */}
        {visiblePosts.map((post) => (
          <PostPill key={post.uuid} post={post} onPostClick={onPostClick} timezone={timezone} />
        ))}
        {overflowCount > 0 && (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="w-full cursor-pointer pl-1.5 text-left text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                +{overflowCount} more
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="max-h-[300px] w-64 overflow-y-auto p-2"
            >
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                All posts &middot; {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
              <div className="space-y-1">
                {posts.map((post) => (
                  <PostPill
                    key={post.uuid}
                    post={post}
                    timezone={timezone}
                    onPostClick={(p) => {
                      setPopoverOpen(false);
                      onPostClick(p);
                    }}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
