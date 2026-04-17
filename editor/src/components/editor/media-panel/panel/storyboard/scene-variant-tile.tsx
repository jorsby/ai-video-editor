'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { VariantImageMap } from '../../shared/scene-types';
import { slugToLabel, flattenStructuredPrompt } from '../../shared/scene-types';
import {
  IconChevronDown,
  IconChevronUp,
  IconLoader2,
  IconRefresh,
  IconPencil,
  IconDeviceFloppy,
} from '@tabler/icons-react';
import { CopyButton } from '../../shared/copy-button';
import { GenMetadataTooltip } from './generation-controls';

// ── Scene Variant Tile (retry image from scene expand) ─────────────────────────

export function SceneVariantTile({
  slug,
  imageMap,
}: {
  slug: string;
  imageMap: VariantImageMap;
}) {
  const info = imageMap.get(slug);
  const url = info?.image_url;
  const variantId = info?.id;
  const [isRetrying, setIsRetrying] = useState(false);
  const [optimisticGenerating, setOptimisticGenerating] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const label = slugToLabel(slug);

  // Reset optimistic state when realtime delivers a non-generating status
  useEffect(() => {
    if (
      optimisticGenerating &&
      info?.image_gen_status &&
      info.image_gen_status !== 'generating'
    ) {
      setOptimisticGenerating(false);
    }
  }, [info?.image_gen_status]); // eslint-disable-line react-hooks/exhaustive-deps

  const isGeneratingOrRetrying =
    isRetrying ||
    optimisticGenerating ||
    info?.image_gen_status === 'generating';

  const handleRetry = async () => {
    if (!variantId || isGeneratingOrRetrying) return;
    setIsRetrying(true);
    try {
      const res = await fetch(`/api/v2/variants/${variantId}/generate-image`, {
        method: 'POST',
      });
      if (res.ok) {
        setOptimisticGenerating(true);
        toast.success(`Image regenerating: ${label}`);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to retry image');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setIsRetrying(false);
    }
  };

  const handleSavePrompt = async (regenerate: boolean) => {
    if (!variantId || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/v2/variants/${variantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structured_prompt: {
            ...(info?.structured_prompt ?? {}),
            prompt: editText.trim(),
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to save');
      }
      if (info)
        info.structured_prompt = {
          ...(info.structured_prompt ?? {}),
          prompt: editText.trim(),
        };
      setIsEditing(false);
      toast.success('Prompt saved');
      if (regenerate) {
        void handleRetry();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className={`w-full rounded-md border ${info?.is_main ? 'border-primary/30' : 'border-border/20'} bg-muted/10 overflow-hidden`}
    >
      {/* Header row: image | name | main badge | regenerate | expand chevron */}
      <div className="flex items-center gap-2 p-1.5">
        {/* Thumbnail */}
        {url ? (
          <img
            src={url}
            alt={label}
            className="size-8 rounded shrink-0 object-cover border border-border/30"
          />
        ) : (
          <div className="size-8 rounded shrink-0 bg-muted/40 border border-border/30 flex items-center justify-center">
            <span className="text-[8px] text-muted-foreground">?</span>
          </div>
        )}

        {/* Name */}
        <span className="text-[10px] text-foreground/80 font-medium truncate flex-1 min-w-0">
          {label}
        </span>

        {/* Main / Variant badge */}
        {info?.is_main ? (
          <span className="text-[8px] px-1 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 shrink-0">
            Main
          </span>
        ) : (
          <span className="text-[8px] px-1 py-0.5 rounded bg-muted/30 text-muted-foreground border border-border/30 shrink-0">
            Variant
          </span>
        )}

        {/* Regenerate button */}
        {variantId && (
          <button
            type="button"
            onClick={() => void handleRetry()}
            disabled={isGeneratingOrRetrying}
            className="inline-flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            title={
              info?.is_main
                ? `Regenerate ${label} (text-to-image)`
                : `Regenerate ${label} (image-to-image from main)`
            }
          >
            {isGeneratingOrRetrying ? (
              <IconLoader2 className="size-2.5 animate-spin" />
            ) : (
              <IconRefresh className="size-2.5" />
            )}
          </button>
        )}

        {/* Generation specs tooltip */}
        <GenMetadataTooltip metadata={info?.generation_metadata} />

        {/* Expand/collapse chevron */}
        <button
          type="button"
          onClick={() => setIsPromptOpen(!isPromptOpen)}
          className="inline-flex items-center justify-center size-5 rounded hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Toggle prompt"
        >
          {isPromptOpen ? (
            <IconChevronUp className="size-3" />
          ) : (
            <IconChevronDown className="size-3" />
          )}
        </button>
      </div>

      {/* Expandable prompt section */}
      {isPromptOpen && (
        <div className="px-2 pb-2 pt-0.5 border-t border-border/15">
          {isEditing ? (
            <>
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full text-[10px] leading-relaxed text-foreground/80 bg-muted/30 rounded p-1.5 border border-primary/30 focus:border-primary/50 outline-none resize-y min-h-[50px]"
                rows={3}
              />
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="text-[8px] px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    isSaving ||
                    editText.trim() ===
                      flattenStructuredPrompt(info?.structured_prompt)
                  }
                  onClick={() => void handleSavePrompt(false)}
                  className="inline-flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <IconLoader2 className="size-2 animate-spin" />
                  ) : (
                    <IconDeviceFloppy className="size-2" />
                  )}
                  Save
                </button>
                <button
                  type="button"
                  disabled={isSaving || !editText.trim()}
                  onClick={() => void handleSavePrompt(true)}
                  className="inline-flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <IconLoader2 className="size-2 animate-spin" />
                  ) : (
                    <IconRefresh className="size-2" />
                  )}
                  Save &amp; Regenerate
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[9px] leading-relaxed text-foreground/70 whitespace-pre-wrap break-words">
                {flattenStructuredPrompt(info?.structured_prompt) || (
                  <span className="italic text-muted-foreground/50">
                    No prompt
                  </span>
                )}
              </p>
              <div className="flex items-center gap-1 mt-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditText(
                      flattenStructuredPrompt(info?.structured_prompt)
                    );
                    setIsEditing(true);
                  }}
                  className="inline-flex items-center gap-0.5 text-[8px] px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                  title="Edit prompt"
                >
                  <IconPencil className="size-2" />
                  Edit
                </button>
                {flattenStructuredPrompt(info?.structured_prompt) && (
                  <CopyButton
                    text={flattenStructuredPrompt(info?.structured_prompt)}
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
