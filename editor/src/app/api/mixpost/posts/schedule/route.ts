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

    const { postUuid, postNow } = await req.json();

    if (!postUuid) {
      return NextResponse.json(
        { error: 'postUuid is required' },
        { status: 400 }
      );
    }

    const schedulePayload: Record<string, unknown> = {};
    if (postNow) {
      schedulePayload.postNow = true;
    }

    const response = await fetch(
      `${mixpostUrl}/mixpost/api/${workspaceUuid}/posts/schedule/${postUuid}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(schedulePayload),
        signal: AbortSignal.timeout(30_000),
      }
    );

    if (response.status === 401) {
      await clearCachedMixpostToken(supabase, user.id, tokenResult.mixpostUserId);
      console.error('Mixpost token rejected (401). Cleared cached token.');
      return NextResponse.json(
        { error: 'Mixpost token expired. Please retry.' },
        { status: 401 }
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Mixpost schedule post error: status=${response.status} body=${errorBody}`
      );
      return NextResponse.json(
        { error: `Failed to schedule post in Mixpost (${response.status})` },
        { status: response.status }
      );
    }

    // Mixpost may return 204 No Content or an empty body on success
    let data: Record<string, unknown> = {};
    const responseText = await response.text();
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        // Non-JSON response is fine — the schedule action succeeded
      }
    }

    return NextResponse.json({
      success: true,
      scheduled_at: data.scheduled_at || null,
      postUuid,
    });
  } catch (error) {
    console.error('Mixpost schedule post error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
