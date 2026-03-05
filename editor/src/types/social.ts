// Unified social types for the entire app.
// Central type definitions for social accounts, posts, and platform integrations.
// Compatible with both Supabase DB tables (snake_case) and UI components.

// Re-export DB/API types from octupost for convenience
export type {
  Platform,
  MediaType,
  ScheduleType,
  PostStatus,
  PostAccountStatus,
} from '@/lib/octupost/types';

import type {
  Platform,
  MediaType,
  ScheduleType,
  PostStatus,
  PostAccountStatus,
} from '@/lib/octupost/types';

// ---------------------------------------------------------------------------
// Social Account (UI-facing, maps 1:1 to social_accounts table)
// ---------------------------------------------------------------------------

export interface SocialAccount {
  id: string;
  user_id: string;
  octupost_account_id: string;
  platform: Platform;
  account_name: string | null;
  account_username: string | null;
  language: string | null;
  expires_at: string | null;
  synced_at: string;
}

// ---------------------------------------------------------------------------
// Post Account (per-platform result for a post)
// ---------------------------------------------------------------------------

export interface SocialPostAccount {
  id: string;
  post_id: string;
  octupost_account_id: string;
  platform: Platform;
  status: PostAccountStatus;
  platform_post_id: string | null;
  error_message: string | null;
  published_at: string | null;
  created_at: string;
  // Joined fields (populated when joining with social_accounts)
  account_name?: string | null;
  account_username?: string | null;
}

// ---------------------------------------------------------------------------
// Social Post (used in calendar, dashboard, post lists)
// ---------------------------------------------------------------------------

export interface SocialPost {
  id: string;
  user_id: string;
  project_id: string | null;
  caption: string | null;
  media_url: string | null;
  media_type: MediaType | null;
  schedule_type: ScheduleType;
  scheduled_at: string | null;
  timezone: string;
  status: PostStatus;
  platform_options: Record<string, unknown>;
  tags: string[];
  workflow_run_id: string | null;
  created_at: string;
  updated_at: string;
  // Joined relations (populated via query joins)
  accounts?: SocialPostAccount[];
}

// ---------------------------------------------------------------------------
// Platform-specific options
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Post form data (used by post creation UI)
// ---------------------------------------------------------------------------

export interface PostFormData {
  caption: string;
  accountIds: string[]; // Octupost account IDs (string UUIDs)
  scheduleType: ScheduleType;
  scheduledDate?: string; // YYYY-MM-DD
  scheduledTime?: string; // HH:mm
  timezone: string;
  platformOptions: PlatformOptions;
}

// ---------------------------------------------------------------------------
// Post verification (polling result after publishing)
// ---------------------------------------------------------------------------

export interface PostAccountResult {
  accountId: string; // Octupost account ID
  accountName: string;
  platform: Platform;
  status: PostAccountStatus;
  errorMessage: string | null;
  platformPostId: string | null;
}

export interface PostVerificationResult {
  status: PostStatus;
  accounts: PostAccountResult[];
}

// ---------------------------------------------------------------------------
// Paginated response
// ---------------------------------------------------------------------------

export interface PaginationMeta {
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
}

export interface SocialPostsResponse {
  data: SocialPost[];
  meta: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Account groups & tags
// ---------------------------------------------------------------------------

export interface AccountGroup {
  id: string;
  name: string;
  created_at: string;
  account_ids: string[]; // Octupost account IDs
}

export interface AccountTag {
  id: string;
  name: string;
  hex_color: string;
}

// ---------------------------------------------------------------------------
// Account groups with members (used by dashboard / account-groups API)
// ---------------------------------------------------------------------------

export interface AccountGroupWithMembers {
  id: string;
  name: string;
  created_at: string;
  account_uuids: string[]; // Octupost account_id values
}

// Tag map: keyed by account_id (Octupost account ID string)
export type AccountTagMap = { [accountId: string]: string[] };
