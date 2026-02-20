import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getOrCreateMixpostToken,
  clearCachedMixpostToken,
} from '@/lib/mixpost/token';

export async function POST(req: NextRequest) {
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

    const { url } = await req.json();

    if (!url) {
      return NextResponse.json(
        { error: 'url is required' },
        { status: 400 }
      );
    }

    const response = await fetch(
      `${mixpostUrl}/mixpost/api/${workspaceUuid}/media/remote/initiate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
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
        `Mixpost media upload error: status=${response.status} body=${body}`
      );
      return NextResponse.json(
        { error: `Failed to upload media to Mixpost (${response.status})` },
        { status: response.status }
      );
    }

    const data = await response.json();

    if (data.status === 'failed') {
      return NextResponse.json(
        { error: data.error || 'Remote upload failed' },
        { status: 422 }
      );
    }

    // Synchronous upload completed — media object is available
    if (data.status === 'completed' && data.media) {
      return NextResponse.json({ media: data.media });
    }

    // Async upload (large file) — poll until complete
    if (data.status === 'pending' && data.download_id) {
      const maxAttempts = 60;
      const pollInterval = 3000;

      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, pollInterval));

        const statusRes = await fetch(
          `${mixpostUrl}/mixpost/api/${workspaceUuid}/media/remote/${data.download_id}/status`,
          {
            headers: {
              Authorization: `Bearer ${tokenResult.token}`,
              Accept: 'application/json',
            },
          }
        );

        if (!statusRes.ok) {
          console.error(`Mixpost poll error: status=${statusRes.status}`);
          continue;
        }

        const statusData = await statusRes.json();

        if (statusData.status === 'completed' && statusData.media) {
          return NextResponse.json({ media: statusData.media });
        }

        if (statusData.status === 'failed') {
          return NextResponse.json(
            { error: statusData.error || 'Remote upload failed' },
            { status: 422 }
          );
        }
      }

      return NextResponse.json(
        { error: 'Media upload timed out' },
        { status: 504 }
      );
    }

    // Unexpected response shape — return as-is for debugging
    return NextResponse.json({ media: data });
  } catch (error) {
    console.error('Mixpost media upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
