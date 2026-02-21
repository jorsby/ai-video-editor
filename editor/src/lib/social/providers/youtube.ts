import type { PlatformMediaItem } from '../types';
import { TokenExpiredError, RateLimitError, PlatformApiError } from './instagram';

export async function fetchYouTubeMedia(
  accessToken: string,
  limit = 50
): Promise<PlatformMediaItem[]> {
  // Step 1: Get the uploads playlist ID
  const channelRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (channelRes.status === 401 || channelRes.status === 403) {
    throw new TokenExpiredError('YouTube token expired. Please re-authorize this account in Mixpost.');
  }
  if (channelRes.status === 429) {
    throw new RateLimitError('YouTube API rate limit reached. Please try again later.');
  }
  if (!channelRes.ok) {
    throw new PlatformApiError(`Failed to fetch YouTube channel. Status: ${channelRes.status}`);
  }

  const channelData = await channelRes.json();
  const uploadsPlaylistId =
    channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

  if (!uploadsPlaylistId) {
    throw new PlatformApiError('Could not find YouTube uploads playlist.');
  }

  // Step 2: Fetch playlist items
  const items: PlatformMediaItem[] = [];
  let pageToken: string | undefined;

  while (items.length < limit) {
    const params = new URLSearchParams({
      part: 'snippet',
      playlistId: uploadsPlaylistId,
      maxResults: String(Math.min(50, limit - items.length)),
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (res.status === 401 || res.status === 403) {
      throw new TokenExpiredError('YouTube token expired. Please re-authorize this account in Mixpost.');
    }
    if (res.status === 429) {
      throw new RateLimitError('YouTube API rate limit reached. Please try again later.');
    }
    if (!res.ok) {
      throw new PlatformApiError(`Failed to fetch YouTube videos. Status: ${res.status}`);
    }

    const data = await res.json();
    const playlistItems: unknown[] = data.items || [];

    for (const raw of playlistItems) {
      const item = raw as Record<string, unknown>;
      const snippet = item.snippet as Record<string, unknown>;
      const thumbnails = snippet.thumbnails as Record<string, Record<string, unknown>> | undefined;
      const resourceId = snippet.resourceId as Record<string, unknown>;
      const videoId = String(resourceId?.videoId || '');

      items.push({
        platformId: videoId,
        caption: String(snippet.description || ''),
        title: String(snippet.title || ''),
        thumbnailUrl:
          (thumbnails?.high?.url as string) ||
          (thumbnails?.medium?.url as string) ||
          (thumbnails?.default?.url as string) ||
          null,
        mediaUrl: null,
        mediaType: 'video',
        permalink: `https://www.youtube.com/watch?v=${videoId}`,
        publishedAt: (snippet.publishedAt as string) || null,
        provider: 'youtube',
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return items.slice(0, limit);
}
