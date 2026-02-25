import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getOrCreateMixpostToken,
  clearCachedMixpostToken,
} from '@/lib/mixpost/token';
import type { PostFormData } from '@/types/post';
import { validateScheduleNotInPast } from '@/lib/schedule-validation';

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

    // Map our internal platformOptions to Mixpost's nested options format.
    // Mixpost stores options keyed by provider name (PostContentParser.getVersionOptions()
    // reads: Arr::get(options, account.provider, [])). Provider keys:
    //   - YouTube  → "youtube"       fields: title, status
    //   - Instagram → "instagram"    fields: type ("post" | "reel" | "story")
    //   - Facebook  → "facebook_page" fields: type ("post" | "reel" | "story")
    //   - TikTok    → "tiktok"       fields: keyed by numeric account id string
    const versionOptions: Record<string, unknown> = {};

    const ig = body.platformOptions?.instagram;
    if (ig) {
      versionOptions.instagram = { type: ig.type };
    }

    const fb = body.platformOptions?.facebook;
    if (fb) {
      versionOptions.facebook_page = { type: fb.type };
    }

    const yt = body.platformOptions?.youtube;
    if (yt) {
      versionOptions.youtube = {
        title: yt.title,
        status: yt.status,
      };
    }

    const ttk = body.platformOptions?.tiktok;
    if (ttk) {
      // Convert "account-{id}" keys → numeric id string keys as Mixpost expects
      const tiktokMapped: Record<string, unknown> = {};
      for (const [key, opts] of Object.entries(ttk)) {
        const numericId = key.replace('account-', '');
        tiktokMapped[numericId] = opts;
      }
      versionOptions.tiktok = tiktokMapped;
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
              url: null,
            },
          ],
          options: versionOptions,
        },
      ],
    };

    // Add schedule fields if scheduled
    if (body.scheduleType === 'scheduled') {
      if (!body.scheduledDate || !body.scheduledTime) {
        return NextResponse.json(
          { error: 'scheduledDate and scheduledTime are required for scheduled posts' },
          { status: 400 }
        );
      }
      const scheduleError = validateScheduleNotInPast(
        body.scheduledDate, body.scheduledTime, body.timezone || 'UTC', 2
      );
      if (scheduleError) {
        return NextResponse.json({ error: scheduleError }, { status: 400 });
      }
      postPayload.date = body.scheduledDate;
      postPayload.time = body.scheduledTime;
      postPayload.timezone = body.timezone || 'UTC';
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
        `Mixpost create post error: status=${response.status} body=${errorBody}`
      );
      let detail: string;
      try {
        const parsed = JSON.parse(errorBody);
        detail = parsed.message ?? parsed.error ?? errorBody;
      } catch {
        detail = errorBody || `HTTP ${response.status}`;
      }
      return NextResponse.json(
        { error: `Failed to create post: ${detail}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({ post: data });
  } catch (error) {
    console.error('Mixpost create post error:', error);
    return NextResponse.json(
      { error: `Internal server error: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
