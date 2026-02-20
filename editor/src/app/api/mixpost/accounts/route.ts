import { createClient } from '@/lib/supabase/server';
import {
  getOrCreateMixpostToken,
  clearCachedMixpostToken,
} from '@/lib/mixpost/token';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const mixpostUrl = process.env.MIXPOST_URL;
    const workspaceUuid = process.env.MIXPOST_WORKSPACE_UUID;

    if (!mixpostUrl || !workspaceUuid) {
      return NextResponse.json(
        {
          error:
            'Mixpost configuration incomplete. MIXPOST_URL and MIXPOST_WORKSPACE_UUID are required.',
        },
        { status: 500 }
      );
    }

    const tokenResult = await getOrCreateMixpostToken(supabase, user.id);

    if ('error' in tokenResult) {
      return NextResponse.json(
        { error: tokenResult.error },
        { status: 403 }
      );
    }

    const response = await fetch(
      `${mixpostUrl}/mixpost/api/${workspaceUuid}/accounts`,
      {
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
          Accept: 'application/json',
        },
      }
    );

    // If Mixpost rejects the token, clear the cache so next request creates a fresh one
    if (response.status === 401) {
      await clearCachedMixpostToken(supabase, user.id);
      return NextResponse.json(
        { error: 'Mixpost token expired. Please retry.' },
        { status: 401 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch accounts from Mixpost' },
        { status: response.status }
      );
    }

    const { data } = await response.json();

    return NextResponse.json({ accounts: data });
  } catch (error) {
    console.error('Fetch Mixpost accounts error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
