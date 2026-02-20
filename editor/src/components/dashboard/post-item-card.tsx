'use client';

import { useState } from 'react';
import { ExternalLink, FileVideo, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { MixpostPost, MixpostPostAccount, MixpostMedia } from '@/types/calendar';

interface PostItemCardProps {
  post: MixpostPost;
  accountId: number;
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

export function PostItemCard({ post, accountId }: PostItemCardProps) {
  const [fetchedUrl, setFetchedUrl] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const status = getEffectiveStatus(post);
  const thumbnail = extractThumbnail(post);
  const caption = getCaption(post);
  const externalUrl = getExternalUrl(post, accountId) || fetchedUrl;
  const account = post.accounts.find((a) => a.id === accountId);
  const provider = account?.provider || 'unknown';

  const handleViewOnPlatform = async () => {
    if (externalUrl) {
      window.open(externalUrl, '_blank', 'noopener,noreferrer');
      return;
    }
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

  return (
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

      {/* External link */}
      <button
        onClick={handleViewOnPlatform}
        disabled={fetching}
        className="flex-shrink-0 flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80 disabled:opacity-50"
      >
        {fetching ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ExternalLink className="h-3.5 w-3.5" />
        )}
        View on {getProviderLabel(provider)}
      </button>
    </div>
  );
}
