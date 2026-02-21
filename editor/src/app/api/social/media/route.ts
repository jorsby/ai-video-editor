import { createClient } from '@/lib/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';
import { getAccountCredentials } from '@/lib/mixpost/account-credentials';
import { transformToMixpostPosts } from '@/lib/social/transform';
import { fetchInstagramMedia, TokenExpiredError, RateLimitError, PlatformApiError } from '@/lib/social/providers/instagram';
import { fetchTikTokMedia } from '@/lib/social/providers/tiktok';
import { fetchYouTubeMedia } from '@/lib/social/providers/youtube';
import { fetchFacebookMedia } from '@/lib/social/providers/facebook';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const accountIdParam = searchParams.get('accountId');
    const limitParam = searchParams.get('limit');

    if (!accountIdParam) {
      return NextResponse.json({ error: 'Missing accountId parameter' }, { status: 400 });
    }

    const accountId = parseInt(accountIdParam, 10);
    if (isNaN(accountId)) {
      return NextResponse.json({ error: 'Invalid accountId' }, { status: 400 });
    }

    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50;

    let credentials;
    try {
      credentials = await getAccountCredentials(supabase, accountId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get account credentials';
      const status = message.includes('No access token') ? 403 : 500;
      return NextResponse.json({ error: message }, { status });
    }

    const { provider, providerId, accessToken, accountUuid, name, username } = credentials;

    let items;
    try {
      switch (provider) {
        case 'instagram':
          items = await fetchInstagramMedia(providerId, accessToken, limit);
          break;
        case 'tiktok':
          items = await fetchTikTokMedia(accessToken, limit);
          break;
        case 'youtube':
          items = await fetchYouTubeMedia(accessToken, limit);
          break;
        case 'facebook':
        case 'facebook_page':
          items = await fetchFacebookMedia(providerId, accessToken, limit);
          break;
        default:
          return NextResponse.json(
            { error: `Unsupported provider: ${provider}` },
            { status: 400 }
          );
      }
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        return NextResponse.json({ error: err.message, tokenExpired: true }, { status: 403 });
      }
      if (err instanceof RateLimitError) {
        return NextResponse.json({ error: err.message }, { status: 502 });
      }
      if (err instanceof PlatformApiError) {
        return NextResponse.json({ error: err.message }, { status: 502 });
      }
      const message = err instanceof Error ? err.message : 'Unknown platform API error';
      return NextResponse.json({ error: `Failed to fetch media from ${provider}. ${message}` }, { status: 502 });
    }

    const posts = transformToMixpostPosts(items, {
      id: accountId,
      uuid: accountUuid,
      name,
      username,
      provider,
    });

    return NextResponse.json({ posts, source: 'platform' });
  } catch (error) {
    console.error('Social media fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
