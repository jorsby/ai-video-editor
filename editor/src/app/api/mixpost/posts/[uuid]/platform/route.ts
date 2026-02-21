import { createClient } from '@/lib/supabase/server';
import { getPlatformCredentials } from '@/lib/mixpost/platform-credentials';
import { getFacebookPageToken } from '@/lib/social/providers/facebook';
import { NextResponse, type NextRequest } from 'next/server';

async function updateYouTube(
  videoId: string,
  accessToken: string,
  fields: { title?: string; description?: string }
): Promise<{ success: boolean; error?: string }> {
  // Fetch current video snippet to preserve categoryId and other required fields
  const getRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (getRes.status === 401 || getRes.status === 403) {
    return {
      success: false,
      error: 'YouTube token expired or insufficient permissions. Please re-authorize in Mixpost.',
    };
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

  // Merge updates into existing snippet
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
      body: JSON.stringify({
        id: videoId,
        snippet,
      }),
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
      body: JSON.stringify({
        message: fields.message,
        access_token: pageToken,
      }),
    }
  );

  if (res.status === 401 || res.status === 403) {
    return {
      success: false,
      error: 'Facebook token expired or insufficient permissions. Please re-authorize in Mixpost.',
    };
  }

  if (!res.ok) {
    const body = await res.text();
    return { success: false, error: `Facebook update failed: ${body}` };
  }

  return { success: true };
}

export async function PUT(
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

    const { uuid } = await params;
    const { accountId, fields } = await req.json();

    if (!accountId || !fields) {
      return NextResponse.json(
        { error: 'accountId and fields are required' },
        { status: 400 }
      );
    }

    // Get platform credentials from Mixpost DB
    let credentials;
    try {
      credentials = await getPlatformCredentials(supabase, uuid, accountId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get credentials';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { provider, providerId, providerPostId, accessToken } = credentials;

    let result: { success: boolean; error?: string };

    if (provider === 'youtube') {
      result = await updateYouTube(providerPostId, accessToken, fields);
    } else if (provider === 'facebook_page' || provider === 'facebook') {
      result = await updateFacebook(providerPostId, providerId, accessToken, fields);
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
    console.error('Platform update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
