import { createClient } from '@/lib/supabase/server';
import { fetchToken } from '@/lib/octupost/client';
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
    return {
      success: false,
      error:
        'YouTube token expired or insufficient permissions. Please re-authorize your account.',
    };
  }
  const body = await res.text();
  return {
    success: false,
    error: `YouTube delete failed (${res.status}): ${body}`,
  };
}

async function deleteFacebook(
  postId: string,
  providerId: string,
  userAccessToken: string
): Promise<{ success: boolean; error?: string }> {
  let pageToken: string;
  try {
    pageToken = await getFacebookPageToken(providerId, userAccessToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to get page token';
    return { success: false, error: msg };
  }

  const url = `https://graph.facebook.com/v24.0/${postId}?access_token=${encodeURIComponent(pageToken)}`;
  const res = await fetch(url, { method: 'DELETE' });
  const body = await res.text();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      let parsedError: { error?: { code?: number; message?: string } } | null =
        null;
      try {
        parsedError = JSON.parse(body);
      } catch {
        /* ignore */
      }
      const fbCode = parsedError?.error?.code;
      if (fbCode === 200) {
        return {
          success: false,
          error: `This post cannot be deleted because it was not published through this application. Facebook only allows deleting posts that were originally created via the app.`,
        };
      }
      return {
        success: false,
        error: `Facebook token expired or insufficient permissions (${res.status}). Response: ${body}. Please re-authorize your account.`,
      };
    }
    return {
      success: false,
      error: `Facebook delete failed (${res.status}): ${body}`,
    };
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
    return {
      success: false,
      error:
        'YouTube token expired or insufficient permissions. Please re-authorize your account.',
    };
  }
  if (!getRes.ok) {
    const body = await getRes.text();
    return {
      success: false,
      error: `Failed to fetch video from YouTube: ${body}`,
    };
  }

  const getData = await getRes.json();
  const video = getData.items?.[0];
  if (!video) {
    return { success: false, error: 'Video not found on YouTube' };
  }

  const snippet = { ...video.snippet };
  if (fields.title !== undefined) snippet.title = fields.title;
  if (fields.description !== undefined)
    snippet.description = fields.description;

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

  const res = await fetch(`https://graph.facebook.com/v24.0/${postId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: fields.message, access_token: pageToken }),
  });

  if (res.status === 401 || res.status === 403) {
    return {
      success: false,
      error:
        'Facebook token expired or insufficient permissions. Please re-authorize your account.',
    };
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { platformPostId, accountId } = body;

    if (!accountId || !platformPostId) {
      return NextResponse.json(
        { error: 'accountId and platformPostId are required' },
        { status: 400 }
      );
    }

    const token = await fetchToken(accountId);
    const provider = token.platform;
    const accessToken = token.access_token;
    // For Facebook, account_id is the page/provider ID
    const providerId = token.account_id;

    let result: { success: boolean; error?: string };

    if (provider === 'youtube') {
      result = await deleteYouTube(platformPostId, accessToken);
    } else if (provider === 'facebook_page' || provider === 'facebook') {
      result = await deleteFacebook(platformPostId, providerId, accessToken);
    } else {
      return NextResponse.json(
        { error: `Deleting is not supported for ${provider}` },
        { status: 400 }
      );
    }

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Platform delete error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/social/posts — Edit a post on the platform
 */
export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { platformPostId, accountId, fields } = await req.json();
    if (!platformPostId || !accountId || !fields) {
      return NextResponse.json(
        { error: 'platformPostId, accountId, and fields are required' },
        { status: 400 }
      );
    }

    const token = await fetchToken(accountId);
    const provider = token.platform;
    const accessToken = token.access_token;
    const providerId = token.account_id;

    let result: { success: boolean; error?: string };

    if (provider === 'youtube') {
      result = await updateYouTube(platformPostId, accessToken, fields);
    } else if (provider === 'facebook_page' || provider === 'facebook') {
      result = await updateFacebook(
        platformPostId,
        providerId,
        accessToken,
        fields
      );
    } else {
      return NextResponse.json(
        { error: `Editing is not supported for ${provider}` },
        { status: 400 }
      );
    }

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Platform edit error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
