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
import { CompanionSetupDialog } from '@/components/companion/companion-setup-dialog';
import { openAccountInBrowser } from '@/lib/companion/client';
import type { SocialPost, SocialPostAccount } from '@/types/social';

interface PostItemCardProps {
  post: SocialPost;
  accountId: string;
  onDeleted?: (postId: string) => void;
  onUpdated?: (postId: string, fields: Record<string, string>) => void;
}

const EDITABLE_PROVIDERS = new Set(['youtube', 'facebook_page', 'facebook']);
const DELETABLE_PROVIDERS = new Set(['youtube', 'facebook_page', 'facebook']);
const BROWSER_MANAGED_PROVIDERS = new Set(['instagram', 'tiktok']);

const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  published: 'default',
  scheduled: 'secondary',
  draft: 'outline',
  failed: 'destructive',
  publishing: 'secondary',
  partial: 'destructive',
};

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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showCompanionDialog, setShowCompanionDialog] = useState(false);
  const [openingBrowser, setOpeningBrowser] = useState(false);

  const status = post.status;
  const thumbnail = post.media_url && post.media_type === 'image' ? post.media_url : null;
  const caption = post.caption || '(no content)';
  const account = (post.accounts || []).find((a: SocialPostAccount) => a.octupost_account_id === accountId);
  const provider = account?.platform || 'unknown';
  const canEdit = EDITABLE_PROVIDERS.has(provider);
  const canDelete = DELETABLE_PROVIDERS.has(provider) && onDeleted;
  const isBrowserManaged = BROWSER_MANAGED_PROVIDERS.has(provider);

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/v2/posts/${post.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setDeleteError(data?.error || 'Failed to delete post');
        return;
      }

      onDeleted?.(post.id);
      setShowDeleteDialog(false);
    } catch (err) {
      console.error('Failed to delete post:', err);
      setDeleteError('Network error — please try again');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenInBrowser = async () => {
    const acctId = account?.octupost_account_id;
    if (!acctId) return;
    setOpeningBrowser(true);
    const result = await openAccountInBrowser(provider, acctId, undefined);
    setOpeningBrowser(false);
    if (result.notRunning) setShowCompanionDialog(true);
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
              {formatDateTime(post.scheduled_at)}
            </span>
            <Badge variant={STATUS_VARIANT[status] || 'outline'} className="text-[10px] px-1.5 py-0">
              {status}
            </Badge>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isBrowserManaged ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenInBrowser}
              disabled={openingBrowser}
            >
              {openingBrowser ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              Open in Browser
            </Button>
          ) : (
            account?.platform_post_id && (
              <span className="text-xs text-muted-foreground">
                Published
              </span>
            )
          )}

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

      {/* Companion setup dialog (shown when companion service is not running) */}
      <CompanionSetupDialog
        open={showCompanionDialog}
        onOpenChange={setShowCompanionDialog}
        onCompanionReady={handleOpenInBrowser}
      />

      {/* Edit dialog */}
      <EditPostDialog
        post={post}
        accountId={accountId}
        provider={provider}
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
