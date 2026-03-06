'use client';

import { AlertCircle, ArrowLeft, FileVideo, Loader2, RefreshCw } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { PostItemCard } from './post-item-card';
import { ProviderIcon } from './provider-icon';
import type { OctupostAccount } from '@/lib/octupost/types';
import type { SocialPost } from '@/types/social';

interface AccountPostsListProps {
  account: OctupostAccount;
  posts: SocialPost[];
  onBack: () => void;
  onPostDeleted?: (postId: string) => void;
  onPostUpdated?: (postId: string, fields: Record<string, string>) => void;
  isLoadingPlatformMedia?: boolean;
  platformMediaError?: string | null;
  onSyncFromPlatform?: (accountId: string) => void;
  lastSyncedAt?: Date | null;
  isTokenInvalid?: boolean;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
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

function getRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function AccountPostsList({
  account,
  posts,
  onBack,
  onPostDeleted,
  onPostUpdated,
  isLoadingPlatformMedia,
  platformMediaError,
  onSyncFromPlatform,
  lastSyncedAt,
  isTokenInvalid,
}: AccountPostsListProps) {
  // Sort posts by published date, most recent first
  const sortedPosts = [...posts].sort((a, b) => {
    const dateA = a.scheduled_at || a.created_at;
    const dateB = b.scheduled_at || b.created_at;
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="h-4 w-4 mr-1" />
        All Accounts
      </Button>

      {/* Account header */}
      <div className="flex items-center gap-3">
        <Avatar>
          {account.profile_image_url && (
            <AvatarImage src={account.profile_image_url} alt={account.account_name} />
          )}
          <AvatarFallback>{getInitials(account.account_name)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-semibold text-foreground truncate">
            {account.account_name}
          </p>
          <p className="text-xs text-muted-foreground">
            {account.account_username ? `@${account.account_username}` : account.platform}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onSyncFromPlatform && (
            <div className="flex flex-col items-end gap-0.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSyncFromPlatform(account.account_id)}
                disabled={isLoadingPlatformMedia}
              >
                {isLoadingPlatformMedia ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Sync from {getProviderLabel(account.platform)}
              </Button>
              {lastSyncedAt && !isLoadingPlatformMedia && (
                <span className="text-[10px] text-muted-foreground">
                  Synced {getRelativeTime(lastSyncedAt)}
                </span>
              )}
            </div>
          )}
          <ProviderIcon provider={account.platform} className="h-5 w-5 text-muted-foreground" />
        </div>
      </div>

      {/* Proactive re-auth warning (token invalid but no sync error yet) */}
      {isTokenInvalid && !platformMediaError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700">
            This account&apos;s token has expired and needs to be re-authorized.
          </p>
        </div>
      )}

      {/* Platform media error */}
      {platformMediaError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
          <div className="text-sm text-destructive">
            <p>{platformMediaError}</p>
            {(platformMediaError.toLowerCase().includes('token') ||
              platformMediaError.includes('401') ||
              platformMediaError.includes('403')) && (
              <p className="mt-1">
                <span className="font-medium">Please re-authorize this account.</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Posts list */}
      {sortedPosts.length === 0 && !isLoadingPlatformMedia ? (
        <div className="text-center space-y-4 py-12">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted">
            <FileVideo className="w-7 h-7 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              No published posts
            </p>
            <p className="text-xs text-muted-foreground">
              Posts published to this account will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {sortedPosts.map((post) => (
            <PostItemCard
              key={post.id}
              post={post}
              accountId={account.account_id}
              onDeleted={onPostDeleted}
              onUpdated={onPostUpdated}
            />
          ))}
        </div>
      )}

      {isLoadingPlatformMedia && (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading posts from platform...</p>
        </div>
      )}
    </div>
  );
}
