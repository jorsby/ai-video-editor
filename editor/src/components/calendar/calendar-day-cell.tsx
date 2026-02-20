'use client';

import { useState } from 'react';
import { Image, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import type { MixpostPost } from '@/types/calendar';

interface CalendarDayCellProps {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  posts: MixpostPost[];
  onPostClick: (post: MixpostPost) => void;
}

const STATUS_COLORS: Record<string, string> = {
  published: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  scheduled: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  draft: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
};

function getEffectiveStatus(post: MixpostPost): string {
  if (post.status === 'published') return 'published';
  if (post.scheduled_at && post.status !== 'failed') return 'scheduled';
  return post.status;
}

function getPostCaption(post: MixpostPost): string {
  const original = post.versions.find((v) => v.is_original);
  if (!original || original.content.length === 0) return '(no content)';
  return original.content[0].body || '(no text)';
}

function hasMedia(post: MixpostPost): 'video' | 'image' | null {
  const original = post.versions.find((v) => v.is_original);
  if (!original) return null;
  for (const content of original.content) {
    if (content.media.length > 0) {
      // If media is an array of objects, check the type
      const first = content.media[0];
      if (typeof first === 'object' && first !== null && 'is_video' in first) {
        return first.is_video ? 'video' : 'image';
      }
      // If just IDs, we can't tell — show generic image icon
      return 'image';
    }
  }
  return null;
}

const MAX_VISIBLE = 3;

function PostPill({
  post,
  onPostClick,
}: {
  post: MixpostPost;
  onPostClick: (post: MixpostPost) => void;
}) {
  const status = getEffectiveStatus(post);
  const colorClass = STATUS_COLORS[status] || STATUS_COLORS.draft;
  const caption = getPostCaption(post);
  const mediaType = hasMedia(post);

  return (
    <button
      key={post.uuid}
      type="button"
      onClick={() => onPostClick(post)}
      className={cn(
        'flex w-full cursor-pointer items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left text-[10px] leading-tight transition-opacity hover:opacity-80',
        colorClass
      )}
      title={caption}
    >
      {mediaType === 'video' && <Video className="h-2.5 w-2.5 shrink-0" />}
      {mediaType === 'image' && <Image className="h-2.5 w-2.5 shrink-0" />}
      <span className="truncate">
        {caption.length > 30 ? caption.slice(0, 30) + '...' : caption}
      </span>
    </button>
  );
}

export function CalendarDayCell({
  date,
  isCurrentMonth,
  isToday,
  posts,
  onPostClick,
}: CalendarDayCellProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const visiblePosts = posts.slice(0, MAX_VISIBLE);
  const overflowCount = posts.length - MAX_VISIBLE;

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
        {posts.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {posts.length}
          </span>
        )}
      </div>

      {/* Post indicators */}
      <div className="space-y-0.5">
        {visiblePosts.map((post) => (
          <PostPill key={post.uuid} post={post} onPostClick={onPostClick} />
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
