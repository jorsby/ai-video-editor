'use client';

import { useState } from 'react';
import { IconPhoto } from '@tabler/icons-react';
import { useDeleteConfirmation } from '@/contexts/delete-confirmation-context';
import { Film, Trash2 } from 'lucide-react';
import { useAssetStore } from '@/stores/asset-store';
import type { Asset } from '@/types/media';
import { useStudioStore } from '@/stores/studio-store';
import { Log } from 'openvideo';
import { VisualsChatPanel } from '../visuals-chat-panel';
import { addMediaToCanvas } from '@/lib/editor-utils';

type FilterType = 'all' | 'images' | 'videos';

export function PanelVisuals() {
  const { studio } = useStudioStore();
  const { images, videos, deleteAsset } = useAssetStore();
  const { confirm } = useDeleteConfirmation();
  const [filter, setFilter] = useState<FilterType>('all');

  // Get filtered visuals based on selection
  const getFilteredVisuals = () => {
    if (filter === 'images') return images;
    if (filter === 'videos') return videos;
    return [...images, ...videos].sort((a, b) => b.createdAt - a.createdAt);
  };

  const filteredVisuals = getFilteredVisuals();

  const handleAddToCanvas = async (asset: Asset) => {
    if (!studio) return;

    try {
      await addMediaToCanvas(studio, {
        url: asset.url,
        type: asset.type as 'image' | 'video',
      });
    } catch (error) {
      Log.error(`Failed to add ${asset.type}:`, error);
    }
  };

  const handleDelete = async (asset: Asset) => {
    const confirmed = await confirm({
      title: 'Delete Visual',
      description:
        'Are you sure you want to delete this visual? This action cannot be undone.',
    });

    if (confirmed) {
      try {
        await deleteAsset(asset.id, asset.type);
      } catch (error) {
        console.error('Failed to delete asset:', error);
      }
    }
  };

  return (
    <div className="flex flex-col h-full w-full">
      {/* Filter chips */}
      <div className="flex gap-1.5 px-4 py-2 border-b border-border/50">
        {(['all', 'images', 'videos'] as FilterType[]).map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filter === type
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredVisuals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-4 gap-4">
            <IconPhoto className="size-7 text-muted-foreground" stroke={1.5} />
            <div className="flex flex-col gap-2 text-center">
              <p className="font-semibold text-white">No Visual Assets</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Start building your collection by clicking the generate button
                in the chat panel.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
              {filteredVisuals.map((asset) => (
                <div
                  key={asset.id}
                  className="group relative aspect-square rounded-md overflow-hidden bg-secondary/50 cursor-pointer border border-transparent hover:border-primary/50 transition-all"
                  onClick={() => handleAddToCanvas(asset)}
                >
                  {asset.type === 'image' ? (
                    <img
                      src={asset.url}
                      alt={asset.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-black/20">
                      <video
                        src={asset.url}
                        className="w-full h-full object-cover pointer-events-none"
                      />
                      <Film
                        className="absolute text-white/70 drop-shadow-md"
                        size={24}
                      />
                    </div>
                  )}

                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(asset);
                    }}
                    className="absolute top-1 right-1 p-1 rounded bg-black/50 opacity-0 group-hover:opacity-100 hover:bg-red-500/80 transition-all"
                  >
                    <Trash2 size={14} className="text-white" />
                  </button>

                  {/* Overlay info */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-[10px] text-white truncate font-medium">
                      {asset.name}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="h-2 bg-background"></div>
      <div className="h-48">
        <VisualsChatPanel />
      </div>
    </div>
  );
}
