import { createClient } from '@/lib/supabase/server';
import {
  getOrCreateMixpostToken,
  clearCachedMixpostToken,
} from '@/lib/mixpost/token';
import { NextResponse, type NextRequest } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
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

    const { uuid } = await params;

    const response = await fetch(
      `${mixpostUrl}/mixpost/api/${workspaceUuid}/posts/${uuid}`,
      {
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
          Accept: 'application/json',
        },
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
      const body = await response.text();
      console.error(
        `Mixpost get post error: status=${response.status} body=${body}`
      );
      return NextResponse.json(
        { error: `Failed to fetch post from Mixpost (${response.status})` },
        { status: response.status }
      );
    }

    const rawBody = await response.json();

    // Mixpost may return the post directly or wrapped in { data: ... }
    const post = rawBody.data ?? rawBody;

    // Log post status and account errors for debugging publish failures
    if (post.status === 'failed' || post.status === 4) {
      const accountSummary = Array.isArray(post.accounts)
        ? post.accounts.map((a: Record<string, unknown>) => ({
            id: a.id,
            name: a.name,
            provider: a.provider,
            errors: a.errors,
            external_url: a.external_url,
            pivot_errors: (a.pivot as Record<string, unknown> | undefined)?.errors,
          }))
        : 'no accounts in response';
      console.error(
        `Mixpost post failed: uuid=${post.uuid} status=${post.status} accounts=${JSON.stringify(accountSummary)}`
      );
    }

    return NextResponse.json({ post });
  } catch (error) {
    console.error('Fetch Mixpost post error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
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

    const { uuid } = await params;

    const response = await fetch(
      `${mixpostUrl}/mixpost/api/${workspaceUuid}/posts/${uuid}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokenResult.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trash: false, delete_mode: 'app_only' }),
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
      const body = await response.text();
      console.error(
        `Mixpost delete post error: status=${response.status} body=${body}`
      );
      return NextResponse.json(
        { error: `Failed to delete post from Mixpost (${response.status})` },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete Mixpost post error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
