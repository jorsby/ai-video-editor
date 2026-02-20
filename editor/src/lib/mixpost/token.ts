import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// CRC32B lookup table (same polynomial as PHP's crc32b)
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    table[i] = crc;
  }
  return table;
})();

function crc32b(str: string): string {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ str.charCodeAt(i)) & 0xff];
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

// Replicates Laravel's Str::random(40) — alphanumeric characters
const ALPHA_NUM =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function strRandom(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ALPHA_NUM[bytes[i] % ALPHA_NUM.length];
  }
  return result;
}

/**
 * Replicates Mixpost's PHP token generation algorithm:
 *   plainText = Str::random(40) + hash('crc32b', entropy)  → 48 chars
 *   hash      = hash('sha256', plainText)
 */
export function generateMixpostToken(): {
  plainText: string;
  hash: string;
} {
  const entropy = strRandom(40);
  const plainText = entropy + crc32b(entropy);
  const hash = createHash('sha256').update(plainText).digest('hex');
  return { plainText, hash };
}

/**
 * Returns a valid Mixpost API token for the given user.
 * - Checks for a cached plain-text token in user_integrations
 * - If none, generates a new one and inserts into mixpost_user_tokens
 */
export async function getOrCreateMixpostToken(
  supabase: SupabaseClient,
  userId: string
): Promise<{ token: string; mixpostUserId: number } | { error: string }> {
  // 1. Look up the user's integration row
  const { data: integration, error: integrationError } = await supabase
    .from('user_integrations')
    .select('mixpost_user_id, mixpost_api_token')
    .eq('supabase_user_id', userId)
    .single();

  if (integrationError || !integration) {
    return { error: 'Mixpost account not found' };
  }

  const { mixpost_user_id, mixpost_api_token } = integration;

  // 2. If cached token exists, return it
  if (mixpost_api_token) {
    return { token: mixpost_api_token, mixpostUserId: mixpost_user_id };
  }

  // 3. Generate a new token
  const { plainText, hash } = generateMixpostToken();

  // 4. Insert into mixpost_user_tokens (shared Postgres DB)
  const { error: insertError } = await supabase
    .schema('mixpost')
    .from('mixpost_user_tokens')
    .insert({
      user_id: mixpost_user_id,
      name: 'editor-auto',
      token: hash,
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

  if (insertError) {
    return { error: `Failed to create Mixpost token: ${insertError.message}` };
  }

  // 5. Cache the plain-text token in user_integrations
  const { error: updateError } = await supabase
    .from('user_integrations')
    .update({ mixpost_api_token: plainText })
    .eq('supabase_user_id', userId);

  if (updateError) {
    console.warn(
      'Failed to cache Mixpost token in user_integrations:',
      updateError
    );
    // Still return the token — caching will be retried on next request
  }

  return { token: plainText, mixpostUserId: mixpost_user_id };
}

/**
 * Clears the cached token so the next request will generate a fresh one.
 */
export async function clearCachedMixpostToken(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('user_integrations')
    .update({ mixpost_api_token: null })
    .eq('supabase_user_id', userId);

  if (error) {
    console.warn('Failed to clear cached Mixpost token:', error);
  }
}
