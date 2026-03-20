import { createClient } from '@/lib/supabase/server';
import { fetchAccounts } from '@/lib/octupost/client';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const supabase = await createClient('social_auth');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accounts = await fetchAccounts();

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
        .upsert(rows, { onConflict: 'platform,account_id' });
    }

    // Fetch the updated list from DB
    const { data: socialAccounts, error } = await supabase
      .from('tokens')
      .select(
        'platform, account_id, account_name, account_username, language, agent_id, expires_at, profile_image_url'
      )
      .eq('user_id', user.id)
      .order('platform');

    if (error) {
      console.error('[POST /api/v2/accounts/sync] DB error:', error);
      return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
    }

    return NextResponse.json({ accounts: socialAccounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[POST /api/v2/accounts/sync]', message);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}
