import { createClient } from '@/lib/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';
import { fetchToken } from '@/lib/octupost/client';
import { fetchInstagramMedia, TokenExpiredError, RateLimitError, PlatformApiError } from '@/lib/social/providers/instagram';
import { fetchTikTokMedia } from '@/lib/social/providers/tiktok';
import { fetchYouTubeMedia } from '@/lib/social/providers/youtube';
import { fetchFacebookMedia } from '@/lib/social/providers/facebook';
import type { PlatformMediaItem } from '@/lib/social/types';

function transformToPosts(
  items: PlatformMediaItem[],
  account: {
    accountId: string;
    name: string;
    provider: string;
  }
) {
  return items.map((item) => ({
    id: `${account.provider.slice(0, 2)}-${item.platformId}`,
    platform_post_id: item.platformId,
    caption: item.title ? `${item.title}\n\n${item.caption}` : item.caption,
    media_url: item.mediaUrl || item.thumbnailUrl || null,
    media_type: item.mediaType,
    permalink: item.permalink,
    published_at: item.publishedAt,
    provider: item.provider,
    account_id: account.accountId,
    account_name: account.name,
    _source: 'platform' as const,
  }));
}

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
    const accountId = searchParams.get('accountId');
    const limitParam = searchParams.get('limit');

    if (!accountId) {
      return NextResponse.json({ error: 'Missing accountId parameter' }, { status: 400 });
    }

    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50;

    // Verify account belongs to the authenticated user
    const socialSupabase = await createClient('social_auth');
    const { data: ownedAccount } = await socialSupabase
      .from('tokens')
      .select('account_id')
      .eq('account_id', accountId)
      .eq('user_id', user.id)
      .single();

    if (!ownedAccount) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    let token;
    try {
      token = await fetchToken(accountId);
    } catch (err) {
      console.error('Failed to get account credentials:', err);
      return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
    }

    const { platform: provider, access_token: accessToken, account_id: providerId, account_name: name } = token;

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

    const posts = transformToPosts(items, {
      accountId,
      name,
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
