'use client';

import { useState } from 'react';
import { ExternalLink, FileVideo, Loader2, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EditPostDialog } from './edit-post-dialog';
import type { MixpostPost, MixpostPostAccount, MixpostMedia } from '@/types/calendar';

interface PostItemCardProps {
  post: MixpostPost;
  accountId: number;
  onDeleted?: (postUuid: string) => void;
  onUpdated?: (postUuid: string, fields: Record<string, string>) => void;
}

const EDITABLE_PROVIDERS = new Set(['youtube', 'facebook_page', 'facebook']);
const DELETABLE_PROVIDERS = new Set(['youtube', 'facebook_page', 'facebook']);

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
  const raw = post.status;
  if (raw === 'published' || raw === '3') return 'published';
  if (raw === 'failed' || raw === '4') return 'failed';
  if (raw === 'scheduled' || raw === '1') return 'scheduled';
  if (raw === 'draft' || raw === '0') return 'draft';
  if (raw === 'publishing' || raw === '2') return 'publishing';
  return raw;
}

function getExternalUrl(post: MixpostPost, accountId: number): string | null {
  const account = post.accounts.find((a) => a.id === accountId);
  if (!account) return null;
  if (account.external_url) return account.external_url;
  if (account.pivot?.provider_post_data?.url)
    return account.pivot.provider_post_data.url;
  if (account.pivot?.provider_post_data?.external_url)
    return account.pivot.provider_post_data.external_url;
  return null;
}

function getProviderLabel(provider: string): string {
  const labels: Record<string, string> = {
    tiktok: 'TikTok',
    instagram: 'Instagram',
    facebook: 'Facebook',
    facebook_page: 'Facebook',
    youtube: 'YouTube',
  };
  return labels[provider] || provider;
}

function extractThumbnail(post: MixpostPost): string | null {
  const original = post.versions.find((v) => v.is_original);
  if (!original) return null;
  for (const content of original.content) {
    for (const item of content.media) {
      if (typeof item === 'object' && item !== null && 'thumb_url' in item) {
        return (item as MixpostMedia).thumb_url || (item as MixpostMedia).url;
      }
    }
  }
  return null;
}

function getCaption(post: MixpostPost): string {
  const original = post.versions.find((v) => v.is_original);
  return original?.content[0]?.body || '(no content)';
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '--';
  const date = new Date(dateStr.replace(' ', 'T'));
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function PostItemCard({ post, accountId, onDeleted, onUpdated }: PostItemCardProps) {
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

  const status = getEffectiveStatus(post);
  const thumbnail = extractThumbnail(post);
  const caption = getCaption(post);
  const externalUrl = getExternalUrl(post, accountId) || fetchedUrl;
  const account = post.accounts.find((a) => a.id === accountId);
  const provider = account?.provider || 'unknown';
  const isPlatformPost = post._source === 'platform' || /^(ig|tt|yt|fb)-/.test(post.uuid);
  const canEdit = EDITABLE_PROVIDERS.has(provider);
  const canDelete = DELETABLE_PROVIDERS.has(provider) && onDeleted;

  const handleViewOnPlatform = async () => {
    if (externalUrl) {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    // Platform posts should already have a permalink; don't fetch from Mixpost
    if (isPlatformPost) return;
    // Lazy-fetch the detail endpoint for external URL
    setFetching(true);
    try {
      const res = await fetch(`/api/mixpost/posts/${post.uuid}`);
      if (!res.ok) return;
      const { post: detail } = await res.json();
      const detailAccount = detail.accounts?.find(
        (a: MixpostPostAccount) => a.id === accountId
      );
      const url =
        detailAccount?.pivot?.provider_post_data?.url ||
        detailAccount?.pivot?.provider_post_data?.external_url ||
        detailAccount?.external_url ||
        null;
      if (url) {
        setFetchedUrl(url);
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      console.error('Failed to fetch post detail:', err);
    } finally {
      setFetching(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      // Build the platform delete request body
      const body: Record<string, unknown> = { accountId };
      if (isPlatformPost) {
        // Synced posts: extract platform post ID from UUID prefix
        body.platformPostId = post.uuid.replace(/^(ig|tt|yt|fb)-/, '');
      } else {
        // Mixpost posts: let the backend resolve the platform post ID
        body.mixpostUuid = post.uuid;
      }

      // 1. Delete from platform (YouTube/Facebook)
      const res = await fetch('/api/social/posts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setDeleteError(data?.error || 'Failed to delete from platform');
        return;
      }

      // 2. Also delete from Mixpost DB if it's a Mixpost post
      if (!isPlatformPost) {
        await fetch(`/api/mixpost/posts/${post.uuid}`, { method: 'DELETE' });
      }

      onDeleted?.(post.uuid);
      setShowDeleteDialog(false);
    } catch (err) {
      console.error('Failed to delete post:', err);
      setDeleteError('Network error — please try again');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
        {/* Thumbnail */}
        <div className="flex-shrink-0 w-16 h-16 rounded-md bg-muted overflow-hidden flex items-center justify-center">
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnail}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <FileVideo className="w-6 h-6 text-muted-foreground" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm text-foreground line-clamp-2">{caption}</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {formatDateTime(post.published_at || post.scheduled_at)}
            </span>
            <Badge variant={STATUS_VARIANT[status] || 'outline'} className="text-[10px] px-1.5 py-0">
              {status}
            </Badge>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleViewOnPlatform}
            disabled={fetching}
            className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80 disabled:opacity-50"
          >
            {fetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" />
            )}
            View on {getProviderLabel(provider)}
          </button>

          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setShowEditDialog(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}

          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      <EditPostDialog
        post={post}
        accountId={accountId}
        provider={provider}
        isPlatformPost={isPlatformPost}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onUpdated={onUpdated}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => { setShowDeleteDialog(open); if (!open) setDeleteError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Post</DialogTitle>
            <DialogDescription>
              This will permanently delete the post from {getProviderLabel(provider)}. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
