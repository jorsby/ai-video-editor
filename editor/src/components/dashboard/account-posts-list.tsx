'use client';

import { ArrowLeft, FileVideo } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { PostItemCard } from './post-item-card';
import type { MixpostAccount } from '@/types/mixpost';
import type { MixpostPost } from '@/types/calendar';

interface AccountPostsListProps {
  account: MixpostAccount;
  posts: MixpostPost[];
  onBack: () => void;
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
    youtube: 'YouTube',
  };
  return labels[provider] || provider;
}

export function AccountPostsList({
  account,
  posts,
  onBack,
}: AccountPostsListProps) {
  // Sort posts by published date, most recent first
  const sortedPosts = [...posts].sort((a, b) => {
    const dateA = a.published_at || a.scheduled_at || a.created_at;
    const dateB = b.published_at || b.scheduled_at || b.created_at;
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
          {account.image ? (
            <AvatarImage src={account.image} alt={account.name} />
          ) : null}
          <AvatarFallback>{getInitials(account.name)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-semibold text-foreground truncate">
            {account.name}
          </p>
          <p className="text-xs text-muted-foreground">
            @{account.username}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
          {getProviderLabel(account.provider)}
        </span>
      </div>

      {/* Posts list */}
      {sortedPosts.length === 0 ? (
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
              key={post.uuid}
              post={post}
              accountId={account.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
