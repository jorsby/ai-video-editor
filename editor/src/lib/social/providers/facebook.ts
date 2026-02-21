import type { PlatformMediaItem } from '../types';
import { TokenExpiredError, RateLimitError, PlatformApiError } from './instagram';

/**
 * Exchanges a user access token for a Facebook Page access token.
 * Required for any page-level operations (fetch posts, edit, delete).
 */
export async function getFacebookPageToken(
  providerId: string,
  userAccessToken: string
): Promise<string> {
  const res = await fetch(
    `https://graph.facebook.com/v24.0/${providerId}?fields=access_token&access_token=${encodeURIComponent(userAccessToken)}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    console.error('[Facebook Page Token Error]', { status: res.status, error: err });
    if (res.status === 401 || res.status === 403) {
      throw new TokenExpiredError('Facebook token expired. Please re-authorize this account in Mixpost.');
    }
    throw new PlatformApiError(`Failed to get Facebook page token. Status: ${res.status}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new PlatformApiError('No page access token returned. Ensure the account has manage_pages or pages_read_engagement permission.');
  }
  return data.access_token;
}

export async function fetchFacebookMedia(
  providerId: string,
  accessToken: string,
  limit = 50
): Promise<PlatformMediaItem[]> {
  const pageAccessToken = await getFacebookPageToken(providerId, accessToken);

  const items: PlatformMediaItem[] = [];
  let url: string | null =
    `https://graph.facebook.com/v24.0/${providerId}/published_posts?fields=id,message,created_time,permalink_url,full_picture&limit=${Math.min(limit, 50)}&access_token=${encodeURIComponent(pageAccessToken)}`;

  while (url && items.length < limit) {
    const res = await fetch(url);

    if (!res.ok) {
      const errorBody = await res.json().catch(() => null);
      console.error('[Facebook API Error]', {
        status: res.status,
        providerId,
        error: errorBody,
      });

      if (res.status === 401 || res.status === 403) {
        throw new TokenExpiredError(`Facebook token expired. Please re-authorize this account in Mixpost. (API: ${JSON.stringify(errorBody?.error || errorBody)})`);
      }
      if (res.status === 429) {
        throw new RateLimitError('Facebook API rate limit reached. Please try again later.');
      }
      throw new PlatformApiError(`Failed to fetch media from Facebook. Status: ${res.status} — ${JSON.stringify(errorBody?.error || errorBody)}`);
    }

    const data = await res.json();
    const posts: unknown[] = data.data || [];

    for (const raw of posts) {
      const post = raw as Record<string, unknown>;
      items.push({
        platformId: String(post.id),
        caption: String(post.message || ''),
        thumbnailUrl: (post.full_picture as string) || null,
        mediaUrl: (post.full_picture as string) || null,
        mediaType: 'image',
        permalink: (post.permalink_url as string) || null,
        publishedAt: (post.created_time as string) || null,
        provider: 'facebook',
      });
    }

    url = data.paging?.next || null;
  }

  return items.slice(0, limit);
}
