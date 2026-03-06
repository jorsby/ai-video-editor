export type MediaType = 'image' | 'video' | 'audio';

// Asset types for the unified asset system (matches Supabase schema)
export type AssetType =
  | 'image'
  | 'video'
  | 'voiceover'
  | 'music'
  | 'sfx'
  | 'upload';

// Unified Asset interface - used for all assets (generated and uploaded)
export interface Asset {
  id: string;
  url: string;
  type: AssetType;
  name: string; // prompt for generated assets, filename for uploads
  prompt?: string; // full prompt (only for AI-generated assets)
  size?: number; // file size in bytes
  createdAt: number;
}

// What's stored in media library
export interface MediaFile {
  id: string;
  name: string;
  type: MediaType;
  file: File;
  url?: string; // Object URL for preview
  thumbnailUrl?: string; // For video thumbnails
  duration?: number; // For video/audio duration
  width?: number; // For video/image width
  height?: number; // For video/image height
  fps?: number; // For video frame rate
  // Ephemeral items are used by timeline directly and should not appear in the media library or be persisted
  ephemeral?: boolean;
}
