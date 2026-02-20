import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getOrCreateMixpostToken,
  clearCachedMixpostToken,
} from '@/lib/mixpost/token';
import type { PostFormData } from '@/types/post';

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

    const body = (await req.json()) as PostFormData & { mediaId: number };

    if (!body.accountIds || body.accountIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one account must be selected' },
        { status: 400 }
      );
    }

    if (!body.mediaId) {
      return NextResponse.json(
        { error: 'mediaId is required' },
        { status: 400 }
      );
    }

    // Build the Mixpost post payload
    const postPayload: Record<string, unknown> = {
      accounts: body.accountIds,
      versions: [
        {
          account_id: 0, // 0 = "original" version
          is_original: true,
          content: [
            {
              body: body.caption || '',
              media: [body.mediaId],
            },
          ],
          options: body.platformOptions || {},
        },
      ],
    };

    // Add schedule fields if scheduled
    if (body.scheduleType === 'scheduled' && body.scheduledDate && body.scheduledTime) {
      postPayload.date = body.scheduledDate;
      postPayload.time = body.scheduledTime;
      postPayload.timezone = body.timezone;
    }

    const response = await fetch(
      `${mixpostUrl}/mixpost/api/${workspaceUuid}/posts`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postPayload),
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
      const errorBody = await response.text();
      console.error(
        `Mixpost create post error: status=${response.status} body=${errorBody}`
      );
      return NextResponse.json(
        { error: `Failed to create post in Mixpost (${response.status})` },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({ post: data });
  } catch (error) {
    console.error('Mixpost create post error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
