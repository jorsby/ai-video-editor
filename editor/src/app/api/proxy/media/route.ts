import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ALLOWED_DOMAINS = [
  'r2.dev',
  'fal.media',
  'fal.ai',
  'pexels.com',
  'cloud-45c.workers.dev',
  'elevenlabs.io',
  'scenify.io',
  'oss-accelerate.aliyuncs.com',
  'aiquickdraw.com',
];

function isDomainAllowed(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = request.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json(
      { error: 'Missing url parameter' },
      { status: 400 }
    );
  }

  if (!isDomainAllowed(url)) {
    return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
  }

  try {
    const range = request.headers.get('range');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    const upstream = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: range ? { Range: range } : undefined,
    });
    clearTimeout(timeoutId);

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: `Upstream returned ${upstream.status}` },
        { status: upstream.status }
      );
    }

    const headers = new Headers();
    const passthroughHeaders = [
      'content-type',
      'content-length',
      'accept-ranges',
      'content-range',
      'cache-control',
      'etag',
      'last-modified',
    ];

    for (const headerName of passthroughHeaders) {
      const headerValue = upstream.headers.get(headerName);
      if (headerValue) {
        headers.set(headerName, headerValue);
      }
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return NextResponse.json({ error: 'Operation failed' }, { status: 502 });
  }
}
