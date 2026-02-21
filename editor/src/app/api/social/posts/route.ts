import { createClient } from '@/lib/supabase/server';
import { getAccountCredentials } from '@/lib/mixpost/account-credentials';
import { getPlatformCredentials } from '@/lib/mixpost/platform-credentials';
import { getFacebookPageToken } from '@/lib/social/providers/facebook';
import { NextResponse, type NextRequest } from 'next/server';

async function deleteYouTube(
  videoId: string,
  accessToken: string
): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(videoId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (res.status === 204 || res.status === 200) {
    return { success: true };
  }
  if (res.status === 401 || res.status === 403) {
    return { success: false, error: 'YouTube token expired or insufficient permissions. Please re-authorize in Mixpost.' };
  }
  const body = await res.text();
  return { success: false, error: `YouTube delete failed (${res.status}): ${body}` };
}

async function deleteFacebook(
  postId: string,
  providerId: string,
  userAccessToken: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[deleteFacebook] Starting delete', {
    postId,
    providerId,
    hasUserAccessToken: !!userAccessToken,
    tokenLength: userAccessToken?.length,
    tokenPrefix: userAccessToken?.substring(0, 10) + '...',
  });

  let pageToken: string;
  try {
    pageToken = await getFacebookPageToken(providerId, userAccessToken);
    console.log('[deleteFacebook] Got page token successfully', {
      pageTokenLength: pageToken?.length,
      pageTokenPrefix: pageToken?.substring(0, 10) + '...',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to get page token';
    console.error('[deleteFacebook] Failed to get page token', {
      errorName: err instanceof Error ? err.constructor.name : typeof err,
      errorMessage: msg,
    });
    return { success: false, error: msg };
  }

  const url = `https://graph.facebook.com/v24.0/${postId}?access_token=${encodeURIComponent(pageToken)}`;
  console.log('[deleteFacebook] Calling Facebook Graph API DELETE', {
    url: url.replace(/access_token=[^&]+/, 'access_token=REDACTED'),
  });

  const res = await fetch(url, { method: 'DELETE' });
  const body = await res.text();

  console.log('[deleteFacebook] Facebook API response', {
    status: res.status,
    statusText: res.statusText,
    body,
    headers: Object.fromEntries(res.headers.entries()),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      let parsedError: { error?: { code?: number; message?: string } } | null = null;
      try { parsedError = JSON.parse(body); } catch { /* ignore */ }
      const fbCode = parsedError?.error?.code;
      console.error('[deleteFacebook] Token/permission error from Facebook', {
        status: res.status,
        body,
        fbCode,
        postId,
        providerId,
      });
      // Facebook error code 200 = app doesn't own this post — not a token issue
      if (fbCode === 200) {
        return { success: false, error: `This post cannot be deleted because it was not published through this application. Facebook only allows deleting posts that were originally created via the app.` };
      }
      return { success: false, error: `Facebook token expired or insufficient permissions (${res.status}). Response: ${body}. Please re-authorize in Mixpost.` };
    }
    return { success: false, error: `Facebook delete failed (${res.status}): ${body}` };
  }
  return { success: true };
}

async function updateYouTube(
  videoId: string,
  accessToken: string,
  fields: { title?: string; description?: string }
): Promise<{ success: boolean; error?: string }> {
  const getRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (getRes.status === 401 || getRes.status === 403) {
    return { success: false, error: 'YouTube token expired or insufficient permissions. Please re-authorize in Mixpost.' };
  }
  if (!getRes.ok) {
    const body = await getRes.text();
    return { success: false, error: `Failed to fetch video from YouTube: ${body}` };
  }

  const getData = await getRes.json();
  const video = getData.items?.[0];
  if (!video) {
    return { success: false, error: 'Video not found on YouTube' };
  }

  const snippet = { ...video.snippet };
  if (fields.title !== undefined) snippet.title = fields.title;
  if (fields.description !== undefined) snippet.description = fields.description;

  const putRes = await fetch(
    'https://www.googleapis.com/youtube/v3/videos?part=snippet',
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: videoId, snippet }),
    }
  );

  if (!putRes.ok) {
    const body = await putRes.text();
    return { success: false, error: `YouTube update failed: ${body}` };
  }
  return { success: true };
}

async function updateFacebook(
  postId: string,
  providerId: string,
  userAccessToken: string,
  fields: { message?: string }
): Promise<{ success: boolean; error?: string }> {
  if (!fields.message) {
    return { success: false, error: 'No message provided for Facebook update' };
  }

  let pageToken: string;
  try {
    pageToken = await getFacebookPageToken(providerId, userAccessToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to get page token';
    return { success: false, error: msg };
  }

  const res = await fetch(
    `https://graph.facebook.com/v24.0/${postId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: fields.message, access_token: pageToken }),
    }
  );

  if (res.status === 401 || res.status === 403) {
    return { success: false, error: 'Facebook token expired or insufficient permissions. Please re-authorize in Mixpost.' };
  }
  if (!res.ok) {
    const body = await res.text();
    return { success: false, error: `Facebook update failed: ${body}` };
  }
  return { success: true };
}

/**
 * DELETE /api/social/posts — Delete a post from the platform (YouTube/Facebook)
 */
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { platformPostId, accountId, mixpostUuid } = body;
    console.log('[DELETE /api/social/posts] Request received', {
      platformPostId,
      accountId,
      mixpostUuid,
      hasplatformPostId: !!platformPostId,
      hasAccountId: !!accountId,
      hasMixpostUuid: !!mixpostUuid,
    });

    if (!accountId || (!platformPostId && !mixpostUuid)) {
      return NextResponse.json({ error: 'accountId and either platformPostId or mixpostUuid are required' }, { status: 400 });
    }

    // Resolve the actual platform post ID
    let resolvedPostId = platformPostId;
    let provider: string;
    let providerId: string;
    let accessToken: string;

    if (mixpostUuid) {
      // Mixpost post: look up the platform post ID from the DB
      try {
        const creds = await getPlatformCredentials(supabase, mixpostUuid, accountId);
        resolvedPostId = creds.providerPostId;
        provider = creds.provider;
        providerId = creds.providerId;
        accessToken = creds.accessToken;
        console.log('[DELETE /api/social/posts] Got platform credentials', {
          resolvedPostId,
          provider,
          providerId,
          hasAccessToken: !!accessToken,
          tokenLength: accessToken?.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to get credentials';
        console.error('[DELETE /api/social/posts] Failed to get platform credentials', {
          mixpostUuid,
          accountId,
          error: message,
        });
        return NextResponse.json({ error: message }, { status: 400 });
      }
    } else {
      // Synced platform post: use account credentials directly
      try {
        const creds = await getAccountCredentials(supabase, accountId);
        provider = creds.provider;
        providerId = creds.providerId;
        accessToken = creds.accessToken;
        console.log('[DELETE /api/social/posts] Got account credentials', {
          resolvedPostId,
          provider,
          providerId,
          hasAccessToken: !!accessToken,
          tokenLength: accessToken?.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to get credentials';
        console.error('[DELETE /api/social/posts] Failed to get account credentials', {
          accountId,
          error: message,
        });
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    let result: { success: boolean; error?: string };

    if (provider === 'youtube') {
      result = await deleteYouTube(resolvedPostId, accessToken);
    } else if (provider === 'facebook_page' || provider === 'facebook') {
      result = await deleteFacebook(resolvedPostId, providerId, accessToken);
    } else {
      return NextResponse.json({ error: `Deleting is not supported for ${provider}` }, { status: 400 });
    }

    console.log('[DELETE /api/social/posts] Delete result', {
      success: result.success,
      error: result.error,
      provider,
      resolvedPostId,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Platform delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/social/posts — Edit a post on the platform (for synced posts without Mixpost UUID)
 */
export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { platformPostId, accountId, fields } = await req.json();
    if (!platformPostId || !accountId || !fields) {
      return NextResponse.json({ error: 'platformPostId, accountId, and fields are required' }, { status: 400 });
    }

    let credentials;
    try {
      credentials = await getAccountCredentials(supabase, accountId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get credentials';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { provider, providerId, accessToken } = credentials;
    let result: { success: boolean; error?: string };

    if (provider === 'youtube') {
      result = await updateYouTube(platformPostId, accessToken, fields);
    } else if (provider === 'facebook_page' || provider === 'facebook') {
      result = await updateFacebook(platformPostId, providerId, accessToken, fields);
    } else {
      return NextResponse.json({ error: `Editing is not supported for ${provider}` }, { status: 400 });
    }

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Platform edit error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
