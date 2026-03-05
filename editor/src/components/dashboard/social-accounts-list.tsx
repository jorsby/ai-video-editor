'use client';

import { useState, useEffect, useMemo } from 'react';
import { AlertCircle, ChevronsDownUp, ChevronsUpDown, ExternalLink, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AccountGroupSection } from './account-group-section';
import { AccountPostsList } from './account-posts-list';
import { CreateGroupModal } from './create-group-modal';
import { TagInput } from './tag-input';
import { TagFilter } from './tag-filter';
import { PlatformFilter } from './platform-filter';
import { ProviderIcon } from './provider-icon';
import { CompanionSetupDialog } from '@/components/companion/companion-setup-dialog';
import { openAccountInBrowser } from '@/lib/companion/client';
import type { OctupostAccount } from '@/lib/octupost/types';
import type { SocialPost, AccountGroupWithMembers, AccountTagMap } from '@/types/social';

interface SocialAccountsListProps {
  accounts: OctupostAccount[];
  isLoading: boolean;
  error: string | null;
  groups: AccountGroupWithMembers[];
  groupsLoading: boolean;
  onGroupCreated: (group: AccountGroupWithMembers) => void;
  onGroupRenamed: (id: string, name: string) => void;
  onGroupDeleted: (id: string) => void;
  onMemberAdded: (groupId: string, accountUuid: string) => void;
  onMemberRemoved: (groupId: string, accountUuid: string) => void;
  tags: AccountTagMap;
  onTagAdded: (accountUuid: string, tag: string) => void;
  onTagRemoved: (accountUuid: string, tag: string) => void;
  postsByAccount: Map<string, SocialPost[]>;
  postsLoading: boolean;
  onPostDeleted?: (postId: string) => void;
  onPostUpdated?: (postId: string, fields: Record<string, string>) => void;
  onFetchPlatformMedia?: (accountId: string, force?: boolean) => void;
  platformMediaLoading?: Set<string>;
  platformMediaErrors?: Map<string, string>;
  platformMediaSyncedAt?: Map<string, Date>;
  tokenInvalidAccountIds?: Set<string>;
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
  groups,
  groupsLoading,
  onGroupCreated,
  onGroupRenamed,
  onGroupDeleted,
  onMemberAdded,
  onMemberRemoved,
  tags,
  onTagAdded,
  onTagRemoved,
  postsByAccount,
  postsLoading,
  onPostDeleted,
  onPostUpdated,
  onFetchPlatformMedia,
  platformMediaLoading,
  platformMediaErrors,
  platformMediaSyncedAt,
  tokenInvalidAccountIds,
}: SocialAccountsListProps) {
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [selectedFilterTags, setSelectedFilterTags] = useState<Set<string>>(
    new Set()
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    new Set()
  );
  const [openGroupIds, setOpenGroupIds] = useState<Set<string>>(new Set());
  const [showCompanionDialog, setShowCompanionDialog] = useState(false);
  const [pendingBrowserAccount, setPendingBrowserAccount] = useState<{ provider: string; accountId: string; url: string } | null>(null);
  const [openingBrowserId, setOpeningBrowserId] = useState<string | null>(null);
  const allExpanded = groups.length > 0 && groups.every((g) => openGroupIds.has(g.id));

  const isSyncingAny = (platformMediaLoading?.size ?? 0) > 0;

  const handleSyncAll = () => {
    if (!onFetchPlatformMedia || isSyncingAny) return;
    for (const account of filteredAccounts) {
      onFetchPlatformMedia(account.account_id, true);
    }
  };

  const handleToggleGroup = (groupId: string) => {
    setOpenGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleToggleExpandAll = () => {
    if (allExpanded) {
      setOpenGroupIds(new Set());
    } else {
      setOpenGroupIds(new Set(groups.map((g) => g.id)));
    }
  };

  const availablePlatforms = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.platform))).sort(),
    [accounts]
  );

  // Keep selectedPlatforms in sync: default to all platforms selected
  useEffect(() => {
    setSelectedPlatforms(new Set(availablePlatforms));
  }, [availablePlatforms]);

  const handleTogglePlatform = (platform: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) {
        next.delete(platform);
      } else {
        next.add(platform);
      }
      return next;
    });
  };

  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (!selectedPlatforms.has(a.platform)) return false;
      if (selectedFilterTags.size === 0) return true;
      const accountTags = tags[a.account_id] || [];
      return Array.from(selectedFilterTags).every((t) =>
        accountTags.includes(t)
      );
    });
  }, [accounts, tags, selectedFilterTags, selectedPlatforms]);

  const handleToggleFilterTag = (tag: string) => {
    setSelectedFilterTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const handleClearFilter = () => {
    setSelectedFilterTags(new Set());
  };

  const BROWSER_MANAGED_PROVIDERS = new Set(['instagram', 'tiktok']);
  const DEFAULT_BROWSER_URLS: Record<string, string> = {
    instagram: 'https://www.instagram.com',
    tiktok: 'https://www.tiktok.com',
  };

  const handleOpenAccountInBrowser = async (account: OctupostAccount) => {
    const url = DEFAULT_BROWSER_URLS[account.platform] || 'about:blank';
    setOpeningBrowserId(account.account_id);
    const result = await openAccountInBrowser(account.platform, account.account_id, url);
    setOpeningBrowserId(null);
    if (result.notRunning) {
      setPendingBrowserAccount({ provider: account.platform, accountId: account.account_id, url });
      setShowCompanionDialog(true);
    }
  };

  const handleCompanionReady = async () => {
    if (!pendingBrowserAccount) return;
    await openAccountInBrowser(
      pendingBrowserAccount.provider,
      pendingBrowserAccount.accountId,
      pendingBrowserAccount.url
    );
    setPendingBrowserAccount(null);
  };

  // Drilldown into a specific account's posts
  if (selectedAccountId !== null) {
    const account = accounts.find((a) => a.account_id === selectedAccountId);
    if (!account) {
      setSelectedAccountId(null);
      return null;
    }
    const accountPosts = postsByAccount.get(selectedAccountId) || [];
    return (
      <AccountPostsList
        account={account}
        posts={accountPosts}
        onBack={() => setSelectedAccountId(null)}
        onPostDeleted={onPostDeleted}
        onPostUpdated={onPostUpdated}
        isLoadingPlatformMedia={platformMediaLoading?.has(selectedAccountId)}
        platformMediaError={platformMediaErrors?.get(selectedAccountId) || null}
        onSyncFromPlatform={onFetchPlatformMedia ? (id: string) => onFetchPlatformMedia(id, true) : undefined}
        lastSyncedAt={platformMediaSyncedAt?.get(selectedAccountId) || null}
        isTokenInvalid={new Date(account.expires_at) < new Date() || (tokenInvalidAccountIds?.has(selectedAccountId) ?? false)}
      />
    );
  }

  if (isLoading || groupsLoading) {
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

  const filteredSet = new Set(filteredAccounts.map((a) => a.account_id));
  const groupedUuids = new Set(groups.flatMap((g) => g.account_uuids));
  const ungroupedAccounts = filteredAccounts.filter(
    (a) => !groupedUuids.has(a.account_id)
  );

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">
          Connected Accounts
        </h2>
        <div className="flex items-center gap-2">
          {onFetchPlatformMedia && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncAll}
              disabled={isSyncingAny}
            >
              {isSyncingAny ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Sync All
            </Button>
          )}
          {groups.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleToggleExpandAll}
              title={allExpanded ? 'Collapse All' : 'Expand All'}
            >
              {allExpanded ? (
                <ChevronsDownUp className="h-4 w-4" />
              ) : (
                <ChevronsUpDown className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreateGroup(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            New Group
          </Button>
        </div>
      </div>

      <PlatformFilter
        platforms={availablePlatforms}
        selectedPlatforms={selectedPlatforms}
        onTogglePlatform={handleTogglePlatform}
      />

      <TagFilter
        tags={tags}
        selectedTags={selectedFilterTags}
        onToggleTag={handleToggleFilterTag}
        onClear={handleClearFilter}
      />

      {/* Groups */}
      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((group) => (
            <AccountGroupSection
              key={group.id}
              group={group}
              allAccounts={accounts}
              filteredUuids={filteredSet}
              onRenamed={onGroupRenamed}
              onDeleted={onGroupDeleted}
              onMemberAdded={onMemberAdded}
              onMemberRemoved={onMemberRemoved}
              tags={tags}
              onTagAdded={onTagAdded}
              onTagRemoved={onTagRemoved}
              postsByAccount={postsByAccount}
              postsLoading={postsLoading}
              onAccountClick={setSelectedAccountId}
              isOpen={openGroupIds.has(group.id)}
              onToggle={handleToggleGroup}
              tokenInvalidAccountIds={tokenInvalidAccountIds}
              onFetchPlatformMedia={onFetchPlatformMedia}
              platformMediaLoading={platformMediaLoading}
            />
          ))}
        </div>
      )}

      {/* Ungrouped accounts */}
      {ungroupedAccounts.length > 0 && (
        <div className="space-y-3">
          {groups.length > 0 && (
            <h3 className="text-sm font-medium text-muted-foreground">
              Ungrouped ({ungroupedAccounts.length})
            </h3>
          )}
          <div className="grid gap-2">
            {ungroupedAccounts.map((account) => {
              const postCount = postsByAccount.get(account.account_id)?.length || 0;
              const needsReAuth = new Date(account.expires_at) < new Date() || (tokenInvalidAccountIds?.has(account.account_id) ?? false);
              return (
                <div
                  key={account.account_id}
                  className={`flex items-center gap-3 rounded-lg border bg-card p-4 cursor-pointer transition-all hover:border-primary/50 hover:shadow-md ${needsReAuth ? 'border-amber-300' : ''}`}
                  onClick={() => setSelectedAccountId(account.account_id)}
                >
                  <Avatar>
                    <AvatarFallback>
                      {getInitials(account.account_name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {account.account_name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {account.account_username ? `@${account.account_username}` : account.platform}
                    </p>
                    {needsReAuth && (
                      <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                        <AlertCircle className="h-3 w-3 text-amber-600 flex-shrink-0" />
                        <span className="text-xs text-amber-600">
                          Token expired — please re-authorize
                        </span>
                      </div>
                    )}
                    <TagInput
                      accountUuid={account.account_id}
                      tags={tags[account.account_id] || []}
                      onTagAdded={onTagAdded}
                      onTagRemoved={onTagRemoved}
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    {BROWSER_MANAGED_PROVIDERS.has(account.platform) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleOpenAccountInBrowser(account); }}
                        disabled={openingBrowserId === account.account_id}
                        className="flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted/80 disabled:opacity-50"
                      >
                        {openingBrowserId === account.account_id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ExternalLink className="h-3 w-3" />
                        )}
                        Open
                      </button>
                    )}
                    {!postsLoading && (
                      <div className="text-right">
                        <p className="text-lg font-semibold text-foreground">
                          {postCount}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {postCount === 1 ? 'post' : 'posts'}
                        </p>
                      </div>
                    )}
                    <ProviderIcon provider={account.platform} className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <CreateGroupModal
        open={showCreateGroup}
        onOpenChange={setShowCreateGroup}
        onCreated={onGroupCreated}
      />

      <CompanionSetupDialog
        open={showCompanionDialog}
        onOpenChange={setShowCompanionDialog}
        onCompanionReady={handleCompanionReady}
      />
    </div>
  );
}
