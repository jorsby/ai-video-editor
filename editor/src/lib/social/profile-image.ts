/**
 * Fetch profile image URLs directly from platform APIs.
 * Used during account sync to populate/refresh profile_image_url
 * for platforms where Octupost doesn't provide it (TikTok, Twitter)
 * or where URLs expire (Instagram, Facebook).
 */

export async function fetchProfileImageUrl(
  platform: string,
  accountId: string,
  accessToken: string
): Promise<string | null> {
  try {
    switch (platform) {
      case 'instagram':
        return await fetchInstagramProfileImage(accountId, accessToken);
      case 'facebook':
      case 'facebook_page':
        return await fetchFacebookProfileImage(accountId, accessToken);
      case 'tiktok':
        return await fetchTikTokProfileImage(accessToken);
      case 'twitter':
        return await fetchTwitterProfileImage(accessToken);
      case 'youtube':
        return await fetchYouTubeProfileImage(accountId, accessToken);
      default:
        return null;
    }
  } catch (err) {
    console.error(
      `[profile-image] Failed to fetch for ${platform}/${accountId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

async function fetchInstagramProfileImage(
  accountId: string,
  accessToken: string
): Promise<string | null> {
  // Instagram Business accounts use the Facebook Graph API
  const res = await fetch(
    `https://graph.facebook.com/v24.0/${accountId}?fields=profile_picture_url&access_token=${encodeURIComponent(accessToken)}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.profile_picture_url || null;
}

async function fetchFacebookProfileImage(
  pageId: string,
  accessToken: string
): Promise<string | null> {
  // redirect=false returns a JSON with a stable URL instead of a 302
  const res = await fetch(
    `https://graph.facebook.com/v24.0/${pageId}/picture?redirect=false&type=large&access_token=${encodeURIComponent(accessToken)}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.url || null;
}

async function fetchTikTokProfileImage(
  accessToken: string
): Promise<string | null> {
  const res = await fetch(
    'https://open.tiktokapis.com/v2/user/info/?fields=avatar_url_100',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.user?.avatar_url_100 || null;
}

async function fetchTwitterProfileImage(
  accessToken: string
): Promise<string | null> {
  const res = await fetch(
    'https://api.twitter.com/2/users/me?user.fields=profile_image_url',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.profile_image_url || null;
}

async function fetchYouTubeProfileImage(
  channelId: string,
  accessToken: string
): Promise<string | null> {
  // Use channel ID instead of mine=true to correctly resolve brand accounts
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(channelId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const thumbnails = data.items?.[0]?.snippet?.thumbnails;
  return thumbnails?.medium?.url || thumbnails?.default?.url || null;
}
