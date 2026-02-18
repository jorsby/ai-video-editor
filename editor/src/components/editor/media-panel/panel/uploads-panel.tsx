'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDeleteConfirmation } from '@/contexts/delete-confirmation-context';
import { useStudioStore } from '@/stores/studio-store';
import { useAssetStore } from '@/stores/asset-store';
import type { Asset } from '@/types/media';
import { Log } from 'openvideo';
import {
  Upload,
  Search,
  Image as ImageIcon,
  Film,
  ChevronDown,
  Trash2,
} from 'lucide-react';
import { uploadFile } from '@/lib/upload-utils';
import { useProjectId } from '@/contexts/project-context';
import { addMediaToCanvas } from '@/lib/editor-utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';

type FilterTab = 'all' | 'images' | 'videos';

export function PanelUploads() {
  const { studio } = useStudioStore();
  const projectId = useProjectId();
  const { uploads, addAsset, deleteAsset } = useAssetStore();
  const { confirm } = useDeleteConfirmation();

  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const result = await uploadFile(file);
      const _mediaType = file.type.startsWith('video/') ? 'video' : 'image';

      // Save to Supabase
      const saveResponse = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'upload',
          url: result.url,
          name: result.fileName,
          size: file.size,
          project_id: projectId,
        }),
      });

      if (!saveResponse.ok) {
        throw new Error('Failed to save upload to database');
      }

      const { asset: savedAsset } = await saveResponse.json();

      // Add to local store
      const newAsset: Asset = {
        id: savedAsset.id,
        type: 'upload',
        url: result.url,
        name: result.fileName,
        size: file.size,
        createdAt: Date.now(),
      };

      addAsset(newAsset);
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAddToCanvas = async (asset: Asset) => {
    if (!studio) return;

    // Determine media type from filename for uploads
    const isVideo = asset.name.match(/\.(mp4|webm|mov|avi)$/i);
    const mediaType = isVideo ? 'video' : 'image';

    try {
      await addMediaToCanvas(studio, { url: asset.url, type: mediaType });
    } catch (error) {
      Log.error(`Failed to add ${mediaType}:`, error);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: 'Delete Upload',
      description:
        'Are you sure you want to delete this upload? This action cannot be undone.',
    });

    if (confirmed) {
      try {
        await deleteAsset(id, 'upload');
      } catch (error) {
        console.error('Failed to delete upload:', error);
      }
    }
  };

  // Helper to determine if asset is video based on filename
  const isVideoAsset = (asset: Asset) => {
    return asset.name.match(/\.(mp4|webm|mov|avi)$/i);
  };

  const filteredAssets = uploads.filter((asset) => {
    const matchesSearch = asset.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());

    const isVideo = isVideoAsset(asset);
    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'images' && !isVideo) ||
      (activeTab === 'videos' && isVideo);

    return matchesSearch && matchesTab;
  });

  return (
    <div className="flex flex-col h-full w-full">
      {/* Header / Toolbar */}
      <div className="flex items-center bg-panel gap-2 p-4 border-b border-border/50">
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          size={'sm'}
        >
          <Upload size={14} />
          <span className="text-xs font-medium">
            {isUploading ? 'Uploading...' : 'Upload'}
          </span>
        </Button>
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*,video/*,audio/*"
          onChange={handleFileUpload}
        />

        <div className="flex-1">
          <InputGroup className="h-8">
            <InputGroupAddon className="bg-secondary/30 pointer-events-none text-muted-foreground w-8 justify-center">
              <Search size={14} />
            </InputGroupAddon>

            <InputGroupInput
              placeholder="Search..."
              className="bg-secondary/30 border-0 h-full text-xs box-border pl-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </InputGroup>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size={'sm'}>
              {activeTab === 'all'
                ? 'All'
                : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
              <ChevronDown size={10} className="opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setActiveTab('all')}>
              All Uploads
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab('images')}>
              Images
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setActiveTab('videos')}>
              Videos
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Grid Content */}
      <ScrollArea className="flex-1 p-4 h-full">
        {filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
            <ImageIcon size={32} className="opacity-50" />
            <span className="text-sm">No uploads found</span>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
            {filteredAssets.map((asset) => {
              const isVideo = isVideoAsset(asset);
              return (
                <div
                  key={asset.id}
                  className="group relative aspect-square rounded-md overflow-hidden bg-secondary/50 cursor-pointer border border-transparent hover:border-primary/50 transition-all"
                  onClick={() => handleAddToCanvas(asset)}
                >
                  {!isVideo ? (
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
                      handleDelete(asset.id);
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
              );
            })}
          </div>
        )}
      </ScrollArea>
      <div className="h-2 bg-background"></div>
    </div>
  );
}
