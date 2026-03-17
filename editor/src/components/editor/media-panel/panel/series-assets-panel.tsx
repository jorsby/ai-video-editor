'use client';

import { useMemo, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useProjectId } from '@/contexts/project-context';
import { type SeriesAsset, useSeriesAssets } from '@/hooks/use-series-assets';
import {
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconLayoutGrid,
  IconLoader2,
  IconMapPin,
  IconPackage,
  IconRefresh,
  IconUsers,
} from '@tabler/icons-react';
import { toast } from 'sonner';

type AssetType = 'character' | 'location' | 'prop';

const SECTION_CONFIG: Record<
  AssetType,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  character: {
    label: 'Characters',
    icon: IconUsers,
  },
  location: {
    label: 'Locations',
    icon: IconMapPin,
  },
  prop: {
    label: 'Props',
    icon: IconPackage,
  },
};

function AssetCard({ asset }: { asset: SeriesAsset }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const description = asset.description?.trim() || 'No description yet';

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full border border-border/40 rounded-md px-2.5 py-2 text-left hover:bg-muted/20 transition-colors"
        >
          <div className="flex items-center gap-2">
            {asset.thumbnailUrl ? (
              <img
                src={asset.thumbnailUrl}
                alt={`${asset.name} reference`}
                className="size-10 rounded object-cover border border-border/30 shrink-0"
              />
            ) : (
              <div className="size-10 rounded border border-border/30 bg-muted/30 shrink-0 flex items-center justify-center text-sm">
                {asset.type === 'character'
                  ? '👤'
                  : asset.type === 'location'
                    ? '🏠'
                    : '📦'}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-medium truncate">{asset.name}</p>
                {asset.variants.some((variant) => variant.isFinalized) && (
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
        <div className="px-2.5 pt-1 pb-2 space-y-1.5">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {description}
          </p>
          {asset.variants.length > 0 && (
            <div className="space-y-1">
              {asset.variants.map((variant) => (
                <div
                  key={variant.id}
                  className="flex items-center gap-2 px-2 py-1 rounded bg-muted/20 border border-border/30"
                >
                  {variant.imageUrl ? (
                    <img
                      src={variant.imageUrl}
                      alt={variant.label}
                      className="size-6 rounded object-cover border border-border/30 shrink-0"
                    />
                  ) : (
                    <div className="size-6 rounded bg-muted/30 shrink-0" />
                  )}
                  <span className="text-[10px] flex-1 truncate">
                    {variant.label}
                  </span>
                  {variant.isDefault && (
                    <Badge
                      variant="secondary"
                      className="text-[7px] px-1 py-0 h-3"
                    >
                      Default
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
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AssetSection({
  type,
  assets,
  gridPrompt,
  onGridPromptChange,
  onSavePrompt,
  onGenerateGrid,
  savingPrompt,
  generating,
}: {
  type: AssetType;
  assets: SeriesAsset[];
  gridPrompt: string;
  onGridPromptChange: (value: string) => void;
  onSavePrompt: () => Promise<void>;
  onGenerateGrid: () => Promise<void>;
  savingPrompt: boolean;
  generating: boolean;
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
          </button>
        </CollapsibleTrigger>

        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px] gap-1 px-2"
          onClick={onGenerateGrid}
          disabled={generating || assets.length < 2}
        >
          {generating ? (
            <IconLoader2 className="size-3 animate-spin" />
          ) : (
            <IconRefresh className="size-3" />
          )}
          Generate Grid
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
                Grid Prompt
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-1.5 pl-2">
                <Textarea
                  value={gridPrompt}
                  onChange={(event) => onGridPromptChange(event.target.value)}
                  rows={4}
                  className="text-[10px] min-h-[80px]"
                  placeholder={`Grid prompt for ${config.label.toLowerCase()}...`}
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
          ) : (
            assets.map((asset) => <AssetCard key={asset.id} asset={asset} />)
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
    setGridPrompt,
    saveGridPrompt,
    generateGrid,
  } = useSeriesAssets(projectId);

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
        {(['character', 'location', 'prop'] as const).map((type) => (
          <AssetSection
            key={type}
            type={type}
            assets={groupedAssets[type]}
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
                toast.error(result.error ?? 'Failed to generate grid');
                return;
              }

              toast.success(
                `${SECTION_CONFIG[type].label} grid generation started`
              );
            }}
            savingPrompt={isSavingPrompt[type]}
            generating={isGeneratingGrid[type]}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
