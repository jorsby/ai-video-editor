import { createClient } from '@/lib/supabase/server';
import { validateApiKey } from './api-key';

/**
 * Get authenticated user — first tries Supabase session auth,
 * falls back to API key auth for agent/server-to-server calls.
 */
export async function getUserOrApiKey(
  request: Request
): Promise<{ id: string } | null> {
  // Try session auth first
  const supabase = await createClient('studio');
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return user;

  // Fall back to API key
  const apiKeyResult = validateApiKey(request);
  if (apiKeyResult.valid && apiKeyResult.userId) {
    return { id: apiKeyResult.userId };
  }

  return null;
}
