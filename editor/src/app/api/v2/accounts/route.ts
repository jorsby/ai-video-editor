import { createClient } from '@/lib/supabase/server';
import { fetchAccounts } from '@/lib/octupost/client';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient('social_auth');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accounts = await fetchAccounts();

    // Sync to social_accounts table (upsert)
    if (accounts.length > 0) {
      const rows = accounts.map((a) => ({
        user_id: user.id,
        octupost_account_id: a.account_id,
        platform: a.platform,
        account_name: a.account_name,
        account_username: a.account_username,
        language: a.language,
        expires_at: a.expires_at,
        synced_at: new Date().toISOString(),
      }));

      await supabase
        .from('tokens')
        .upsert(rows, { onConflict: 'user_id,octupost_account_id' });
    }

    return NextResponse.json({ accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[GET /api/v2/accounts]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
