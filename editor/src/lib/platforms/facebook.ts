import type { PublishResult } from './types';

const GRAPH_API = 'https://graph.facebook.com/v24.0';
const FETCH_TIMEOUT_MS = 30_000;

async function graphFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

export async function getFacebookPageToken(
  pageId: string,
  userToken: string
): Promise<string> {
  const res = await graphFetch(
    `${GRAPH_API}/${pageId}?fields=access_token&access_token=${encodeURIComponent(userToken)}`
  );
  const data = await res.json();

  if (!res.ok || !data.access_token) {
    throw new Error(
      `Failed to get page token: ${JSON.stringify(data.error || data)}`
    );
  }
  return data.access_token as string;
}

export async function publishPhoto(
  pageId: string,
  userToken: string,
  imageUrl: string,
  caption: string
): Promise<PublishResult> {
  try {
    const pageToken = await getFacebookPageToken(pageId, userToken);

    const res = await graphFetch(`${GRAPH_API}/${pageId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: imageUrl,
        message: caption,
        access_token: pageToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: `Photo upload failed: ${JSON.stringify(data.error || data)}` };
    }

    return { success: true, platformPostId: data.post_id || data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[facebook.publishPhoto]', msg);
    return { success: false, error: msg };
  }
}

export async function publishMultiPhoto(
  pageId: string,
  userToken: string,
  imageUrls: string[],
  caption: string
): Promise<PublishResult> {
  try {
    const pageToken = await getFacebookPageToken(pageId, userToken);

    // 1. Upload each photo as unpublished
    const photoIds: string[] = [];
    for (const url of imageUrls) {
      const res = await graphFetch(`${GRAPH_API}/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          published: false,
          access_token: pageToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: `Unpublished photo failed: ${JSON.stringify(data.error || data)}` };
      }
      photoIds.push(data.id as string);
    }

    // 2. Create feed post with attached media
    const attachedMedia: Record<string, string> = {};
    photoIds.forEach((id, i) => {
      attachedMedia[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
    });

    const params = new URLSearchParams({
      message: caption,
      access_token: pageToken,
      ...attachedMedia,
    });

    const res = await graphFetch(`${GRAPH_API}/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: `Multi-photo post failed: ${JSON.stringify(data.error || data)}` };
    }

    return { success: true, platformPostId: data.id as string };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[facebook.publishMultiPhoto]', msg);
    return { success: false, error: msg };
  }
}

export async function publishVideo(
  pageId: string,
  userToken: string,
  videoUrl: string,
  description: string
): Promise<PublishResult> {
  try {
    const pageToken = await getFacebookPageToken(pageId, userToken);

    const res = await graphFetch(`${GRAPH_API}/${pageId}/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_url: videoUrl,
        description,
        access_token: pageToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: `Video upload failed: ${JSON.stringify(data.error || data)}` };
    }

    return { success: true, platformPostId: data.id as string };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[facebook.publishVideo]', msg);
    return { success: false, error: msg };
  }
}

export async function deletePost(
  postId: string,
  pageId: string,
  userToken: string
): Promise<PublishResult> {
  try {
    const pageToken = await getFacebookPageToken(pageId, userToken);

    const res = await graphFetch(
      `${GRAPH_API}/${postId}?access_token=${encodeURIComponent(pageToken)}`,
      { method: 'DELETE' }
    );
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: `Delete failed: ${JSON.stringify(data.error || data)}` };
    }

    return { success: true, platformPostId: postId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[facebook.deletePost]', msg);
    return { success: false, error: msg };
  }
}

export async function updatePost(
  postId: string,
  pageId: string,
  userToken: string,
  message: string
): Promise<PublishResult> {
  try {
    const pageToken = await getFacebookPageToken(pageId, userToken);

    const res = await graphFetch(`${GRAPH_API}/${postId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        access_token: pageToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: `Update failed: ${JSON.stringify(data.error || data)}` };
    }

    return { success: true, platformPostId: postId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[facebook.updatePost]', msg);
    return { success: false, error: msg };
  }
}
