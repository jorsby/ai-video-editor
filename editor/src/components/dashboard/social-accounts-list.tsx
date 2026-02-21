'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AccountGroupSection } from './account-group-section';
import { AccountPostsList } from './account-posts-list';
import { CreateGroupModal } from './create-group-modal';
import { TagInput } from './tag-input';
import { TagFilter } from './tag-filter';
import { PlatformFilter } from './platform-filter';
import { ProviderIcon } from './provider-icon';
import type {
  MixpostAccount,
  AccountGroupWithMembers,
  AccountTagMap,
} from '@/types/mixpost';
import type { MixpostPost } from '@/types/calendar';

interface SocialAccountsListProps {
  accounts: MixpostAccount[];
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
  postsByAccount: Map<number, MixpostPost[]>;
  postsLoading: boolean;
  onPostDeleted?: (postUuid: string) => void;
  onPostUpdated?: (postUuid: string, fields: Record<string, string>) => void;
  onFetchPlatformMedia?: (accountId: number, force?: boolean) => void;
  platformMediaLoading?: Set<number>;
  platformMediaErrors?: Map<number, string>;
  platformMediaSyncedAt?: Map<number, Date>;
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
}: SocialAccountsListProps) {
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [selectedFilterTags, setSelectedFilterTags] = useState<Set<string>>(
    new Set()
  );
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(
    null
  );
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    new Set()
  );
  const [openGroupIds, setOpenGroupIds] = useState<Set<string>>(new Set());
  const allExpanded = groups.length > 0 && groups.every((g) => openGroupIds.has(g.id));

  const isSyncingAny = (platformMediaLoading?.size ?? 0) > 0;

  const handleSyncAll = () => {
    if (!onFetchPlatformMedia || isSyncingAny) return;
    for (const account of filteredAccounts) {
      onFetchPlatformMedia(account.id, true);
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
    () => Array.from(new Set(accounts.map((a) => a.provider))).sort(),
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
      if (!selectedPlatforms.has(a.provider)) return false;
      if (selectedFilterTags.size === 0) return true;
      const accountTags = tags[a.uuid] || [];
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

  // Drilldown into a specific account's posts
  if (selectedAccountId !== null) {
    const account = accounts.find((a) => a.id === selectedAccountId);
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
        onSyncFromPlatform={onFetchPlatformMedia ? (id: number) => onFetchPlatformMedia(id, true) : undefined}
        lastSyncedAt={platformMediaSyncedAt?.get(selectedAccountId) || null}
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

  const filteredSet = new Set(filteredAccounts.map((a) => a.uuid));
  const groupedUuids = new Set(groups.flatMap((g) => g.account_uuids));
  const ungroupedAccounts = filteredAccounts.filter(
    (a) => !groupedUuids.has(a.uuid)
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
              const postCount = postsByAccount.get(account.id)?.length || 0;
              return (
                <div
                  key={account.id}
                  className="flex items-center gap-3 rounded-lg border bg-card p-4 cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
                  onClick={() => setSelectedAccountId(account.id)}
                >
                  <Avatar>
                    {account.image ? (
                      <AvatarImage src={account.image} alt={account.name} />
                    ) : null}
                    <AvatarFallback>
                      {getInitials(account.name)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {account.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      @{account.username}
                    </p>
                    <TagInput
                      accountUuid={account.uuid}
                      tags={tags[account.uuid] || []}
                      onTagAdded={onTagAdded}
                      onTagRemoved={onTagRemoved}
                    />
                  </div>

                  <div className="flex items-center gap-3">
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
                    <ProviderIcon provider={account.provider} className="h-5 w-5 text-muted-foreground" />
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
    </div>
  );
}
