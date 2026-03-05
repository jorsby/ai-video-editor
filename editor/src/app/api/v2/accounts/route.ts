import { createClient } from '@/lib/supabase/server';
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

    // Read accounts directly from social_auth.tokens (single source of truth)
    const { data: tokens, error } = await supabase
      .from('tokens')
      .select('platform, account_id, account_name, account_username, language, agent_id, expires_at, profile_image_url')
      .order('platform')
      .order('account_name');

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json({ error: 'Failed to fetch accounts' }, { status: 500 });
    }

    const accounts = (tokens ?? []).map((t: any) => ({
      platform: t.platform,
      account_id: t.account_id,
      account_name: t.account_name,
      account_username: t.account_username,
      language: t.language,
      agent_id: t.agent_id,
      expires_at: t.expires_at,
      profile_image_url: t.profile_image_url,
    }));

    return NextResponse.json({ accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[GET /api/v2/accounts]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
