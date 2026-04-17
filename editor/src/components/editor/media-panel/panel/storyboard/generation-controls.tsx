'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  IconLoader2,
  IconSparkles,
  IconRefresh,
  IconInfoCircle,
} from '@tabler/icons-react';

// ── Generate Button ────────────────────────────────────────────────────────────

export function GenerateButton({
  label,
  genStatus,
  hasResult,
  onClick,
  size = 'sm',
  disabled = false,
  disabledReason,
}: {
  label: string;
  genStatus: string;
  hasResult: boolean;
  onClick: () => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  disabledReason?: string;
}) {
  // Blocked — show disabled state with reason
  if (disabled && !hasResult && genStatus !== 'generating') {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground/50 border border-border/20 cursor-not-allowed"
        title={disabledReason ?? `Cannot generate ${label}`}
      >
        <IconSparkles className="size-2.5 opacity-40" />
        {size === 'md' && label}
      </span>
    );
  }

  if (genStatus === 'generating') {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 animate-pulse font-medium hover:bg-yellow-500/25 transition-colors cursor-pointer"
        title={`Generating ${label}… click to retry if stuck`}
      >
        <IconLoader2 className="size-3 animate-spin" />
        Generating {label}...
      </button>
    );
  }

  // Already has result — show regenerate option
  if (hasResult) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground border border-border/30 hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
        title={`Regenerate ${label}`}
      >
        <IconRefresh className="size-2.5" />
        {size === 'md' && label}
      </button>
    );
  }

  // Failed — show retry
  if (genStatus === 'failed') {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer"
        title={`Retry ${label}`}
      >
        <IconRefresh className="size-2.5" />
        {size === 'md' && `Retry ${label}`}
      </button>
    );
  }

  // Idle — show generate
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors cursor-pointer"
      title={`Generate ${label}`}
    >
      <IconSparkles className="size-2.5" />
      {size === 'md' && label}
    </button>
  );
}

// ── Generation Status Indicator ─────────────────────────────────────────────────

export function GenerationStatus({
  label,
  icon,
  genStatus,
  hasResult,
}: {
  label: string;
  icon: React.ReactNode;
  genStatus: string;
  hasResult: boolean;
}) {
  if (genStatus === 'generating') {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-yellow-400 animate-pulse bg-yellow-500/10 px-1.5 py-0.5 rounded border border-yellow-500/20"
        title={`${label}: Generating...`}
      >
        {icon}
        <IconLoader2 className="size-2.5 inline animate-spin" />
        <span className="text-[8px] font-medium">Generating</span>
      </span>
    );
  }
  if (genStatus === 'failed') {
    return (
      <span className="text-red-400" title={`${label}: Failed`}>
        {icon}
        <span className="text-[8px]">&#x2717;</span>
      </span>
    );
  }
  // done or idle — show green if result exists
  return (
    <span className={hasResult ? 'text-green-400' : 'opacity-30'} title={label}>
      {icon}
      {label}
    </span>
  );
}

// ── Generation Metadata Tooltip ──────────────────────────────────────────────

export function GenMetadataTooltip({
  metadata,
}: {
  metadata: Record<string, unknown> | null | undefined;
}) {
  if (!metadata) return null;
  const entries = Object.entries(metadata).filter(([, v]) => v != null);
  if (entries.length === 0) return null;

  const formatKey = (k: string) =>
    k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const formatValue = (v: unknown) => {
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'string' && v.length > 60) return `${v.slice(0, 57)}...`;
    return String(v);
  };

  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center size-4 rounded hover:bg-muted/40 text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
        >
          <IconInfoCircle className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[250px]">
        <div className="space-y-0.5 text-[10px]">
          {entries.map(([key, val]) => (
            <div key={key} className="flex justify-between gap-3">
              <span className="text-muted-foreground">{formatKey(key)}</span>
              <span className="font-medium truncate">{formatValue(val)}</span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
