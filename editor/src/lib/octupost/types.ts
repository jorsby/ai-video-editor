// --- Octupost API types ---

export interface OctupostAccount {
  platform: string;
  account_id: string;
  account_name: string;
  account_username: string | null;
  language: string | null;
  agent_id: string | null;
  expires_at: string;
}

export interface OctupostToken {
  platform: string;
  account_id: string;
  account_name: string;
  access_token: string;
  expires_at: string;
}

// --- DB types ---

export type Platform = 'instagram' | 'facebook' | 'tiktok' | 'twitter' | 'youtube';
export type MediaType = 'video' | 'image' | 'carousel';
export type ScheduleType = 'now' | 'scheduled';
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed';
export type PostAccountStatus = 'pending' | 'uploading' | 'publishing' | 'published' | 'failed';

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

export interface Post {
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
}

export interface PostAccount {
  id: string;
  post_id: string;
  octupost_account_id: string;
  platform: Platform;
  status: PostAccountStatus;
  platform_post_id: string | null;
  error_message: string | null;
  published_at: string | null;
  created_at: string;
}
