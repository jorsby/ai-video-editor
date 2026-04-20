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
} from '@tabler/icons-react';
import { CopyButton } from '../../shared/copy-button';
import { ImageLightbox } from './lightbox';
import { GenerateButton } from './generation-controls';
import { AssetInspector, type AssetRole } from '../../fields';
import { Skeleton } from '@/components/ui/skeleton';

// ── Gallery Card (expandable) ──────────────────────────────────────────────────

export function GalleryCard({
  slug,
  imageMap,
  fallbackIcon: FallbackIcon,
  assetRole,
}: {
  slug: string;
  imageMap: VariantImageMap;
  fallbackIcon: React.FC<{ className?: string }>;
  assetRole: AssetRole;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
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
      ) : effectiveGenStatus === 'generating' ? (
        <Skeleton className="w-full aspect-[9/16] rounded-md" />
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
          className="flex items-center gap-1 flex-1 min-w-0 text-[10px] text-muted-foreground leading-tight hover:text-foreground hover:bg-muted/30 transition-colors rounded px-1 py-1"
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
        <div className="w-full rounded-md bg-muted/20 p-2 text-left space-y-1.5">
          {info ? (
            <AssetInspector
              id={info.id}
              role={assetRole}
              mode="variant"
              initialValue={
                (info.structured_prompt as Record<string, unknown>) ?? {}
              }
              parentFallback={info.parent_structured_prompt ?? undefined}
              onSaved={(next) => {
                info.structured_prompt = next;
              }}
              onRegenerate={handleRegenerate}
              compact
            />
          ) : (
            <p className="text-[10px] italic text-muted-foreground/50">
              No prompt
            </p>
          )}
          {flattenStructuredPrompt(info?.structured_prompt) && (
            <div className="flex justify-end pt-1">
              <CopyButton
                text={flattenStructuredPrompt(info?.structured_prompt)}
              />
            </div>
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
          <span className="text-[10px] text-muted-foreground/60">
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
  const roleConfig = {
    character: { icon: IconUser, color: 'blue', label: 'Characters' },
    location: { icon: IconMapPin, color: 'emerald', label: 'Locations' },
    prop: { icon: IconBox, color: 'amber', label: 'Props' },
  }[assetRole];

  const Icon = roleConfig.icon;

  if (slugs.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 italic">
        <Icon className="size-3" />
        <span>No {roleConfig.label.toLowerCase()} yet</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Icon className="size-3" />
        <span className="font-medium">{roleConfig.label}</span>
        <span className="opacity-50">({slugs.length})</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {slugs.map((slug) => (
          <GalleryCard
            key={slug}
            slug={slug}
            imageMap={imageMap}
            fallbackIcon={Icon}
            assetRole={assetRole}
          />
        ))}
      </div>
    </div>
  );
}
