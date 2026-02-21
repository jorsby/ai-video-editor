import type { PlatformMediaItem } from '../types';
import { TokenExpiredError, RateLimitError, PlatformApiError } from './instagram';

export async function fetchTikTokMedia(
  accessToken: string,
  limit = 50
): Promise<PlatformMediaItem[]> {
  const items: PlatformMediaItem[] = [];
  let cursor: number | undefined = 0;
  let hasMore = true;

  while (hasMore && items.length < limit) {
    const body: Record<string, unknown> = {
      max_count: Math.min(20, limit - items.length),
    };
    if (cursor !== undefined && cursor > 0) {
      body.cursor = cursor;
    }

    const res = await fetch(
      'https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,share_url,cover_image_url',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (res.status === 401 || res.status === 403) {
      throw new TokenExpiredError('TikTok token expired. Please re-authorize this account in Mixpost.');
    }
    if (res.status === 429) {
      throw new RateLimitError('TikTok API rate limit reached. Please try again later.');
    }
    if (!res.ok) {
      throw new PlatformApiError(`Failed to fetch media from TikTok. Status: ${res.status}`);
    }

    const data = await res.json();
    const videos: unknown[] = data.data?.videos || [];

    for (const raw of videos) {
      const video = raw as Record<string, unknown>;
      const createTime = video.create_time
        ? new Date((video.create_time as number) * 1000).toISOString()
        : null;

      items.push({
        platformId: String(video.id),
        caption: String(video.video_description || ''),
        title: (video.title as string) || undefined,
        thumbnailUrl: (video.cover_image_url as string) || null,
        mediaUrl: null,
        mediaType: 'video',
        permalink: (video.share_url as string) || null,
        publishedAt: createTime,
        provider: 'tiktok',
      });
    }

    hasMore = data.data?.has_more === true;
    cursor = data.data?.cursor;
  }

  return items.slice(0, limit);
}
