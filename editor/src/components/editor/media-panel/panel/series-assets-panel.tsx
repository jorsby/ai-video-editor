'use client';

import { useMemo, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  IconMapPin,
  IconPackage,
  IconUsers,
} from '@tabler/icons-react';

type AssetType = 'character' | 'location' | 'prop';

const SECTION_CONFIG: Record<
  AssetType,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  character: { label: 'Characters', icon: IconUsers },
  location: { label: 'Locations', icon: IconMapPin },
  prop: { label: 'Props', icon: IconPackage },
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
              <p className="text-xs font-medium truncate">{asset.name}</p>
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
        <p className="px-2.5 pt-1 pb-2 text-[11px] text-muted-foreground leading-relaxed">
          {description}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function SeriesAssetsPanel() {
  const projectId = useProjectId();
  const { isLoading, error, assets, seriesId } = useSeriesAssets(projectId);

  const [openSections, setOpenSections] = useState<Record<AssetType, boolean>>({
    character: true,
    location: true,
    prop: true,
  });

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
        {(['character', 'location', 'prop'] as const).map((type) => {
          const section = SECTION_CONFIG[type];
          const sectionAssets = groupedAssets[type];
          const isOpen = openSections[type];

          return (
            <Collapsible
              key={type}
              open={isOpen}
              onOpenChange={(open) =>
                setOpenSections((prev) => ({ ...prev, [type]: open }))
              }
            >
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
                  <section.icon className="size-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">{section.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    ({sectionAssets.length})
                  </span>
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent>
                {sectionAssets.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/70 pl-6 pb-1">
                    No {section.label.toLowerCase()} yet.
                  </p>
                ) : (
                  <div className="pl-5 pr-1 space-y-1.5">
                    {sectionAssets.map((asset) => (
                      <AssetCard key={asset.id} asset={asset} />
                    ))}
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </ScrollArea>
  );
}
