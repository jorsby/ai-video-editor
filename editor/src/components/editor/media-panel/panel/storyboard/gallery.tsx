'use client';

import { useEffect, useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';
import {
  type VariantImageMap,
  slugToLabel,
  callGenerateApi,
  flattenStructuredPrompt,
} from '../../shared/scene-types';
import {
  IconChevronDown,
  IconChevronUp,
  IconPhoto,
  IconMapPin,
  IconUser,
  IconBox,
  IconEye,
  IconLoader2,
  IconRefresh,
  IconPencil,
  IconDeviceFloppy,
} from '@tabler/icons-react';
import { CopyButton } from '../../shared/copy-button';
import { ImageLightbox } from './lightbox';
import { GenerateButton } from './generation-controls';

function humanizeKey(key: string): string {
  const map: Record<string, string> = {
    race_ethnicity: 'Race',
    body_type: 'Build',
    time_of_day: 'Time',
    time_of_year: 'Season',
    use_case: 'Use Case',
  };
  if (map[key]) return map[key];
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function StructuredPromptGrid({
  data,
}: {
  data: Record<string, unknown> | null | undefined;
}) {
  const entries = data
    ? Object.entries(data).filter(
        ([, v]) => v != null && String(v).trim() !== ''
      )
    : [];

  if (entries.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0" title={String(value)}>
          <p className="text-[7px] text-muted-foreground/60 uppercase tracking-wider leading-none mb-0.5">
            {humanizeKey(key)}
          </p>
          <p className="text-[9px] text-foreground/70 leading-tight line-clamp-2">
            {String(value)}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Gallery Card (expandable) ──────────────────────────────────────────────────

export function GalleryCard({
  slug,
  imageMap,
  fallbackIcon: FallbackIcon,
}: {
  slug: string;
  imageMap: VariantImageMap;
  fallbackIcon: React.FC<{ className?: string }>;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [optimisticGenStatus, setOptimisticGenStatus] = useState('');
  const info = imageMap.get(slug);
  const url = info?.image_url;
  const label = slugToLabel(slug);

  // Reset optimistic state when realtime delivers the real status
  useEffect(() => {
    if (optimisticGenStatus && info?.image_gen_status) {
      setOptimisticGenStatus('');
    }
  }, [info?.image_gen_status]); // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveGenStatus =
    optimisticGenStatus || (info?.image_gen_status ?? '');

  const handleRegenerate = async () => {
    if (!info) return;
    setOptimisticGenStatus('generating');
    const result = await callGenerateApi(
      `/api/v2/variants/${info.id}/generate-image`
    );
    if (!result.ok) {
      setOptimisticGenStatus('');
      toast.error(result.error ?? 'Failed to regenerate image');
    }
  };

  const handleSavePrompt = async (regenerate: boolean) => {
    if (!info || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/v2/variants/${info.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structured_prompt: {
            ...(info.structured_prompt ?? {}),
            prompt: editText.trim(),
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Failed to save');
      }
      info.structured_prompt = {
        ...(info.structured_prompt ?? {}),
        prompt: editText.trim(),
      };
      setIsEditing(false);
      toast.success('Prompt saved');
      if (regenerate) {
        await handleRegenerate();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {/* Image */}
      {url ? (
        <>
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="w-full aspect-[9/16] rounded-md overflow-hidden border border-border/30 cursor-pointer hover:ring-2 hover:ring-primary/50 hover:brightness-110 transition-all relative group"
          >
            <img src={url} alt={label} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <IconEye className="size-4 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
            </div>
          </button>
          {lightboxOpen && (
            <ImageLightbox
              url={url}
              label={label}
              onClose={() => setLightboxOpen(false)}
            />
          )}
        </>
      ) : (
        <div className="w-full aspect-[9/16] rounded-md bg-muted/30 border border-border/30 flex items-center justify-center">
          <FallbackIcon className="size-4 text-muted-foreground/30" />
        </div>
      )}

      {/* Name + Generate button row */}
      <div className="flex items-center gap-1 w-full">
        <button
          type="button"
          onClick={() => setIsPromptOpen(!isPromptOpen)}
          className="flex items-center gap-1 flex-1 min-w-0 text-[9px] text-muted-foreground leading-tight hover:text-foreground hover:bg-muted/30 transition-colors rounded px-1 py-1"
          title="Toggle prompt"
        >
          {isPromptOpen ? (
            <IconChevronUp className="size-3 shrink-0" />
          ) : (
            <IconChevronDown className="size-3 shrink-0" />
          )}
          <span className="truncate">{label}</span>
        </button>
        {info && (
          <div className="shrink-0">
            <GenerateButton
              label="Image"
              genStatus={effectiveGenStatus}
              hasResult={!!url}
              size="md"
              onClick={() => void handleRegenerate()}
            />
          </div>
        )}
      </div>

      {/* Expandable prompt section */}
      {isPromptOpen && (
        <div className="w-full rounded-md bg-muted/20 border border-border/20 p-2 text-left">
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
              {info?.structured_prompt &&
              Object.keys(info.structured_prompt).length > 0 ? (
                <StructuredPromptGrid data={info.structured_prompt} />
              ) : (
                <p className="text-[9px] italic text-muted-foreground/50">
                  No prompt
                </p>
              )}
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

// ── Video-level Assets Section ────────────────────────────────────────────────

export function VideoAssetsSection({
  locationSlugs,
  characterSlugs,
  propSlugs,
  imageMap,
  totalAssets,
}: {
  locationSlugs: string[];
  characterSlugs: string[];
  propSlugs: string[];
  imageMap: VariantImageMap;
  totalAssets: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md bg-muted/15 border border-border/30 text-left hover:bg-muted/25 transition-colors"
        >
          <IconPhoto className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium flex-1">Video Assets</span>
          <span className="text-[9px] text-muted-foreground/60">
            {totalAssets}
          </span>
          {open ? (
            <IconChevronUp className="size-3 text-muted-foreground" />
          ) : (
            <IconChevronDown className="size-3 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-2 py-2 mt-1 bg-muted/10 rounded-md border border-border/20 space-y-3">
          <AssetGallery
            slugs={locationSlugs}
            assetRole="location"
            imageMap={imageMap}
          />
          <AssetGallery
            slugs={characterSlugs}
            assetRole="character"
            imageMap={imageMap}
          />
          <AssetGallery
            slugs={propSlugs}
            assetRole="prop"
            imageMap={imageMap}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Asset Gallery ──────────────────────────────────────────────────────────────

export function AssetGallery({
  slugs,
  assetRole,
  imageMap,
}: {
  slugs: string[];
  assetRole: 'character' | 'location' | 'prop';
  imageMap: VariantImageMap;
}) {
  if (slugs.length === 0) return null;

  const roleConfig = {
    character: { icon: IconUser, color: 'blue', label: 'Characters' },
    location: { icon: IconMapPin, color: 'emerald', label: 'Locations' },
    prop: { icon: IconBox, color: 'amber', label: 'Props' },
  }[assetRole];

  const Icon = roleConfig.icon;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Icon className="size-3" />
        <span className="font-medium">{roleConfig.label}</span>
        <span className="opacity-50">({slugs.length})</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {slugs.map((slug) => (
          <GalleryCard
            key={slug}
            slug={slug}
            imageMap={imageMap}
            fallbackIcon={Icon}
          />
        ))}
      </div>
    </div>
  );
}
