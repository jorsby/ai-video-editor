'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { SocialPost } from '@/types/social';

interface PostDetailDialogProps {
  post: SocialPost | null;
  onClose: () => void;
  onDeleted?: (id: string) => void;
  onUpdated?: () => void;
}

const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  published: 'default',
  scheduled: 'secondary',
  draft: 'outline',
  failed: 'destructive',
};

function getEffectiveStatus(post: SocialPost): string {
  return post.status;
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '--';
  const date = new Date(dateStr.replace(' ', 'T'));
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface MediaItem {
  url: string;
  type: 'image' | 'video';
}

function extractMedia(post: SocialPost): MediaItem[] {
  if (!post.media_url) return [];
  return [{
    url: post.media_url,
    type: post.media_type === 'video' ? 'video' : 'image',
  }];
}

export function PostDetailDialog({
  post,
  onClose,
  onDeleted,
  onUpdated,
}: PostDetailDialogProps) {
  const [fullPost, setFullPost] = useState<SocialPost | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!post) {
      setFullPost(null);
      return;
    }

    // Reset action state when post changes
    setConfirmDelete(false);
    setDeleteError(null);

    // Check if the post already has media
    const existingMedia = extractMedia(post);
    if (existingMedia.length > 0) {
      setFullPost(post);
      return;
    }

    // Fetch full post to get expanded media
    if (post.media_url) {
      setMediaLoading(true);
      fetch(`/api/v2/posts/${post.id}`)
        .then((res) => {
          if (!res.ok) throw new Error('Failed to fetch post');
          return res.json();
        })
        .then((data) => {
          setFullPost(data.post || null);
        })
        .catch((err) => {
          console.error('Failed to fetch full post:', err);
          setFullPost(null);
        })
        .finally(() => {
          setMediaLoading(false);
        });
    } else {
      setFullPost(null);
    }
  }, [post]);

  const handleDelete = async () => {
    if (!post) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/v2/posts/${post.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setDeleteError(data?.error || 'Failed to delete post. Please try again.');
        setConfirmDelete(false);
        return;
      }
      onDeleted?.(post.id);
      onClose();
    } catch {
      setDeleteError('Network error — please try again.');
      setConfirmDelete(false);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!post) return null;

  const status = getEffectiveStatus(post);
  const isScheduled = status === 'scheduled';
  const caption = post.caption || '(no content)';

  // Use full post media if available, otherwise extract from post
  const media = fullPost ? extractMedia(fullPost) : extractMedia(post);

  return (
    <>
      <Dialog
        open={!!post}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDelete(false);
            setDeleteError(null);
            onClose();
          }
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>Post Details</DialogTitle>
              <Badge variant={STATUS_VARIANT[status] || 'outline'}>
                {status}
              </Badge>
            </div>
            <DialogDescription>
              {post.scheduled_at
                ? `Scheduled: ${formatDateTime(post.scheduled_at)}`
                : `Created: ${formatDateTime(post.created_at)}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Caption */}
            <div>
              <h4 className="mb-1 text-sm font-medium text-muted-foreground">
                Content
              </h4>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {caption}
              </p>
            </div>

            {/* Media */}
            {mediaLoading && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                  Media
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="aspect-video rounded-lg" />
                </div>
              </div>
            )}
            {!mediaLoading && media.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                  Media ({media.length})
                </h4>
                <div
                  className={
                    media.length === 1
                      ? 'flex flex-col gap-2'
                      : 'grid grid-cols-2 gap-2'
                  }
                >
                  {media.map((item, idx) =>
                    item.type === 'video' ? (
                      <video
                        key={idx}
                        controls
                        preload="metadata"
                        className="w-full max-h-[400px] rounded-lg border border-border/50 bg-black object-contain"
                      >
                        <source src={item.url} />
                      </video>
                    ) : (
                      <a
                        key={idx}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block overflow-hidden rounded-lg border border-border/50 transition-opacity hover:opacity-90"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.url}
                          alt="Post media"
                          className="w-full max-h-[400px] object-contain"
                        />
                      </a>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Accounts */}
            {(post.accounts || []).length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                  Accounts
                </h4>
                <div className="flex flex-col gap-1.5">
                  {(post.accounts || []).map((account) => {
                    const hasFailed = !!account.error_message;
                    return (
                      <div key={account.id} className="space-y-1">
                        <div
                          className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
                            hasFailed ? 'bg-red-500/10' : account.status === 'published' ? 'bg-emerald-500/10' : 'bg-muted'
                          }`}
                        >
                          <span
                            className={`text-xs font-medium ${hasFailed ? 'text-red-400' : account.status === 'published' ? 'text-emerald-400' : ''}`}
                          >
                            {account.account_name || account.octupost_account_id}
                          </span>
                          <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {account.platform}
                          </span>
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-[10px]">
                              {hasFailed ? '✗ failed' : account.status === 'published' ? '✓ published' : ''}
                            </span>
                          </div>
                        </div>
                        {hasFailed && (
                          <p className="px-2 text-[11px] text-red-400/80">{account.error_message}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tags */}
            {post.tags.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                  Tags
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {post.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-border/50 bg-muted px-2 py-0.5 text-xs text-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="space-y-1 border-t border-border/50 pt-2 text-xs text-muted-foreground">
              {post.scheduled_at && (
                <p>Scheduled: {formatDateTime(post.scheduled_at)}</p>
              )}
              {(post.accounts || []).some(a => a.published_at) && (
                <p>Published: {formatDateTime((post.accounts || []).find(a => a.published_at)?.published_at ?? null)}</p>
              )}
              <p>Created: {formatDateTime(post.created_at)}</p>
            </div>

            {/* Actions footer — scheduled posts only */}
            {isScheduled && (
              <div className="border-t border-border/50 pt-3">
                {!confirmDelete ? (
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(`/post/edit/${post.id}`, '_blank')}
                    >
                      Edit Post
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmDelete(true)}
                    >
                      Remove Post
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Permanently remove this post?
                    </p>
                    {deleteError && (
                      <p className="text-sm text-destructive">{deleteError}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setConfirmDelete(false);
                          setDeleteError(null);
                        }}
                        disabled={isDeleting}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDelete}
                        disabled={isDeleting}
                      >
                        {isDeleting ? 'Removing...' : 'Confirm'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}
