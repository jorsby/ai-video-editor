'use client';

import { useState } from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  LoaderIcon,
  PencilIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EditVoiceoverArgs {
  originalScript?: string;
  feedback?: string;
}

interface EditVoiceoverResult {
  originalScript: string;
  feedback: string;
  instruction: string;
}

export const EditVoiceoverTool: ToolCallMessagePartComponent<
  EditVoiceoverArgs,
  EditVoiceoverResult
> = ({ args, result }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  const isLoading = result === undefined;
  const feedback = args?.feedback || 'editing...';

  const handleCopy = async () => {
    if (!result?.instruction) return;
    try {
      await navigator.clipboard.writeText(result.instruction);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="aui-tool-container mb-4 flex w-full flex-col gap-3 rounded-xl border bg-card/50">
      {/* Header */}
      <button
        type="button"
        className="flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
        onClick={() => setIsCollapsed(!isCollapsed)}
        disabled={isLoading}
      >
        <div className="flex size-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
          {isLoading ? (
            <LoaderIcon className="size-4 animate-spin" />
          ) : (
            <PencilIcon className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Edit Voiceover</p>
          <p className="truncate text-xs text-muted-foreground">
            {isLoading ? (
              <span className="flex items-center gap-1.5">
                Applying: "{feedback}"...
              </span>
            ) : (
              <>Feedback: "{feedback}"</>
            )}
          </p>
        </div>
        {!isLoading && (
          <div className="flex size-8 items-center justify-center text-muted-foreground">
            {isCollapsed ? (
              <ChevronDownIcon className="size-4" />
            ) : (
              <ChevronUpIcon className="size-4" />
            )}
          </div>
        )}
      </button>

      {/* Loading bar */}
      {isLoading && (
        <div className="h-1 w-full animate-pulse bg-violet-500/30" />
      )}

      {/* Content */}
      {!isCollapsed && !isLoading && result && (
        <div className="flex flex-col gap-2 border-t px-4 pb-4 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Revision applied
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <CheckIcon className="size-3" />
                  Copied
                </>
              ) : (
                <>
                  <CopyIcon className="size-3" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            The AI is revising the voiceover based on your feedback.
          </p>
        </div>
      )}
    </div>
  );
};
