'use client';

import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { MixpostAccount, AccountGroupWithMembers } from '@/types/mixpost';
import type { MixpostPostTag } from '@/types/calendar';

interface CalendarFilterBarProps {
  accounts: MixpostAccount[];
  selectedAccountUuids: Set<string>;
  onToggleAccount: (uuid: string) => void;

  groups: AccountGroupWithMembers[];
  selectedGroupIds: Set<string>;
  onToggleGroup: (id: string) => void;

  postTags: MixpostPostTag[];
  selectedTagUuids: Set<string>;
  onToggleTag: (uuid: string) => void;

  hasActiveFilters: boolean;
  onClearAll: () => void;
}

interface FilterDropdownProps {
  label: string;
  activeCount: number;
  children: React.ReactNode;
}

function FilterDropdown({ label, activeCount, children }: FilterDropdownProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
            activeCount > 0
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground'
          )}
        >
          {label}
          {activeCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none text-primary-foreground">
              {activeCount}
            </span>
          )}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        {children}
      </PopoverContent>
    </Popover>
  );
}

interface CheckItemProps {
  id: string;
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function CheckItem({ id, checked, onToggle, children }: CheckItemProps) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onToggle}
        className="shrink-0"
      />
      {children}
    </label>
  );
}

export function CalendarFilterBar({
  accounts,
  selectedAccountUuids,
  onToggleAccount,
  groups,
  selectedGroupIds,
  onToggleGroup,
  postTags,
  selectedTagUuids,
  onToggleTag,
  hasActiveFilters,
  onClearAll,
}: CalendarFilterBarProps) {
  const showChannels = accounts.length > 1;
  const showGroups = groups.length > 0;
  const showTags = postTags.length > 0;

  if (!showChannels && !showGroups && !showTags) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showChannels && (
        <FilterDropdown label="Channel" activeCount={selectedAccountUuids.size}>
          {accounts.map((account) => (
            <CheckItem
              key={account.uuid}
              id={`cal-ch-${account.uuid}`}
              checked={selectedAccountUuids.has(account.uuid)}
              onToggle={() => onToggleAccount(account.uuid)}
            >
              <span className="truncate">{account.name}</span>
            </CheckItem>
          ))}
        </FilterDropdown>
      )}

      {showGroups && (
        <FilterDropdown label="Group" activeCount={selectedGroupIds.size}>
          {groups.map((group) => (
            <CheckItem
              key={group.id}
              id={`cal-grp-${group.id}`}
              checked={selectedGroupIds.has(group.id)}
              onToggle={() => onToggleGroup(group.id)}
            >
              <span className="truncate">{group.name}</span>
            </CheckItem>
          ))}
        </FilterDropdown>
      )}

      {showTags && (
        <FilterDropdown label="Tags" activeCount={selectedTagUuids.size}>
          {postTags.map((tag) => (
            <CheckItem
              key={tag.uuid}
              id={`cal-tag-${tag.uuid}`}
              checked={selectedTagUuids.has(tag.uuid)}
              onToggle={() => onToggleTag(tag.uuid)}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: tag.hex_color }}
              />
              <span className="truncate">{tag.name}</span>
            </CheckItem>
          ))}
        </FilterDropdown>
      )}

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={onClearAll}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
