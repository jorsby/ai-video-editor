import type { PlatformMediaItem } from '../types';

const MEDIA_TYPE_MAP: Record<string, PlatformMediaItem['mediaType']> = {
  IMAGE: 'image',
  VIDEO: 'video',
  CAROUSEL_ALBUM: 'carousel',
};

export async function fetchInstagramMedia(
  providerId: string,
  accessToken: string,
  limit = 50
): Promise<PlatformMediaItem[]> {
  const items: PlatformMediaItem[] = [];
  let url: string | null =
    `https://graph.facebook.com/v24.0/${providerId}/media?fields=id,caption,media_type,media_url,thumbnail_url,timestamp,permalink&limit=${Math.min(limit, 50)}&access_token=${encodeURIComponent(accessToken)}`;

  while (url && items.length < limit) {
    const res = await fetch(url);

    if (res.status === 401 || res.status === 403) {
      throw new TokenExpiredError('Instagram token expired. Please re-authorize this account in Mixpost.');
    }
    if (res.status === 429) {
      throw new RateLimitError('Instagram API rate limit reached. Please try again later.');
    }
    if (!res.ok) {
      throw new PlatformApiError(`Failed to fetch media from Instagram. Status: ${res.status}`);
    }

    const data = await res.json();
    const mediaItems: unknown[] = data.data || [];

    for (const raw of mediaItems) {
      const item = raw as Record<string, unknown>;
      items.push({
        platformId: String(item.id),
        caption: String(item.caption || ''),
        thumbnailUrl: (item.thumbnail_url as string) || (item.media_url as string) || null,
        mediaUrl: (item.media_url as string) || null,
        mediaType: MEDIA_TYPE_MAP[item.media_type as string] || 'image',
        permalink: (item.permalink as string) || null,
        publishedAt: (item.timestamp as string) || null,
        provider: 'instagram',
      });
    }

    url = data.paging?.next || null;
  }

  return items.slice(0, limit);
}

export class TokenExpiredError extends Error {
  constructor(message: string) { super(message); this.name = 'TokenExpiredError'; }
}

export class RateLimitError extends Error {
  constructor(message: string) { super(message); this.name = 'RateLimitError'; }
}

export class PlatformApiError extends Error {
  constructor(message: string) { super(message); this.name = 'PlatformApiError'; }
}
