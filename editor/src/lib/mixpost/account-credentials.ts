import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptLaravel } from './decrypt';

export interface AccountCredentials {
  provider: string;
  providerId: string;
  accessToken: string;
  refreshToken: string | null;
  accountId: number;
  accountUuid: string;
  name: string;
  username: string;
}

/**
 * Fetches OAuth credentials for a Mixpost account by its numeric ID.
 * Reads directly from the Mixpost schema tables and decrypts the
 * Laravel-encrypted access_token.
 */
export async function getAccountCredentials(
  supabase: SupabaseClient,
  accountId: number
): Promise<AccountCredentials> {
  const { data: account, error } = await supabase
    .schema('mixpost')
    .from('mixpost_accounts')
    .select('id, provider, provider_id, access_token, uuid, name, username')
    .eq('id', accountId)
    .single();

  if (error || !account) {
    throw new Error('Account not found');
  }

  if (!account.access_token) {
    throw new Error('No access token found. Please re-authorize this account in Mixpost.');
  }

  const decryptedJson = decryptLaravel(account.access_token);
  const tokenData: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  } = JSON.parse(decryptedJson);

  return {
    provider: account.provider,
    providerId: account.provider_id,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    accountId: account.id,
    accountUuid: account.uuid,
    name: account.name,
    username: account.username,
  };
}
