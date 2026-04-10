'use client';

import { useState } from 'react';
import { toast } from 'sonner';

export function CopyIdBadge({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error('Failed to copy ID');
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-[8px] font-mono px-1 py-0.5 rounded bg-muted/30 border border-border/20 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
      title={`Copy ID: ${id}`}
    >
      {copied ? '✓ copied' : id.slice(0, 8)}
    </button>
  );
}
