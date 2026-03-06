import type { PublishResult } from './types';
import * as instagram from './instagram';
import * as facebook from './facebook';
import * as youtube from './youtube';
import * as tiktok from './tiktok';
import * as twitter from './twitter';

export type { PublishResult, MediaUploadResult } from './types';

export interface PublishOptions {
  platform: string;
  accountId: string;
  token: string;
  mediaUrl: string;
  mediaType: 'video' | 'image' | 'carousel';
  caption: string;
  platformOptions?: Record<string, unknown>;
}

export async function publishToAccount(
  opts: PublishOptions
): Promise<PublishResult> {
  const {
    platform,
    accountId,
    token,
    mediaUrl,
    mediaType,
    caption,
    platformOptions,
  } = opts;

  switch (platform) {
    case 'instagram': {
      if (mediaType === 'video') {
        return instagram.publishReel(accountId, token, mediaUrl, caption);
      }
      if (mediaType === 'carousel') {
        const urls = (platformOptions?.imageUrls as string[]) || [mediaUrl];
        return instagram.publishCarousel(accountId, token, urls, caption);
      }
      return instagram.publishPhoto(accountId, token, mediaUrl, caption);
    }

    case 'facebook':
    case 'facebook_page': {
      if (mediaType === 'video') {
        return facebook.publishVideo(accountId, token, mediaUrl, caption);
      }
      if (mediaType === 'carousel') {
        const urls = (platformOptions?.imageUrls as string[]) || [mediaUrl];
        return facebook.publishMultiPhoto(accountId, token, urls, caption);
      }
      return facebook.publishPhoto(accountId, token, mediaUrl, caption);
    }

    case 'youtube': {
      const title = (platformOptions?.title as string) || caption.slice(0, 100);
      const description = (platformOptions?.description as string) || caption;
      const privacy = (platformOptions?.privacy as string) || 'private';
      return youtube.uploadVideo(token, mediaUrl, title, description, privacy);
    }

    case 'tiktok': {
      const title = (platformOptions?.title as string) || caption;
      return tiktok.publishVideo(token, mediaUrl, title);
    }

    case 'twitter':
    case 'x': {
      const mediaPath = mediaType !== 'video' ? mediaUrl : undefined;
      // For Twitter, if there's media we pass the URL; text goes in caption
      return twitter.postTweet(token, caption, mediaPath);
    }

    default:
      return { success: false, error: `Unsupported platform: ${platform}` };
  }
}
