'use client';

import { IconLoader2, IconCheck, IconX, IconClock } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

type Status = 'pending' | 'processing' | 'success' | 'failed';

interface StatusBadgeProps {
  status: Status;
  label?: string;
  size?: 'sm' | 'md';
}

const statusConfig = {
  pending: {
    icon: IconClock,
    bg: 'bg-muted/50',
    text: 'text-muted-foreground',
    defaultLabel: 'Pending',
  },
  processing: {
    icon: IconLoader2,
    bg: 'bg-blue-500/10',
    text: 'text-blue-500',
    defaultLabel: 'Processing',
    animate: true,
  },
  success: {
    icon: IconCheck,
    bg: 'bg-green-500/10',
    text: 'text-green-500',
    defaultLabel: 'Complete',
  },
  failed: {
    icon: IconX,
    bg: 'bg-destructive/10',
    text: 'text-destructive',
    defaultLabel: 'Failed',
  },
};

export function StatusBadge({ status, label, size = 'md' }: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const iconSize = size === 'sm' ? 8 : 10;

  // Small size: icon only, no label
  if (size === 'sm') {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full p-0.5',
          config.bg,
          config.text
        )}
      >
        <Icon
          size={iconSize}
          className={
            'animate' in config && config.animate ? 'animate-spin' : undefined
          }
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5',
        config.bg,
        config.text,
        'text-[10px]'
      )}
    >
      <Icon
        size={iconSize}
        className={
          'animate' in config && config.animate ? 'animate-spin' : undefined
        }
      />
      <span>{label || config.defaultLabel}</span>
    </span>
  );
}
