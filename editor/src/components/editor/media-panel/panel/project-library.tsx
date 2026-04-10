'use client';

import { useEffect, useState, useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  IconUsers,
  IconMapPin,
  IconPackage,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';
import { useProjectId } from '@/contexts/project-context';
import { createClient } from '@/lib/supabase/client';

interface VariantImage {
  id: string;
  url: string | null;
  metadata?: Record<string, unknown>;
}

interface Variant {
  id: string;
  label: string;
  description: string | null;
  is_main: boolean;
  is_finalized: boolean;
  project_asset_variant_images: VariantImage[];
}

interface Asset {
  id: string;
  type: 'character' | 'location' | 'prop';
  name: string;
  description: string | null;
  project_asset_variants: Variant[];
}

interface VideoInfo {
  id: string;
  name: string;
  genre: string | null;
  tone: string | null;
  project_assets: Asset[];
}

const ASSET_TYPE_CONFIG = {
  character: { label: 'Characters', icon: IconUsers },
  location: { label: 'Locations', icon: IconMapPin },
  prop: { label: 'Props', icon: IconPackage },
} as const;

function AssetItem({ asset }: { asset: Asset }) {
  const [expanded, setExpanded] = useState(false);
  const mainVariant = asset.project_asset_variants.find((v) => v.is_main);
  const heroImage =
    mainVariant?.project_asset_variant_images?.[0] ??
    asset.project_asset_variants.flatMap(
      (v) => v.project_asset_variant_images ?? []
    )?.[0];

  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        {heroImage?.url ? (
          // biome-ignore lint/a11y/useAltText: asset thumb
          <img
            src={heroImage.url}
            className="w-8 h-8 rounded object-cover border border-border/30 shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded bg-muted/40 border border-border/30 shrink-0 flex items-center justify-center text-xs opacity-40">
            {asset.type === 'character'
              ? '👤'
              : asset.type === 'location'
                ? '🏠'
                : '📦'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{asset.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {asset.project_asset_variants.length} variant
            {asset.project_asset_variants.length !== 1 ? 's' : ''}
          </p>
        </div>
        {expanded ? (
          <IconChevronUp className="size-3.5 text-muted-foreground shrink-0" />
        ) : (
          <IconChevronDown className="size-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-1.5">
          {asset.description && (
            <p className="text-[10px] text-muted-foreground line-clamp-2">
              {asset.description}
            </p>
          )}
          {asset.project_asset_variants.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-2 px-2 py-1 rounded bg-muted/20 border border-border/30"
            >
              {v.project_asset_variant_images?.[0]?.url ? (
                // biome-ignore lint/a11y/useAltText: variant thumb
                <img
                  src={v.project_asset_variant_images[0].url}
                  className="w-6 h-6 rounded object-cover border border-border/30 shrink-0"
                />
              ) : (
                <div className="w-6 h-6 rounded bg-muted/30 shrink-0" />
              )}
              <span className="text-[10px] flex-1 truncate">{v.label}</span>
              {v.is_main && (
                <Badge
                  variant="secondary"
                  className="text-[8px] px-1 py-0 h-3.5"
                >
                  Main
                </Badge>
              )}
              {v.is_finalized && (
                <Badge
                  variant="outline"
                  className="text-[8px] px-1 py-0 h-3.5 border-emerald-500/40"
                >
                  Finalized
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PanelProjectLibrary() {
  const projectId = useProjectId();
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;

    const fetchVideoForProject = async () => {
      setLoading(true);
      setError(null);
      try {
        // Find the video linked to this project
        const supabase = createClient('studio');
        const { data: linkedVideo } = await supabase
          .from('videos')
          .select('id')
          .eq('project_id', projectId)
          .limit(1)
          .maybeSingle();

        const videoId = linkedVideo?.id as string | undefined;

        if (!videoId) {
          // Standalone project — no video
          setVideoInfo(null);
          setLoading(false);
          return;
        }

        // Fetch video with assets
        const videoRes = await fetch(`/api/videos/${videoId}`);
        if (!videoRes.ok) {
          setError('Video not found');
          setLoading(false);
          return;
        }
        const videoData = await videoRes.json();
        setVideoInfo(videoData.video);
      } catch {
        setError('Failed to load video');
      } finally {
        setLoading(false);
      }
    };

    fetchVideoForProject();
  }, [projectId]);

  const assetsByType = useMemo(() => {
    if (!videoInfo) return null;
    const grouped: Record<string, Asset[]> = {};
    for (const asset of videoInfo.project_assets ?? []) {
      if (!grouped[asset.type]) grouped[asset.type] = [];
      grouped[asset.type].push(asset);
    }
    return grouped;
  }, [videoInfo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-xs text-muted-foreground animate-pulse">
          Loading library...
        </p>
      </div>
    );
  }

  if (!videoInfo) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <p className="text-xs text-muted-foreground">
          This project is not linked to a video.
        </p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">
          Create or link a video to see characters, locations, and props here.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-xs text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-4">
        {/* Video header */}
        <div>
          <p className="text-sm font-medium">{videoInfo.name}</p>
          <div className="flex gap-1 mt-0.5">
            {videoInfo.genre && (
              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">
                {videoInfo.genre}
              </Badge>
            )}
            {videoInfo.tone && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                {videoInfo.tone}
              </Badge>
            )}
          </div>
        </div>

        {/* Asset sections */}
        {(['character', 'location', 'prop'] as const).map((type) => {
          const config = ASSET_TYPE_CONFIG[type];
          const assets = assetsByType?.[type] ?? [];
          return (
            <div key={type} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <config.icon className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">{config.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  ({assets.length})
                </span>
              </div>
              {assets.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/50 pl-5">
                  No {config.label.toLowerCase()} yet
                </p>
              ) : (
                <div className="space-y-1">
                  {assets.map((asset) => (
                    <AssetItem key={asset.id} asset={asset} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
