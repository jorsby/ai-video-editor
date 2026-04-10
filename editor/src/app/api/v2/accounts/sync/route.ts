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
      // Update metadata for existing accounts (profile images, names, expiry).
      // We use UPDATE (not upsert) because the tokens table requires access_token
      // which is managed by Octupost directly — we only refresh metadata here.
      const updates = accounts.map((a) =>
        supabase
          .from('tokens')
          .update({
            account_name: a.account_name,
            account_username: a.account_username,
            language: a.language,
            expires_at: a.expires_at,
            profile_image_url: a.profile_image_url,
          })
          .eq('platform', a.platform)
          .eq('account_id', a.account_id)
          .eq('user_id', user.id)
      );
      await Promise.all(updates);
    }

    // Return refreshed list from DB
    const { data: tokens, error } = await supabase
      .from('tokens')
      .select(
        'platform, account_id, account_name, account_username, language, agent_id, expires_at, profile_image_url'
      )
      .eq('user_id', user.id)
      .order('platform')
      .order('account_name');

    if (error) {
      console.error('[POST /api/v2/accounts/sync] DB error:', error);
      return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
    }

    return NextResponse.json({ accounts: tokens });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[POST /api/v2/accounts/sync]', message);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}
