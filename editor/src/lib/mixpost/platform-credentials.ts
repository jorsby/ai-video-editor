import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptLaravel } from './decrypt';

export interface PlatformCredentials {
  provider: string;
  providerId: string;
  providerPostId: string;
  accessToken: string;
  refreshToken: string | null;
}

/**
 * Fetches the OAuth token and platform-specific post ID for a given
 * Mixpost post + account. Reads directly from the Mixpost schema tables
 * and decrypts the Laravel-encrypted access_token.
 */
export async function getPlatformCredentials(
  supabase: SupabaseClient,
  postUuid: string,
  accountId: number
): Promise<PlatformCredentials> {
  // 1. Get the post's internal ID from its UUID
  const { data: post, error: postError } = await supabase
    .schema('mixpost')
    .from('mixpost_posts')
    .select('id')
    .eq('uuid', postUuid)
    .single();

  if (postError || !post) {
    throw new Error(`Post not found: ${postUuid}`);
  }

  // 2. Get the provider_post_id from the pivot table
  const { data: pivot, error: pivotError } = await supabase
    .schema('mixpost')
    .from('mixpost_post_accounts')
    .select('provider_post_id')
    .eq('post_id', post.id)
    .eq('account_id', accountId)
    .single();

  if (pivotError || !pivot) {
    throw new Error('Post-account association not found');
  }

  if (!pivot.provider_post_id) {
    throw new Error('No platform post ID found — post may not be published');
  }

  // 3. Get the account's encrypted access_token and provider
  const { data: account, error: accountError } = await supabase
    .schema('mixpost')
    .from('mixpost_accounts')
    .select('access_token, provider, provider_id')
    .eq('id', accountId)
    .single();

  if (accountError || !account) {
    throw new Error('Account not found');
  }

  if (!account.access_token) {
    throw new Error('Account has no access token — may need re-authorization');
  }

  // 4. Decrypt the access token
  const decryptedJson = decryptLaravel(account.access_token);
  const tokenData: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  } = JSON.parse(decryptedJson);

  return {
    provider: account.provider,
    providerId: account.provider_id,
    providerPostId: pivot.provider_post_id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
  };
}
