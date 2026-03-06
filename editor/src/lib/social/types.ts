export interface PlatformMediaItem {
  platformId: string;
  caption: string;
  title?: string;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  mediaType: 'image' | 'video' | 'carousel';
  permalink: string | null;
  publishedAt: string | null;
  provider: string;
}
