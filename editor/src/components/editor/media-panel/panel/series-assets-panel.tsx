'use client';

import { useMemo, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useProjectId } from '@/contexts/project-context';
import {
  type SeriesAsset,
  type SeriesAssetVariant,
  useSeriesAssets,
} from '@/hooks/use-series-assets';
import {
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconLayoutGrid,
  IconList,
  IconLoader2,
  IconMapPin,
  IconMaximize,
  IconPackage,
  IconRefresh,
  IconUsers,
} from '@tabler/icons-react';
import { toast } from 'sonner';

type AssetType = 'character' | 'location' | 'prop';
type ViewMode = 'list' | 'grid';

const SECTION_CONFIG: Record<
  AssetType,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  character: { label: 'Characters', icon: IconUsers },
  location: { label: 'Locations', icon: IconMapPin },
  prop: { label: 'Props', icon: IconPackage },
};

function getAssetEmoji(type: AssetType): string {
  return type === 'character' ? '👤' : type === 'location' ? '🏠' : '📦';
}

function SlugBadge({ slug }: { slug: string }) {
  return (
    <code className="text-[9px] px-1.5 py-0.5 rounded bg-muted/40 border border-border/30 text-muted-foreground font-mono">
      {slug}
    </code>
  );
}

function DetailRow({
  label,
  children,
}: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wider w-16 shrink-0 pt-0.5">
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function VariantCard({ variant }: { variant: SeriesAssetVariant }) {
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <>
      <div className="rounded-md border border-border/30 bg-muted/10 overflow-hidden">
        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/20">
          {variant.imageUrl ? (
            <div className="relative group/thumb shrink-0">
              <img
                src={variant.imageUrl}
                alt={variant.label}
                className="size-7 rounded object-cover border border-border/30"
              />
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="absolute inset-0 flex items-center justify-center bg-black/50 rounded opacity-0 group-hover/thumb:opacity-100 transition-opacity"
              >
                <IconMaximize size={10} className="text-white" />
              </button>
            </div>
          ) : (
            <div className="size-7 rounded bg-muted/30 border border-border/30 shrink-0 flex items-center justify-center text-[9px] text-muted-foreground">
              —
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium truncate">
                {variant.label}
              </span>
              {variant.isMain && (
                <Badge
                  variant="secondary"
                  className="text-[7px] px-1 py-0 h-3"
                >
                  Main
                </Badge>
              )}
              {variant.isFinalized && (
                <Badge
                  variant="outline"
                  className="text-[7px] px-1 py-0 h-3 border-emerald-500/40"
                >
                  Locked
                </Badge>
              )}
            </div>
            <SlugBadge slug={variant.slug} />
          </div>
        </div>

        {(variant.prompt || variant.whereToUse || variant.reasoning) && (
          <div className="px-2.5 py-1.5 space-y-1 border-t border-border/20">
            {variant.prompt && (
              <DetailRow label="Prompt">
                <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-3">
                  {variant.prompt}
                </p>
              </DetailRow>
            )}
            {variant.whereToUse && (
              <DetailRow label="Where">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {variant.whereToUse}
                </p>
              </DetailRow>
            )}
            {variant.reasoning && (
              <DetailRow label="Notes">
                <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                  {variant.reasoning}
                </p>
              </DetailRow>
            )}
          </div>
        )}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 sm:p-4 bg-black/90 border-white/10">
          <DialogTitle className="sr-only">{variant.label}</DialogTitle>
          {variant.imageUrl && (
            <img
              src={variant.imageUrl}
              alt={variant.label}
              className="w-full h-auto max-h-[80vh] object-contain rounded"
            />
          )}
          <div className="text-center mt-2">
            <p className="text-sm font-medium text-white">{variant.label}</p>
            <p className="text-xs text-white/60 font-mono">{variant.slug}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AssetCard({
  asset,
  viewMode,
  thumbSize = 40,
}: {
  asset: SeriesAsset;
  viewMode: ViewMode;
  thumbSize?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const description = asset.description?.trim() || 'No description yet';
  const imageUrl =
    asset.thumbnailUrl ||
    asset.variants.find((v) => v.imageUrl)?.imageUrl ||
    null;
  const emoji = getAssetEmoji(asset.type);

  if (viewMode === 'grid') {
    return (
      <>
        <div className="group/asset relative rounded-md overflow-hidden border border-border/40 bg-muted/10 hover:bg-muted/20 transition-colors">
          <div className="relative aspect-square">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={asset.name}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-2xl">
                {emoji}
              </div>
            )}
            {imageUrl && (
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover/asset:opacity-100 transition-opacity hover:bg-black/80"
                title="Expand"
              >
                <IconMaximize size={12} />
              </button>
            )}
            {asset.variants.some((v) => v.isFinalized) && (
              <div className="absolute top-1 left-1">
                <Badge
                  variant="outline"
                  className="text-[7px] px-1 py-0 h-3 border-emerald-500/40 bg-black/50 text-emerald-400"
                >
                  Finalized
                </Badge>
              </div>
            )}
          </div>
          <div className="p-1.5 space-y-0.5">
            <p className="text-[10px] font-medium truncate">{asset.name}</p>
            {asset.slug && <SlugBadge slug={asset.slug} />}
            <p className="text-[9px] text-muted-foreground line-clamp-1">
              {description}
            </p>
          </div>
        </div>
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 sm:p-4 bg-black/90 border-white/10">
            <DialogTitle className="sr-only">{asset.name}</DialogTitle>
            {imageUrl && (
              <img
                src={imageUrl}
                alt={asset.name}
                className="w-full h-auto max-h-[80vh] object-contain rounded"
              />
            )}
            <div className="text-center mt-2">
              <p className="text-sm font-medium text-white">{asset.name}</p>
              {asset.slug && (
                <p className="text-xs text-white/50 font-mono">{asset.slug}</p>
              )}
              <p className="text-xs text-white/60">{description}</p>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // List mode
  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full border border-border/40 rounded-md px-2.5 py-2 text-left hover:bg-muted/20 transition-colors"
        >
          <div className="flex items-center gap-2">
            {imageUrl ? (
              <div className="relative group/thumb shrink-0">
                <img
                  src={imageUrl}
                  alt={`${asset.name} reference`}
                  className="size-10 rounded object-cover border border-border/30"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewOpen(true);
                  }}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 rounded opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                >
                  <IconMaximize size={12} className="text-white" />
                </button>
              </div>
            ) : (
              <div className="size-10 rounded border border-border/30 bg-muted/30 shrink-0 flex items-center justify-center text-sm">
                {emoji}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-xs font-medium truncate">{asset.name}</p>
                {asset.slug && <SlugBadge slug={asset.slug} />}
                {asset.variants.some((v) => v.isFinalized) && (
                  <Badge
                    variant="outline"
                    className="text-[7px] px-1 py-0 h-3 border-emerald-500/40 shrink-0"
                  >
                    Finalized
                  </Badge>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground line-clamp-1">
                {description}
              </p>
              <p className="text-[9px] text-muted-foreground/60">
                {asset.variants.length} variant
                {asset.variants.length !== 1 ? 's' : ''}
              </p>
            </div>

            {isExpanded ? (
              <IconChevronUp className="size-3.5 text-muted-foreground shrink-0" />
            ) : (
              <IconChevronDown className="size-3.5 text-muted-foreground shrink-0" />
            )}
          </div>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-2.5 pt-1.5 pb-2 space-y-2">
          {/* Description */}
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {description}
          </p>

          {/* Variants */}
          {asset.variants.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">
                Variants
              </p>
              {asset.variants.map((variant) => (
                <VariantCard key={variant.id} variant={variant} />
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 sm:p-4 bg-black/90 border-white/10">
          <DialogTitle className="sr-only">{asset.name}</DialogTitle>
          {imageUrl && (
            <img
              src={imageUrl}
              alt={asset.name}
              className="w-full h-auto max-h-[80vh] object-contain rounded"
            />
          )}
          <div className="text-center mt-2">
            <p className="text-sm font-medium text-white">{asset.name}</p>
            {asset.slug && (
              <p className="text-xs text-white/50 font-mono">{asset.slug}</p>
            )}
            <p className="text-xs text-white/60">{description}</p>
          </div>
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}

function AssetSection({
  type,
  assets,
  viewMode,
  cardMinWidth,
  gridPrompt,
  onGridPromptChange,
  onSavePrompt,
  onGenerateGrid,
  savingPrompt,
  generating,
  status,
}: {
  type: AssetType;
  assets: SeriesAsset[];
  viewMode: ViewMode;
  cardMinWidth: number;
  gridPrompt: string;
  onGridPromptChange: (value: string) => void;
  onSavePrompt: () => Promise<void>;
  onGenerateGrid: () => Promise<void>;
  savingPrompt: boolean;
  generating: boolean;
  status: { pending: number; completed: number; stale: number };
}) {
  const config = SECTION_CONFIG[type];
  const [isOpen, setIsOpen] = useState(true);
  const [isGridPromptOpen, setIsGridPromptOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center gap-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex-1 flex items-center gap-2 px-1 py-1 rounded-sm hover:bg-muted/20 transition-colors text-left"
          >
            {isOpen ? (
              <IconChevronDown className="size-3.5 text-muted-foreground" />
            ) : (
              <IconChevronRight className="size-3.5 text-muted-foreground" />
            )}
            <config.icon className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">{config.label}</span>
            <span className="text-[10px] text-muted-foreground">
              ({assets.length})
            </span>
            {status.pending > 0 && (
              <Badge
                variant="secondary"
                className="text-[8px] px-1 py-0 h-3.5 shrink-0"
              >
                Generating {status.pending}
              </Badge>
            )}
            {status.stale > 0 && (
              <Badge
                variant="destructive"
                className="text-[8px] px-1 py-0 h-3.5 shrink-0"
              >
                Retry {status.stale}
              </Badge>
            )}
          </button>
        </CollapsibleTrigger>

        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px] gap-1 px-2"
          onClick={onGenerateGrid}
          disabled={generating || assets.length < 1}
        >
          {generating || status.pending > 0 ? (
            <IconLoader2 className="size-3 animate-spin" />
          ) : (
            <IconRefresh className="size-3" />
          )}
          {status.pending > 0 ? 'Generating...' : 'Generate Images'}
        </Button>
      </div>

      <CollapsibleContent>
        <div className="pl-5 pr-1 space-y-1.5">
          <Collapsible
            open={isGridPromptOpen}
            onOpenChange={setIsGridPromptOpen}
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center gap-1 px-1 py-1 text-[10px] text-muted-foreground hover:text-foreground rounded-sm hover:bg-muted/20 transition-colors"
              >
                {isGridPromptOpen ? (
                  <IconChevronDown className="size-3" />
                ) : (
                  <IconChevronRight className="size-3" />
                )}
                <IconLayoutGrid className="size-3" />
                Style Prompt
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-1.5 pl-2">
                <Textarea
                  value={gridPrompt}
                  onChange={(event) => onGridPromptChange(event.target.value)}
                  rows={4}
                  className="text-[10px] min-h-[80px]"
                  placeholder={`Style prompt for ${config.label.toLowerCase()}...`}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-[10px] gap-1"
                  onClick={onSavePrompt}
                  disabled={savingPrompt}
                >
                  {savingPrompt ? (
                    <IconLoader2 className="size-3 animate-spin" />
                  ) : null}
                  Save Prompt
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {assets.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/70 pb-1">
              No {config.label.toLowerCase()} yet.
            </p>
          ) : viewMode === 'grid' ? (
            <div
              className="grid gap-2"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth}px, 1fr))`,
              }}
            >
              {assets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  viewMode="grid"
                  thumbSize={cardMinWidth}
                />
              ))}
            </div>
          ) : (
            assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                viewMode="list"
                thumbSize={cardMinWidth}
              />
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function SeriesAssetsPanel() {
  const projectId = useProjectId();
  const {
    isLoading,
    error,
    assets,
    seriesId,
    gridPrompts,
    isSavingPrompt,
    isGeneratingGrid,
    generationStatus,
    setGridPrompt,
    saveGridPrompt,
    generateGrid,
  } = useSeriesAssets(projectId);

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [cardMinWidth, setCardMinWidth] = useState(120);

  const groupedAssets = useMemo(() => {
    return {
      character: assets.filter((asset) => asset.type === 'character'),
      location: assets.filter((asset) => asset.type === 'location'),
      prop: assets.filter((asset) => asset.type === 'prop'),
    };
  }, [assets]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-xs text-muted-foreground animate-pulse">
          Loading project assets...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-xs text-destructive text-center">{error}</p>
      </div>
    );
  }

  if (!seriesId) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center">
        <p className="text-xs text-muted-foreground">
          This project is not linked to a series yet.
        </p>
        <p className="text-[10px] text-muted-foreground/70 mt-1">
          Link a series to load shared characters, locations, and props.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-2.5">
        {/* View controls */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-md overflow-hidden border">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`h-7 px-2 text-xs transition-colors ${
                viewMode === 'list'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-accent text-muted-foreground'
              }`}
              title="List view"
            >
              <IconList size={14} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`h-7 px-2 text-xs transition-colors ${
                viewMode === 'grid'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-accent text-muted-foreground'
              }`}
              title="Grid view"
            >
              <IconLayoutGrid size={14} />
            </button>
          </div>
          {viewMode === 'grid' && (
            <Slider
              value={[cardMinWidth]}
              onValueChange={([v]) => setCardMinWidth(v)}
              min={80}
              max={250}
              step={10}
              className="flex-1"
            />
          )}
        </div>

        {(['character', 'location', 'prop'] as const).map((type) => (
          <AssetSection
            key={type}
            type={type}
            assets={groupedAssets[type]}
            viewMode={viewMode}
            cardMinWidth={cardMinWidth}
            gridPrompt={gridPrompts[type]}
            onGridPromptChange={(value) => setGridPrompt(type, value)}
            onSavePrompt={async () => {
              const result = await saveGridPrompt(type);
              if (!result.ok) {
                toast.error(result.error ?? 'Failed to save prompt');
                return;
              }
              toast.success(`${SECTION_CONFIG[type].label} prompt saved`);
            }}
            onGenerateGrid={async () => {
              const result = await generateGrid(type);
              if (!result.ok) {
                toast.error(result.error ?? 'Failed to generate images');
                return;
              }
              toast.success(
                `${SECTION_CONFIG[type].label} image generation started`
              );
            }}
            savingPrompt={isSavingPrompt[type]}
            generating={isGeneratingGrid[type]}
            status={generationStatus[type]}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
