import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Look up the user's Mixpost mapping
    const { data: integration, error: integrationError } = await supabase
      .from('user_integrations')
      .select('mixpost_user_id')
      .eq('supabase_user_id', user.id)
      .single();

    if (integrationError || !integration) {
      return NextResponse.json(
        { error: 'Mixpost account not found' },
        { status: 404 }
      );
    }

    // Generate a one-time token
    const plainToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(plainToken).digest('hex');

    // Store the hashed token with 60s expiry
    const { error: insertError } = await supabase
      .from('auto_login_tokens')
      .insert({
        token_hash: tokenHash,
        mixpost_user_id: integration.mixpost_user_id,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });

    if (insertError) {
      console.error('Failed to create auto-login token:', insertError);
      return NextResponse.json(
        { error: 'Failed to create login token' },
        { status: 500 }
      );
    }

    const mixpostUrl = process.env.MIXPOST_URL || 'http://localhost:8000';
    const url = `${mixpostUrl}/auto-login?token=${plainToken}`;

    return NextResponse.json({ url });
  } catch (error) {
    console.error('Auto-login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
