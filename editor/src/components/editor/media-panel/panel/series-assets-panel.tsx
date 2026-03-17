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
  IconChevronUp,
  IconChevronRight,
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
    defaultGridPrompt: string;
  }
> = {
  character: {
    label: 'Characters',
    icon: IconUsers,
    defaultGridPrompt:
      'Photorealistic cinematic style with natural skin texture. Each cell shows one character on a neutral white background, front-facing, full body visible from head to shoes. Each character must show their complete outfit clearly visible.',
  },
  location: {
    label: 'Locations',
    icon: IconMapPin,
    defaultGridPrompt:
      'Photorealistic cinematic style. Each cell shows one empty environment/location with no people, with varied cinematic camera angles. Locations should feel lived-in and atmospheric with natural lighting and environmental details.',
  },
  prop: {
    label: 'Props',
    icon: IconPackage,
    defaultGridPrompt:
      'Product photography style. Each cell shows one object/prop on a clean neutral background. Centered composition, studio lighting, high detail.',
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
              {asset.variants.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 px-2 py-1 rounded bg-muted/20 border border-border/30"
                >
                  {v.imageUrl ? (
                    <img
                      src={v.imageUrl}
                      alt={v.label}
                      className="size-6 rounded object-cover border border-border/30 shrink-0"
                    />
                  ) : (
                    <div className="size-6 rounded bg-muted/30 shrink-0" />
                  )}
                  <span className="text-[10px] flex-1 truncate">{v.label}</span>
                  {v.isDefault && (
                    <Badge
                      variant="secondary"
                      className="text-[7px] px-1 py-0 h-3"
                    >
                      Default
                    </Badge>
                  )}
                  {v.isFinalized && (
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
  seriesId,
  onRefresh,
}: {
  type: AssetType;
  assets: SeriesAsset[];
  seriesId: string;
  onRefresh: () => void;
}) {
  const config = SECTION_CONFIG[type];
  const [isOpen, setIsOpen] = useState(true);
  const [showGridPrompt, setShowGridPrompt] = useState(false);
  const [gridPrompt, setGridPrompt] = useState(config.defaultGridPrompt);
  const [generating, setGenerating] = useState(false);

  const handleGenerateGrid = async () => {
    if (assets.length < 2) {
      toast.error(
        `Need at least 2 ${config.label.toLowerCase()} to generate a grid`
      );
      return;
    }

    const hasFinalized = assets.some((a) =>
      a.variants.some((v) => v.isFinalized)
    );
    if (hasFinalized) {
      toast.error('Cannot regenerate — some assets are finalized');
      return;
    }

    const gridSize =
      assets.length <= 4 ? { cols: 2, rows: 2 } : { cols: 3, rows: 3 };
    const items = assets.slice(0, gridSize.cols * gridSize.rows).map((a) => ({
      asset_id: a.id,
      variant_id: a.variants.find((v) => v.isDefault)?.id ?? a.variants[0]?.id,
    }));

    if (items.some((i) => !i.variant_id)) {
      toast.error('Some assets are missing variants');
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch(`/api/series/${seriesId}/generate-grid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          items,
          grid: {
            cols: gridSize.cols,
            rows: gridSize.rows,
            cell_ratio: '1:1',
            resolution: '4K',
          },
          custom_suffix: gridPrompt,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Grid generation failed');
      }

      toast.success(`${config.label} grid generation started`);
      // Poll will handle the rest
      setTimeout(onRefresh, 60000);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Grid generation failed'
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-1 py-1 rounded-sm hover:bg-muted/20 transition-colors text-left"
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

      <CollapsibleContent>
        <div className="pl-5 pr-1 space-y-1.5">
          {assets.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/70 pb-1">
              No {config.label.toLowerCase()} yet.
            </p>
          ) : (
            <>
              {assets.map((asset) => (
                <AssetCard key={asset.id} asset={asset} />
              ))}

              {/* Grid generation controls */}
              <div className="pt-1 space-y-1.5">
                <button
                  type="button"
                  onClick={() => setShowGridPrompt(!showGridPrompt)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <IconLayoutGrid className="size-3" />
                  {showGridPrompt ? 'Hide' : 'Grid'} Prompt
                </button>

                {showGridPrompt && (
                  <div className="space-y-1.5">
                    <Textarea
                      value={gridPrompt}
                      onChange={(e) => setGridPrompt(e.target.value)}
                      rows={3}
                      className="text-[10px] min-h-[60px]"
                      placeholder={`Grid prompt for ${config.label.toLowerCase()}...`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full h-7 text-[10px] gap-1"
                      onClick={handleGenerateGrid}
                      disabled={generating || assets.length < 2}
                    >
                      {generating ? (
                        <IconLoader2 className="size-3 animate-spin" />
                      ) : (
                        <IconRefresh className="size-3" />
                      )}
                      {generating
                        ? 'Generating...'
                        : `Generate ${assets.length <= 4 ? '2×2' : '3×3'} Grid`}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function SeriesAssetsPanel() {
  const projectId = useProjectId();
  const { isLoading, error, assets, seriesId, refresh } =
    useSeriesAssets(projectId);

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
            seriesId={seriesId}
            onRefresh={refresh}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
