import { type NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ALLOWED_DOMAINS = [
  'r2.dev',
  'fal.media',
  'fal.ai',
  'pexels.com',
  'cloud-45c.workers.dev',
  'elevenlabs.io',
  'scenify.io',
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);
    const upstream = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${upstream.status}` },
        { status: upstream.status }
      );
    }

    const headers = new Headers();
    const contentType = upstream.headers.get('content-type');
    if (contentType) {
      headers.set('Content-Type', contentType);
    }
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    return NextResponse.json(
      { error: `Fetch failed: ${(error as Error).message}` },
      { status: 502 }
    );
  }
}
