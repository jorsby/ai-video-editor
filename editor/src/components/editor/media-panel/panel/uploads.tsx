'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useStudioStore } from '@/stores/studio-store';
import { useProjectStore } from '@/stores/project-store';
import { Image, Video, Audio, Log } from 'openvideo';
import { Upload, Search, Trash2, Music } from 'lucide-react';
import { IconPlayerPlay, IconPlayerPause } from '@tabler/icons-react';
import { uploadFile } from '@/lib/upload-utils';
import { useProjectId } from '@/contexts/project-context';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';

interface VisualAsset {
  id: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  name: string;
  preview?: string;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
}

// Helper to format duration like 00:00
function formatDuration(seconds?: number) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Audio content sub-component — needs its own hooks for playback control
function AudioAssetContent({
  asset,
  playingId,
  setPlayingId,
}: {
  asset: VisualAsset;
  playingId: string | null;
  setPlayingId: (id: string | null) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const isPlaying = playingId === asset.id;

  useEffect(() => {
    if (isPlaying) {
      audioRef.current?.play();
    } else {
      audioRef.current?.pause();
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
    }
  }, [isPlaying]);

  return (
    <div className="w-full h-full flex items-center justify-center bg-black/40 relative">
      <audio
        ref={audioRef}
        src={asset.url}
        preload="metadata"
        onLoadedMetadata={() => {
          if (audioRef.current) {
            setDuration(audioRef.current.duration);
          }
        }}
        onEnded={() => setPlayingId(null)}
        className="hidden"
      />
      <Music size={28} className="text-muted-foreground" />

      {/* Play/Pause button — small icon, mirrors delete button style */}
      <button
        type="button"
        className={`absolute bottom-1 right-1 p-1 rounded bg-black/60 transition-opacity hover:bg-white/20 ${
          isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          if (isPlaying) {
            setPlayingId(null);
          } else {
            setPlayingId(asset.id);
          }
        }}
      >
        {isPlaying ? (
          <IconPlayerPause className="size-3 text-white fill-current" />
        ) : (
          <IconPlayerPlay className="size-3 text-white fill-current" />
        )}
      </button>

      {/* Duration overlay */}
      {duration && (
        <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white font-medium">
          {formatDuration(duration)}
        </div>
      )}
    </div>
  );
}

// Asset card component
// Note: Uses asset.url (matching VisualAsset interface) for media sources
function AssetCard({
  asset,
  onAdd,
  onDelete,
  playingId,
  setPlayingId,
}: {
  asset: VisualAsset;
  onAdd: (asset: VisualAsset) => void;
  onDelete: (id: string) => void;
  playingId: string | null;
  setPlayingId: (id: string | null) => void;
}) {
  return (
    <div
      className="flex flex-col gap-1.5 group cursor-pointer"
      onClick={() => onAdd(asset)}
    >
      <div className="relative aspect-square rounded-sm overflow-hidden bg-foreground/20 border border-transparent group-hover:border-primary/50 transition-all flex items-center justify-center">
        {asset.type === 'image' ? (
          <img
            src={asset.url}
            alt={asset.name}
            className="max-w-full max-h-full object-contain"
          />
        ) : asset.type === 'audio' ? (
          <AudioAssetContent
            asset={asset}
            playingId={playingId}
            setPlayingId={setPlayingId}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-black/40 relative">
            <video
              src={asset.url}
              className="max-w-full max-h-full object-contain pointer-events-none"
              muted
              onMouseOver={(e) => (e.currentTarget as HTMLVideoElement).play()}
              onFocus={(e) => (e.currentTarget as HTMLVideoElement).play()}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLVideoElement).pause();
                (e.currentTarget as HTMLVideoElement).currentTime = 0;
              }}
              onBlur={(e) => {
                (e.currentTarget as HTMLVideoElement).pause();
                (e.currentTarget as HTMLVideoElement).currentTime = 0;
              }}
            />
          </div>
        )}

        {/* Duration Overlay (Bottom Left) */}
        {asset.duration && (
          <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white font-medium">
            {formatDuration(asset.duration)}
          </div>
        )}

        {/* Remove Button (Minimalist on Hover) */}
        <button
          type="button"
          className="absolute top-1 right-1 p-1 rounded bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(asset.id);
          }}
        >
          <Trash2 size={12} className="text-white" />
        </button>
      </div>

      {/* Label (External) */}
      <p className="text-[10px] text-muted-foreground group-hover:text-foreground truncate transition-colors px-0.5">
        {asset.name}
      </p>
    </div>
  );
}

export default function PanelUploads() {
  const { studio } = useStudioStore();
  const projectId = useProjectId();
  const { canvasSize } = useProjectStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [uploads, setUploads] = useState<VisualAsset[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [showAllUploads, setShowAllUploads] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load uploads from Supabase on mount (or when toggle changes)
  useEffect(() => {
    if (!projectId) return;

    const fetchUploads = async () => {
      try {
        const url = showAllUploads
          ? `/api/assets?type=upload`
          : `/api/assets?type=upload&project_id=${projectId}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Failed to fetch uploads');
        }
        const { assets } = await response.json();

        // Transform Supabase assets to VisualAsset format
        const visualAssets: VisualAsset[] = assets.map(
          (asset: {
            id: string;
            url: string;
            name: string;
            size?: number;
          }) => ({
            id: asset.id,
            type: asset.name.match(/\.(mp4|webm|mov|avi)$/i)
              ? 'video'
              : asset.name.match(/\.(mp3|wav|ogg|aac|m4a|flac|wma)$/i)
                ? 'audio'
                : 'image',
            url: asset.url,
            name: asset.name,
            size: asset.size,
          })
        );

        setUploads(visualAssets);
      } catch (error) {
        console.error('Failed to fetch uploads:', error);
      } finally {
        setIsLoaded(true);
      }
    };

    fetchUploads();
  }, [projectId, showAllUploads]);

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);

    try {
      for (const file of Array.from(files)) {
        const type: 'image' | 'video' | 'audio' = file.type.startsWith('video/')
          ? 'video'
          : file.type.startsWith('audio/')
            ? 'audio'
            : 'image';

        // Upload to R2
        let result: { url: string };
        try {
          result = await uploadFile(file);
        } catch (error) {
          console.error('R2 upload failed:', error);
          continue;
        }

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

        const { asset } = await saveResponse.json();

        const newAsset: VisualAsset = {
          id: asset.id,
          type,
          url: result.url,
          name: result.fileName,
          size: file.size,
        };

        setUploads((prev) => [newAsset, ...prev]);
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Add item to canvas using openvideo clips
  const handleAddToCanvas = async (asset: VisualAsset) => {
    if (!studio) return;

    try {
      if (asset.type === 'image') {
        const imageClip = await Image.fromUrl(asset.url);
        imageClip.name = asset.name;
        imageClip.display = { from: 0, to: 5 * 1e6 };
        imageClip.duration = 5 * 1e6;
        await imageClip.scaleToFit(canvasSize.width, canvasSize.height);
        imageClip.centerInScene(canvasSize.width, canvasSize.height);
        await studio.addClip(imageClip);
      } else if (asset.type === 'audio') {
        const audioClip = await Audio.fromUrl(asset.url);
        audioClip.name = asset.name;
        audioClip.volume = 0.35;
        await studio.addClip(audioClip);
      } else {
        const videoClip = await Video.fromUrl(asset.url);
        videoClip.name = asset.name;
        await videoClip.scaleToFit(canvasSize.width, canvasSize.height);
        videoClip.centerInScene(canvasSize.width, canvasSize.height);
        await studio.addClip(videoClip);
      }
    } catch (error) {
      Log.error(`Failed to add ${asset.type}:`, error);
    }
  };

  // Delete from Supabase
  const removeUpload = async (id: string) => {
    try {
      if (playingId === id) setPlayingId(null);

      const response = await fetch(`/api/assets?id=${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete upload');
      }

      setUploads((prev) => prev.filter((a) => a.id !== id));
    } catch (error) {
      console.error('Failed to delete upload:', error);
    }
  };

  // Filter assets by search query
  const filteredAssets = uploads.filter((asset) =>
    asset.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isLoaded) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*,video/*,audio/*"
        multiple
        onChange={handleFileUpload}
      />
      {/* Toggle + Search/Upload */}
      <div className="p-4 flex flex-col gap-2">
        {/* All / Project toggle */}
        <div className="flex rounded-md bg-secondary/30 p-0.5 text-xs">
          <button
            type="button"
            className={`flex-1 px-2 py-1 rounded-sm transition-colors ${
              showAllUploads
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setShowAllUploads(true)}
          >
            All
          </button>
          <button
            type="button"
            className={`flex-1 px-2 py-1 rounded-sm transition-colors ${
              !showAllUploads
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setShowAllUploads(false)}
          >
            Project
          </button>
        </div>

        {/* Search + Upload button */}
        <div className="flex gap-2">
          {uploads.length > 0 ? (
            <>
              <InputGroup>
                <InputGroupAddon className="bg-secondary/30 pointer-events-none text-muted-foreground w-8 justify-center">
                  <Search size={14} />
                </InputGroupAddon>

                <InputGroupInput
                  placeholder="Search uploads..."
                  className="bg-secondary/30 border-0 h-full text-xs box-border pl-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </InputGroup>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                variant={'outline'}
              >
                <Upload size={14} />
              </Button>
            </>
          ) : (
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              variant={'outline'}
              className="w-full"
            >
              <Upload size={14} /> Upload
            </Button>
          )}
        </div>
      </div>

      {/* Assets grid */}
      <ScrollArea className="flex-1 px-4">
        {filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
            <Upload size={32} className="opacity-50" />
            <span className="text-sm">
              {uploads.length === 0 ? 'No uploads yet' : 'No matches found'}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-x-3 gap-y-4">
            {filteredAssets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onAdd={handleAddToCanvas}
                onDelete={removeUpload}
                playingId={playingId}
                setPlayingId={setPlayingId}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      <div className="h-2 bg-background"></div>
    </div>
  );
}
