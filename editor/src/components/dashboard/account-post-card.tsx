'use client';

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import type { MixpostAccount } from '@/types/mixpost';

interface AccountPostCardProps {
  account: MixpostAccount;
  postCount: number;
  onClick: () => void;
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

export function AccountPostCard({
  account,
  postCount,
  onClick,
}: AccountPostCardProps) {
  return (
    <div
      className="group flex items-center gap-3 rounded-lg border bg-card p-4 cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
      onClick={onClick}
    >
      <Avatar>
        {account.image ? (
          <AvatarImage src={account.image} alt={account.name} />
        ) : null}
        <AvatarFallback>{getInitials(account.name)}</AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {account.name}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          @{account.username}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-lg font-semibold text-foreground">{postCount}</p>
          <p className="text-[10px] text-muted-foreground">
            {postCount === 1 ? 'post' : 'posts'}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
          {getProviderLabel(account.provider)}
        </span>
      </div>
    </div>
  );
}
