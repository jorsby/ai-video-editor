import { createClient } from '@/lib/supabase/server';
import {
  getOrCreateMixpostToken,
  clearCachedMixpostToken,
} from '@/lib/mixpost/token';
import { NextResponse, type NextRequest } from 'next/server';
import type { MixpostPostsResponse } from '@/types/calendar';

export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const page = searchParams.get('page') || '1';

    const response = await fetch(
      `${mixpostUrl}/mixpost/api/${workspaceUuid}/posts?page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
          Accept: 'application/json',
        },
      }
    );

    if (response.status === 401) {
      await clearCachedMixpostToken(supabase, user.id);
      console.error('Mixpost token rejected (401). Cleared cached token.');
      return NextResponse.json(
        { error: 'Mixpost token expired. Please retry.' },
        { status: 401 }
      );
    }

    if (!response.ok) {
      const body = await response.text();
      console.error(
        `Mixpost list posts error: status=${response.status} body=${body}`
      );
      return NextResponse.json(
        { error: `Failed to fetch posts from Mixpost (${response.status})` },
        { status: response.status }
      );
    }

    const result: MixpostPostsResponse = await response.json();

    return NextResponse.json({ posts: result.data, meta: result.meta });
  } catch (error) {
    console.error('Fetch Mixpost posts error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
