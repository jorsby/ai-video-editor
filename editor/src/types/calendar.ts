export interface MixpostPostAccount {
  id: number;
  uuid: string;
  name: string;
  username: string;
  provider: string;
  authorized: boolean;
  image?: string | null;
  external_url?: string | null;
  errors?: string[];
  pivot?: {
    provider_post_data?: {
      url?: string;
      external_url?: string;
    };
    errors?: string[] | string;
  };
}

export interface MixpostMedia {
  id: number;
  uuid: string;
  name: string;
  mime_type: string;
  type: 'image' | 'video';
  url: string;
  thumb_url: string;
  is_video: boolean;
  created_at: string;
}

export interface MixpostPostContent {
  body: string;
  media: number[] | MixpostMedia[];
  url: string | null;
}

export interface MixpostPostVersion {
  account_id: number;
  is_original: boolean;
  content: MixpostPostContent[];
  options?: Record<string, unknown>;
}

export interface MixpostPostTag {
  id: number;
  uuid: string;
  name: string;
  hex_color: string;
}

export interface MixpostPost {
  id: number;
  uuid: string;
  status: string;
  accounts: MixpostPostAccount[];
  versions: MixpostPostVersion[];
  tags: MixpostPostTag[];
  user: { name: string };
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  trashed: boolean;
  _source?: 'platform' | 'mixpost';
}

export interface MixpostPaginationMeta {
  current_page: number;
  from: number;
  to: number;
  last_page: number;
  per_page: number;
  total: number;
  path: string;
}

export interface MixpostPostsResponse {
  data: MixpostPost[];
  links: {
    first: string;
    last: string;
    prev: string | null;
    next: string | null;
  };
  meta: MixpostPaginationMeta;
}
