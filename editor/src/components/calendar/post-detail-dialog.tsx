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
import type { MixpostPost, MixpostMedia } from '@/types/calendar';

interface PostDetailDialogProps {
  post: MixpostPost | null;
  onClose: () => void;
  onDeleted?: (uuid: string) => void;
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

function getEffectiveStatus(post: MixpostPost): string {
  if (post.status === 'published') return 'published';
  if (post.scheduled_at && post.status !== 'failed') return 'scheduled';
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

function extractMedia(post: MixpostPost): MixpostMedia[] {
  const media: MixpostMedia[] = [];
  for (const version of post.versions) {
    if (!version.is_original) continue;
    for (const content of version.content) {
      for (const item of content.media) {
        if (typeof item === 'object' && item !== null && 'url' in item) {
          media.push(item as MixpostMedia);
        }
      }
    }
  }
  return media;
}

export function PostDetailDialog({
  post,
  onClose,
  onDeleted,
  onUpdated,
}: PostDetailDialogProps) {
  const [fullPost, setFullPost] = useState<MixpostPost | null>(null);
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

    // Check if the list-level post already has expanded media
    const existingMedia = extractMedia(post);
    if (existingMedia.length > 0) {
      setFullPost(post);
      return;
    }

    // Check if the post has media IDs that need fetching
    const original = post.versions.find((v) => v.is_original);
    const hasMediaIds = original?.content.some((c) => c.media.length > 0);
    if (!hasMediaIds) {
      setFullPost(null);
      return;
    }

    // Fetch full post to get expanded media objects
    setMediaLoading(true);
    fetch(`/api/mixpost/posts/${post.uuid}`)
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
  }, [post]);

  const handleDelete = async () => {
    if (!post) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/mixpost/posts/${post.uuid}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setDeleteError(data?.error || 'Failed to delete post. Please try again.');
        setConfirmDelete(false);
        return;
      }
      onDeleted?.(post.uuid);
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
  const original = post.versions.find((v) => v.is_original);
  const caption = original?.content[0]?.body || '(no content)';

  // Use full post media if available, otherwise empty
  const media = fullPost ? extractMedia(fullPost) : [];

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
                : post.published_at
                  ? `Published: ${formatDateTime(post.published_at)}`
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
                  {media.map((item) =>
                    item.is_video ? (
                      <video
                        key={item.uuid}
                        controls
                        preload="metadata"
                        poster={item.thumb_url || undefined}
                        className="w-full max-h-[400px] rounded-lg border border-border/50 bg-black object-contain"
                      >
                        <source src={item.url} type={item.mime_type} />
                      </video>
                    ) : (
                      <a
                        key={item.uuid}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block overflow-hidden rounded-lg border border-border/50 transition-opacity hover:opacity-90"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.thumb_url || item.url}
                          alt={item.name}
                          className="w-full max-h-[400px] object-contain"
                        />
                      </a>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Accounts */}
            {post.accounts.length > 0 && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                  Accounts
                </h4>
                <div className="flex flex-col gap-1.5">
                  {post.accounts.map((account) => {
                    const accountErrors: string[] = account.errors?.length
                      ? account.errors
                      : Array.isArray(account.pivot?.errors)
                        ? account.pivot.errors
                        : typeof account.pivot?.errors === 'string' && account.pivot.errors
                          ? [account.pivot.errors]
                          : [];
                    const hasFailed = accountErrors.length > 0;
                    return (
                      <div key={account.uuid} className="space-y-1">
                        <div
                          className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
                            hasFailed ? 'bg-red-500/10' : status === 'published' ? 'bg-emerald-500/10' : 'bg-muted'
                          }`}
                        >
                          <span
                            className={`text-xs font-medium ${hasFailed ? 'text-red-400' : status === 'published' ? 'text-emerald-400' : ''}`}
                          >
                            {account.name}
                          </span>
                          <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {account.provider}
                          </span>
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-[10px]">
                              {hasFailed ? '✗ failed' : status === 'published' ? '✓ published' : ''}
                            </span>
                            {(() => {
                              const url =
                                account.external_url ||
                                account.pivot?.provider_post_data?.url ||
                                account.pivot?.provider_post_data?.external_url ||
                                null;
                              return url ? (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-blue-400 hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  View post →
                                </a>
                              ) : null;
                            })()}
                          </div>
                        </div>
                        {hasFailed && accountErrors.map((err, i) => (
                          <p key={i} className="px-2 text-[11px] text-red-400/80">{err}</p>
                        ))}
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
                      key={tag.uuid}
                      className="rounded-full border px-2 py-0.5 text-xs"
                      style={{
                        backgroundColor: `${tag.hex_color}20`,
                        borderColor: `${tag.hex_color}40`,
                        color: tag.hex_color,
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="space-y-1 border-t border-border/50 pt-2 text-xs text-muted-foreground">
              <p>Created by: {post.user.name}</p>
              {post.scheduled_at && (
                <p>Scheduled: {formatDateTime(post.scheduled_at)}</p>
              )}
              {post.published_at && (
                <p>Published: {formatDateTime(post.published_at)}</p>
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
                      onClick={() => window.open(`/post/edit/${post.uuid}`, '_blank')}
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
