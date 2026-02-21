import type { PlatformMediaItem } from './types';
import type { MixpostPost } from '@/types/calendar';

const PROVIDER_PREFIX: Record<string, string> = {
  instagram: 'ig',
  tiktok: 'tt',
  youtube: 'yt',
  facebook: 'fb',
  facebook_page: 'fb',
};

/**
 * Transforms platform media items into MixpostPost[] so PostItemCard
 * works without changes. Adds a `_source: 'platform'` property for
 * explicit source detection.
 */
export function transformToMixpostPosts(
  items: PlatformMediaItem[],
  account: {
    id: number;
    uuid: string;
    name: string;
    username: string;
    provider: string;
  }
): MixpostPost[] {
  const prefix = PROVIDER_PREFIX[account.provider] || account.provider.slice(0, 2);

  return items.map((item, index) => {
    const uuid = `${prefix}-${item.platformId}`;
    const isVideo = item.mediaType === 'video';

    const media = {
      id: 0,
      uuid: item.platformId,
      name: '',
      mime_type: isVideo ? 'video/mp4' : 'image/jpeg',
      type: (isVideo ? 'video' : 'image') as 'video' | 'image',
      url: item.mediaUrl || item.thumbnailUrl || '',
      thumb_url: item.thumbnailUrl || item.mediaUrl || '',
      is_video: isVideo,
      created_at: item.publishedAt || '',
    };

    return {
      id: index + 1,
      uuid,
      status: '3',
      accounts: [
        {
          id: account.id,
          uuid: account.uuid,
          name: account.name,
          username: account.username,
          provider: account.provider,
          authorized: true,
          external_url: item.permalink,
        },
      ],
      versions: [
        {
          account_id: account.id,
          is_original: true,
          content: [
            {
              body: item.title
                ? `${item.title}\n\n${item.caption}`
                : item.caption,
              media: [media],
              url: null,
            },
          ],
        },
      ],
      tags: [],
      user: { name: '' },
      scheduled_at: null,
      published_at: item.publishedAt,
      created_at: item.publishedAt || new Date().toISOString(),
      trashed: false,
      _source: 'platform' as const,
    };
  });
}
