export type FacebookPostType = 'post' | 'reel' | 'story';
export type InstagramPostType = 'post' | 'reel' | 'story';
export type YouTubePrivacy = 'public' | 'private' | 'unlisted';
export type TikTokPrivacy =
  | 'PUBLIC_TO_EVERYONE'
  | 'MUTUAL_FOLLOW_FRIENDS'
  | 'FOLLOWER_OF_CREATOR'
  | 'SELF_ONLY';

export interface FacebookOptions {
  type: FacebookPostType;
}

export interface YouTubeOptions {
  title: string;
  status: YouTubePrivacy;
}

export interface TikTokAccountOptions {
  privacy_level: TikTokPrivacy;
  allow_comments: boolean;
  allow_duet: boolean;
  allow_stitch: boolean;
  is_aigc: boolean;
  content_disclosure: boolean;
  brand_organic_toggle: boolean;
  brand_content_toggle: boolean;
}

export interface InstagramOptions {
  type: InstagramPostType;
}

export interface PlatformOptions {
  facebook?: FacebookOptions;
  youtube?: YouTubeOptions;
  tiktok?: Record<string, TikTokAccountOptions>; // keyed by "account-{id}"
  instagram?: InstagramOptions;
}

export interface PostFormData {
  caption: string;
  accountIds: number[];
  scheduleType: 'now' | 'scheduled';
  scheduledDate?: string; // YYYY-MM-DD
  scheduledTime?: string; // HH:mm
  timezone: string;
  platformOptions: PlatformOptions;
}

// Mixpost media upload response
export interface MixpostMedia {
  id: number;
  uuid: string;
  name: string;
  mime_type: string;
  url: string;
  is_video: boolean;
}

// Post verification types
export type MixpostPostStatus =
  | 'draft'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'unconfirmed'; // polling timed out — post is queued but outcome unknown

export interface PostAccountResult {
  accountId: number;
  accountName: string;
  provider: string;
  status: 'published' | 'failed' | 'pending';
  errors: string[];
  external_url: string | null;
}

export interface PostVerificationResult {
  status: MixpostPostStatus;
  accounts: PostAccountResult[];
}
