'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { X, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import type { SocialAccount, AccountGroup, AccountTag } from '@/types/social';

const PROVIDER_ICONS: Record<string, string> = {
  facebook: '/icons/facebook.svg',
  youtube: '/icons/youtube.svg',
  tiktok: '/icons/tiktok.svg',
  instagram: '/icons/instagram.svg',
  twitter: '/icons/twitter.svg',
  x: '/icons/x.svg',
};

function ProviderBadge({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    facebook: 'bg-blue-600/20 text-blue-400',
    youtube: 'bg-red-600/20 text-red-400',
    tiktok: 'bg-zinc-600/20 text-zinc-300',
    instagram: 'bg-pink-600/20 text-pink-400',
    twitter: 'bg-sky-600/20 text-sky-400',
    x: 'bg-zinc-600/20 text-zinc-300',
  };

  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        colors[provider] || 'bg-zinc-600/20 text-zinc-400'
      }`}
    >
      {provider}
    </span>
  );
}

interface AccountSelectorProps {
  accounts: SocialAccount[];
  groups: AccountGroup[];
  tags: Record<string, AccountTag[]>;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function AccountSelector({
  accounts,
  groups,
  tags,
  selectedIds,
  onSelectionChange,
}: AccountSelectorProps) {
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set()
  );

  const toggleCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const allTags = Array.from(
    new Set(
      Object.values(tags)
        .flat()
        .map((t) => t.name)
    )
  ).sort();

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const isAccountVisible = (account: SocialAccount) => {
    if (selectedTags.size === 0) return true;
    const accountTags = tags[account.id] || [];
    return accountTags.some((t) => selectedTags.has(t.name));
  };

  const toggleAccount = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((i) => i !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const selectAllInGroup = (groupAccountIds: string[]) => {
    const visibleIds = accounts
      .filter(
        (a) =>
          groupAccountIds.includes(a.octupost_account_id) && isAccountVisible(a)
      )
      .map((a) => a.octupost_account_id);
    const merged = new Set([...selectedIds, ...visibleIds]);
    onSelectionChange(Array.from(merged));
  };

  const deselectAllInGroup = (groupAccountIds: string[]) => {
    const groupIdSet = new Set(groupAccountIds);
    onSelectionChange(selectedIds.filter((id) => !groupIdSet.has(id)));
  };

  // Accounts that belong to at least one group
  const groupedAccountIds = new Set(groups.flatMap((g) => g.account_ids));
  const ungroupedAccounts = accounts.filter(
    (a) => !groupedAccountIds.has(a.octupost_account_id) && isAccountVisible(a)
  );

  // Collapse all / expand all
  const allGroupIds = [
    ...groups.map((g) => g.id),
    ...(ungroupedAccounts.length > 0 && groups.length > 0
      ? ['__ungrouped']
      : []),
  ];
  const allExpanded =
    allGroupIds.length === 0 ||
    allGroupIds.every((id) => !collapsedGroups.has(id));

  const handleToggleExpandAll = () => {
    if (allExpanded) {
      setCollapsedGroups(new Set(allGroupIds));
    } else {
      setCollapsedGroups(new Set());
    }
  };

  return (
    <div className="space-y-4">
      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Filter:</span>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                selectedTags.has(tag)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {tag}
            </button>
          ))}
          {selectedTags.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-xs text-muted-foreground"
              onClick={() => setSelectedTags(new Set())}
            >
              <X className="h-3 w-3 mr-0.5" />
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Collapse All / Expand All */}
      {allGroupIds.length > 0 && (
        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground gap-1.5 hover:text-foreground"
            onClick={handleToggleExpandAll}
          >
            {allExpanded ? (
              <>
                <ChevronsDownUp className="h-3.5 w-3.5" />
                Collapse All
              </>
            ) : (
              <>
                <ChevronsUpDown className="h-3.5 w-3.5" />
                Expand All
              </>
            )}
          </Button>
        </div>
      )}

      {/* Grouped accounts */}
      {groups.map((group) => {
        const groupAccounts = accounts.filter(
          (a) =>
            group.account_ids.includes(a.octupost_account_id) &&
            isAccountVisible(a)
        );
        if (groupAccounts.length === 0) return null;

        const allSelected = groupAccounts.every((a) =>
          selectedIds.includes(a.octupost_account_id)
        );

        const isCollapsed = collapsedGroups.has(group.id);
        const selectedCount = groupAccounts.filter((a) =>
          selectedIds.includes(a.octupost_account_id)
        ).length;

        return (
          <div
            key={group.id}
            className="rounded-lg border border-white/[0.08] bg-zinc-900/40"
          >
            {/* Group header */}
            <div className="flex items-center gap-2 p-3">
              <Checkbox
                checked={
                  allSelected
                    ? true
                    : selectedCount > 0
                      ? 'indeterminate'
                      : false
                }
                onCheckedChange={() =>
                  allSelected
                    ? deselectAllInGroup(group.account_ids)
                    : selectAllInGroup(group.account_ids)
                }
              />
              <button
                type="button"
                onClick={() => toggleCollapse(group.id)}
                className="flex flex-1 items-center gap-1.5 text-left"
              >
                <ChevronRight
                  className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 ${
                    !isCollapsed ? 'rotate-90' : ''
                  }`}
                />
                <span className="text-xs font-semibold text-zinc-400">
                  {group.name}
                </span>
                {selectedCount > 0 && (
                  <span className="text-[10px] text-zinc-500">
                    {selectedCount}/{groupAccounts.length}
                  </span>
                )}
              </button>
            </div>

            {/* Collapsible account list */}
            <div
              className={`grid transition-[grid-template-rows] duration-200 ${
                isCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
              }`}
            >
              <div className="overflow-hidden">
                <div className="space-y-1.5 px-3 pb-3">
                  {groupAccounts.map((account) => (
                    <AccountRow
                      key={account.octupost_account_id}
                      account={account}
                      checked={selectedIds.includes(
                        account.octupost_account_id
                      )}
                      onToggle={() =>
                        toggleAccount(account.octupost_account_id)
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Ungrouped accounts */}
      {ungroupedAccounts.length > 0 && (
        <div className="rounded-lg border border-white/[0.08] bg-zinc-900/40">
          {groups.length > 0 ? (
            <>
              <div className="flex items-center gap-2 p-3">
                <button
                  type="button"
                  onClick={() => toggleCollapse('__ungrouped')}
                  className="flex flex-1 items-center gap-1.5 text-left"
                >
                  <ChevronRight
                    className={`h-3.5 w-3.5 text-zinc-500 transition-transform duration-200 ${
                      !collapsedGroups.has('__ungrouped') ? 'rotate-90' : ''
                    }`}
                  />
                  <span className="text-xs font-semibold text-zinc-400">
                    Other Accounts
                  </span>
                </button>
              </div>
              <div
                className={`grid transition-[grid-template-rows] duration-200 ${
                  collapsedGroups.has('__ungrouped')
                    ? 'grid-rows-[0fr]'
                    : 'grid-rows-[1fr]'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="space-y-1.5 px-3 pb-3">
                    {ungroupedAccounts.map((account) => (
                      <AccountRow
                        key={account.octupost_account_id}
                        account={account}
                        checked={selectedIds.includes(
                          account.octupost_account_id
                        )}
                        onToggle={() =>
                          toggleAccount(account.octupost_account_id)
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-1.5 p-3">
              {ungroupedAccounts.map((account) => (
                <AccountRow
                  key={account.octupost_account_id}
                  account={account}
                  checked={selectedIds.includes(account.octupost_account_id)}
                  onToggle={() => toggleAccount(account.octupost_account_id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {accounts.length === 0 && (
        <div className="rounded-lg border border-white/[0.08] bg-zinc-900/40 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No social accounts connected. Connect your accounts to get started.
          </p>
        </div>
      )}
    </div>
  );
}

function AccountRow({
  account,
  checked,
  onToggle,
}: {
  account: SocialAccount;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.04]">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {account.account_name ?? account.octupost_account_id}
          </span>
          <ProviderBadge provider={account.platform} />
        </div>
        {account.account_username && (
          <span className="text-xs text-muted-foreground truncate block">
            @{account.account_username}
          </span>
        )}
      </div>
    </label>
  );
}
