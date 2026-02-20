'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import type { MixpostAccount } from '@/types/mixpost';

interface AddAccountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  availableAccounts: MixpostAccount[];
  onAdded: (groupId: string, accountUuid: string) => void;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function AddAccountsDialog({
  open,
  onOpenChange,
  groupId,
  availableAccounts,
  onAdded,
}: AddAccountsDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const toggleAccount = (uuid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return next;
    });
  };

  const handleAdd = async () => {
    setIsLoading(true);
    try {
      for (const uuid of selected) {
        const response = await fetch('/api/account-groups/members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: groupId, account_uuid: uuid }),
        });
        if (response.ok) {
          onAdded(groupId, uuid);
        }
      }
      setSelected(new Set());
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSelected(new Set());
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Accounts to Group</DialogTitle>
        </DialogHeader>

        <div className="py-2 max-h-64 overflow-y-auto space-y-1">
          {availableAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              All accounts are already in this group.
            </p>
          ) : (
            availableAccounts.map((account) => (
              <label
                key={account.uuid}
                className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={selected.has(account.uuid)}
                  onCheckedChange={() => toggleAccount(account.uuid)}
                />
                <Avatar className="h-8 w-8">
                  {account.image ? (
                    <AvatarImage src={account.image} alt={account.name} />
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
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {account.provider}
                </span>
              </label>
            ))
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={isLoading || selected.size === 0}
          >
            {isLoading ? 'Adding...' : `Add (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
