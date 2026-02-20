'use client';

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import type { MixpostAccount } from '@/types/mixpost';

interface SocialAccountsListProps {
  accounts: MixpostAccount[];
  isLoading: boolean;
  error: string | null;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function SocialAccountsList({
  accounts,
  isLoading,
  error,
}: SocialAccountsListProps) {
  if (isLoading) {
    return (
      <div className="w-full max-w-3xl mx-auto">
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[72px] bg-muted/50 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center space-y-2">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="text-center space-y-2">
        <p className="text-muted-foreground">No connected accounts</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <h2 className="text-lg font-semibold text-foreground">
        Connected Accounts
      </h2>

      <div className="grid gap-3">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="flex items-center gap-3 rounded-lg border bg-card p-4"
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

            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
              {account.provider}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
