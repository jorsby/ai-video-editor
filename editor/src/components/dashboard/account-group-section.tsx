'use client';

import { useState } from 'react';
import {
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
  Plus,
  X,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { AddAccountsDialog } from './add-accounts-dialog';
import { TagInput } from './tag-input';
import { ProviderIcon } from './provider-icon';
import type {
  MixpostAccount,
  AccountGroupWithMembers,
  AccountTagMap,
} from '@/types/mixpost';
import type { MixpostPost } from '@/types/calendar';

interface AccountGroupSectionProps {
  group: AccountGroupWithMembers;
  allAccounts: MixpostAccount[];
  filteredUuids: Set<string>;
  onRenamed: (id: string, name: string) => void;
  onDeleted: (id: string) => void;
  onMemberAdded: (groupId: string, accountUuid: string) => void;
  onMemberRemoved: (groupId: string, accountUuid: string) => void;
  tags: AccountTagMap;
  onTagAdded: (accountUuid: string, tag: string) => void;
  onTagRemoved: (accountUuid: string, tag: string) => void;
  postsByAccount: Map<number, MixpostPost[]>;
  postsLoading: boolean;
  onAccountClick: (accountId: number) => void;
  isOpen: boolean;
  onToggle: (groupId: string) => void;
  tokenInvalidAccountIds?: Set<number>;
  onFetchPlatformMedia?: (accountId: number, force?: boolean) => void;
  platformMediaLoading?: Set<number>;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function AccountGroupSection({
  group,
  allAccounts,
  filteredUuids,
  onRenamed,
  onDeleted,
  onMemberAdded,
  onMemberRemoved,
  tags,
  onTagAdded,
  onTagRemoved,
  postsByAccount,
  postsLoading,
  onAccountClick,
  isOpen,
  onToggle,
  tokenInvalidAccountIds,
  onFetchPlatformMedia,
  platformMediaLoading,
}: AccountGroupSectionProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const [isRenameLoading, setIsRenameLoading] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [removingUuid, setRemovingUuid] = useState<string | null>(null);

  const memberAccounts = allAccounts.filter(
    (a) =>
      group.account_uuids.includes(a.uuid) && filteredUuids.has(a.uuid)
  );

  const availableAccounts = allAccounts.filter(
    (a) => !group.account_uuids.includes(a.uuid)
  );

  const isSyncingGroup = memberAccounts.some(
    (a) => platformMediaLoading?.has(a.id) ?? false
  );

  const handleSyncGroup = () => {
    if (!onFetchPlatformMedia || isSyncingGroup) return;
    for (const account of memberAccounts) {
      onFetchPlatformMedia(account.id, true);
    }
  };

  const handleRename = async () => {
    if (!renameValue.trim() || renameValue.trim() === group.name) {
      setIsRenaming(false);
      setRenameValue(group.name);
      return;
    }

    setIsRenameLoading(true);
    try {
      const response = await fetch('/api/account-groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: group.id, name: renameValue.trim() }),
      });
      if (response.ok) {
        onRenamed(group.id, renameValue.trim());
      }
    } finally {
      setIsRenameLoading(false);
      setIsRenaming(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleteLoading(true);
    try {
      const response = await fetch(
        `/api/account-groups?id=${encodeURIComponent(group.id)}`,
        { method: 'DELETE' }
      );
      if (response.ok) {
        onDeleted(group.id);
      }
    } finally {
      setIsDeleteLoading(false);
      setShowDeleteDialog(false);
    }
  };

  const handleRemoveMember = async (accountUuid: string) => {
    setRemovingUuid(accountUuid);
    try {
      const response = await fetch(
        `/api/account-groups/members?group_id=${encodeURIComponent(group.id)}&account_uuid=${encodeURIComponent(accountUuid)}`,
        { method: 'DELETE' }
      );
      if (response.ok) {
        onMemberRemoved(group.id, accountUuid);
      }
    } finally {
      setRemovingUuid(null);
    }
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={() => onToggle(group.id)}>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3">
          <CollapsibleTrigger className="flex items-center gap-2 flex-1 min-w-0">
            {isOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}

            {isRenaming ? (
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') {
                    setIsRenaming(false);
                    setRenameValue(group.name);
                  }
                }}
                disabled={isRenameLoading}
                className="h-7 text-sm"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="text-sm font-medium truncate">
                {group.name}
              </span>
            )}

            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground shrink-0">
              {memberAccounts.length}
            </span>
          </CollapsibleTrigger>

          {onFetchPlatformMedia && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={(e) => { e.stopPropagation(); handleSyncGroup(); }}
              disabled={isSyncingGroup}
              title="Sync All in Group"
            >
              {isSyncingGroup ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setRenameValue(group.name);
                  setIsRenaming(true);
                }}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setShowDeleteDialog(true)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <CollapsibleContent>
          <div className="ml-6 mt-2 space-y-2">
            {memberAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No accounts in this group yet.
              </p>
            ) : (
              <div className="grid gap-2">
                {memberAccounts.map((account) => {
                  const postCount = postsByAccount.get(account.id)?.length || 0;
                  const needsReAuth = !account.authorized || (tokenInvalidAccountIds?.has(account.id) ?? false);
                  const mixpostUrl = process.env.NEXT_PUBLIC_MIXPOST_URL;
                  return (
                    <div
                      key={account.uuid}
                      className={`flex items-center gap-3 rounded-lg border bg-card p-3 group cursor-pointer transition-all hover:border-primary/50 hover:shadow-md ${needsReAuth ? 'border-amber-300' : ''}`}
                      onClick={() => onAccountClick(account.id)}
                    >
                      <Avatar className="h-8 w-8">
                        {account.image ? (
                          <AvatarImage
                            src={account.image}
                            alt={account.name}
                          />
                        ) : null}
                        <AvatarFallback className="text-xs">
                          {getInitials(account.name)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {account.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          @{account.username}
                        </p>
                        {needsReAuth && (
                          <div className="flex items-center gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                            <AlertCircle className="h-3 w-3 text-amber-600 flex-shrink-0" />
                            <span className="text-xs text-amber-600">
                              Token expired —{' '}
                              {mixpostUrl ? (
                                <a
                                  href={`${mixpostUrl}/accounts`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline font-medium"
                                >
                                  Re-authorize in Mixpost
                                </a>
                              ) : (
                                <span className="font-medium">Re-authorize in Mixpost</span>
                              )}
                            </span>
                          </div>
                        )}
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
                            <p className="text-sm font-semibold text-foreground">
                              {postCount}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {postCount === 1 ? 'post' : 'posts'}
                            </p>
                          </div>
                        )}
                        <ProviderIcon provider={account.provider} className="h-5 w-5 text-muted-foreground" />
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveMember(account.uuid);
                        }}
                        disabled={removingUuid === account.uuid}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setShowAddDialog(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Account
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Group</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{group.name}&quot;? The
              accounts will not be deleted, they will just be ungrouped.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleteLoading}
            >
              {isDeleteLoading ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add accounts dialog */}
      <AddAccountsDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        groupId={group.id}
        availableAccounts={availableAccounts}
        onAdded={onMemberAdded}
      />
    </>
  );
}
