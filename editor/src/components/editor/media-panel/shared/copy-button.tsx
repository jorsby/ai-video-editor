'use client';

import { useState } from 'react';
import { IconCopy, IconCheck } from '@tabler/icons-react';
import { toast } from 'sonner';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <IconCheck className="size-2.5 text-green-400" />
      ) : (
        <IconCopy className="size-2.5" />
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
