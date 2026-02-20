'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { X, ChevronRight } from 'lucide-react';
import type {
  MixpostAccount,
  AccountGroupWithMembers,
  AccountTagMap,
} from '@/types/mixpost';

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
  accounts: MixpostAccount[];
  groups: AccountGroupWithMembers[];
  tags: AccountTagMap;
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
}

export function AccountSelector({
  accounts,
  groups,
  tags,
  selectedIds,
  onSelectionChange,
}: AccountSelectorProps) {
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

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

  const allTags = Array.from(new Set(Object.values(tags).flat())).sort();

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

  const isAccountVisible = (account: MixpostAccount) => {
    if (selectedTags.size === 0) return true;
    const accountTags = tags[account.uuid] || [];
    return accountTags.some((t) => selectedTags.has(t));
  };

  const toggleAccount = (id: number) => {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((i) => i !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const selectAllInGroup = (groupAccountUuids: string[]) => {
    const groupAccountIds = accounts
      .filter(
        (a) => groupAccountUuids.includes(a.uuid) && isAccountVisible(a)
      )
      .map((a) => a.id);
    const merged = new Set([...selectedIds, ...groupAccountIds]);
    onSelectionChange(Array.from(merged));
  };

  const deselectAllInGroup = (groupAccountUuids: string[]) => {
    const groupAccountIds = new Set(
      accounts
        .filter((a) => groupAccountUuids.includes(a.uuid))
        .map((a) => a.id)
    );
    onSelectionChange(selectedIds.filter((id) => !groupAccountIds.has(id)));
  };

  // Accounts that belong to at least one group
  const groupedAccountUuids = new Set(groups.flatMap((g) => g.account_uuids));
  const ungroupedAccounts = accounts.filter(
    (a) => !groupedAccountUuids.has(a.uuid) && isAccountVisible(a)
  );

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

      {/* Grouped accounts */}
      {groups.map((group) => {
        const groupAccounts = accounts.filter(
          (a) => group.account_uuids.includes(a.uuid) && isAccountVisible(a)
        );
        if (groupAccounts.length === 0) return null;

        const allSelected = groupAccounts.every((a) =>
          selectedIds.includes(a.id)
        );

        const isCollapsed = collapsedGroups.has(group.id);
        const selectedCount = groupAccounts.filter((a) =>
          selectedIds.includes(a.id)
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
                    ? deselectAllInGroup(group.account_uuids)
                    : selectAllInGroup(group.account_uuids)
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
                      key={account.id}
                      account={account}
                      checked={selectedIds.includes(account.id)}
                      onToggle={() => toggleAccount(account.id)}
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
                        key={account.id}
                        account={account}
                        checked={selectedIds.includes(account.id)}
                        onToggle={() => toggleAccount(account.id)}
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
                  key={account.id}
                  account={account}
                  checked={selectedIds.includes(account.id)}
                  onToggle={() => toggleAccount(account.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {accounts.length === 0 && (
        <div className="rounded-lg border border-white/[0.08] bg-zinc-900/40 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No social accounts connected. Connect accounts in Mixpost first.
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
  account: MixpostAccount;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.04]">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      {account.image && (
        <img
          src={account.image}
          alt=""
          className="h-7 w-7 rounded-full object-cover"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {account.name}
          </span>
          <ProviderBadge provider={account.provider} />
          {!account.authorized && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-600/20 text-red-400">
              Not Authorized
            </span>
          )}
        </div>
        {account.username && (
          <span className="text-xs text-muted-foreground truncate block">
            @{account.username}
          </span>
        )}
      </div>
    </label>
  );
}
