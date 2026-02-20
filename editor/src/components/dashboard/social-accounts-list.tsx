'use client';

import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AccountGroupSection } from './account-group-section';
import { CreateGroupModal } from './create-group-modal';
import { TagInput } from './tag-input';
import { TagFilter } from './tag-filter';
import type {
  MixpostAccount,
  AccountGroupWithMembers,
  AccountTagMap,
} from '@/types/mixpost';

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
}: SocialAccountsListProps) {
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [selectedFilterTags, setSelectedFilterTags] = useState<Set<string>>(
    new Set()
  );

  const filteredAccounts = useMemo(() => {
    if (selectedFilterTags.size === 0) return accounts;
    return accounts.filter((a) => {
      const accountTags = tags[a.uuid] || [];
      return Array.from(selectedFilterTags).every((t) =>
        accountTags.includes(t)
      );
    });
  }, [accounts, tags, selectedFilterTags]);

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
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCreateGroup(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          New Group
        </Button>
      </div>

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
            {ungroupedAccounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center gap-3 rounded-lg border bg-card p-4"
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

                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {account.provider}
                </span>
              </div>
            ))}
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
