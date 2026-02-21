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

    // Validate URL to prevent SSRF — only allow HTTPS from our own storage domain
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    if (parsedUrl.protocol !== 'https:') {
      return NextResponse.json({ error: 'URL must use HTTPS' }, { status: 400 });
    }

    const allowedHostnames: string[] = [];
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    if (supabaseUrl) allowedHostnames.push(new URL(supabaseUrl).hostname);
    const r2Domain = process.env.R2_PUBLIC_DOMAIN ?? '';
    if (r2Domain) allowedHostnames.push(new URL(r2Domain).hostname);

    if (allowedHostnames.length === 0 || !allowedHostnames.includes(parsedUrl.hostname)) {
      return NextResponse.json({ error: 'URL domain not allowed' }, { status: 400 });
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
        `Mixpost media upload error: status=${response.status} body=${body}`
      );
      let detail: string;
      try {
        const parsed = JSON.parse(body);
        detail = parsed.message ?? parsed.error ?? body;
      } catch {
        detail = body || `HTTP ${response.status}`;
      }
      return NextResponse.json(
        { error: `Failed to upload media: ${detail}` },
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
            signal: AbortSignal.timeout(10_000),
          }
        );

        if (statusRes.status === 401) {
          await clearCachedMixpostToken(supabase, user.id, tokenResult.mixpostUserId);
          return NextResponse.json(
            { error: 'Mixpost token expired during upload. Please retry.' },
            { status: 401 }
          );
        }

        if (!statusRes.ok) {
          const errBody = await statusRes.text();
          console.error(`Mixpost poll error: status=${statusRes.status} body=${errBody}`);
          let detail: string;
          try {
            const parsed = JSON.parse(errBody);
            detail = parsed.message ?? parsed.error ?? errBody;
          } catch {
            detail = errBody || `HTTP ${statusRes.status}`;
          }
          return NextResponse.json(
            { error: `Media upload check failed: ${detail}` },
            { status: statusRes.status }
          );
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

    // Unexpected response shape
    console.error('Mixpost media: unexpected response shape', data);
    return NextResponse.json(
      { error: 'Unexpected response from Mixpost media upload' },
      { status: 502 }
    );
  } catch (error) {
    console.error('Mixpost media upload error:', error);
    return NextResponse.json(
      { error: `Internal server error: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
