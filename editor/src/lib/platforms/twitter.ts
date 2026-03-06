import type { PublishResult } from './types';

const TWITTER_API = 'https://api.x.com/2';
const UPLOAD_API = 'https://upload.twitter.com/1.1';
const FETCH_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1_000;

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function uploadMedia(token: string, mediaUrl: string): Promise<string> {
  // Download media
  const downloadRes = await fetch(mediaUrl, {
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!downloadRes.ok) {
    throw new Error(`Failed to download media: ${downloadRes.status}`);
  }

  const buffer = await downloadRes.arrayBuffer();
  const contentType = downloadRes.headers.get('content-type') || 'image/jpeg';

  // INIT
  const initRes = await fetch(`${UPLOAD_API}/media/upload.json`, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      command: 'INIT',
      total_bytes: String(buffer.byteLength),
      media_type: contentType,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const initData = await initRes.json();
  if (!initRes.ok) {
    throw new Error(`Media INIT failed: ${JSON.stringify(initData)}`);
  }
  const mediaId = initData.media_id_string as string;

  // APPEND
  const blob = new Blob([buffer], { type: contentType });
  const formData = new FormData();
  formData.append('command', 'APPEND');
  formData.append('media_id', mediaId);
  formData.append('segment_index', '0');
  formData.append('media', blob);

  const appendRes = await fetch(`${UPLOAD_API}/media/upload.json`, {
    method: 'POST',
    headers: authHeaders(token),
    body: formData,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!appendRes.ok) {
    const err = await appendRes.text();
    throw new Error(`Media APPEND failed: ${err}`);
  }

  // FINALIZE
  const finalRes = await fetch(`${UPLOAD_API}/media/upload.json`, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      command: 'FINALIZE',
      media_id: mediaId,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const finalData = await finalRes.json();
  if (!finalRes.ok) {
    throw new Error(`Media FINALIZE failed: ${JSON.stringify(finalData)}`);
  }

  // If processing_info exists, poll until complete
  if (finalData.processing_info) {
    await waitForProcessing(token, mediaId);
  }

  return mediaId;
}

async function waitForProcessing(
  token: string,
  mediaId: string
): Promise<void> {
  const maxWait = 5 * 60 * 1_000;
  const start = Date.now();
  let delay = 5_000;

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, delay));

    const res = await fetch(
      `${UPLOAD_API}/media/upload.json?command=STATUS&media_id=${mediaId}`,
      {
        headers: authHeaders(token),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    const data = await res.json();
    const info = data.processing_info;

    if (!info || info.state === 'succeeded') return;
    if (info.state === 'failed') {
      throw new Error(
        `Media processing failed: ${JSON.stringify(info.error || info)}`
      );
    }

    delay = Math.min((info.check_after_secs || 5) * 1_000, 30_000);
  }

  throw new Error('Media processing timed out');
}

export async function postTweet(
  token: string,
  text: string,
  mediaUrl?: string
): Promise<PublishResult> {
  try {
    let mediaId: string | undefined;
    if (mediaUrl) {
      mediaId = await uploadMedia(token, mediaUrl);
    }

    const body: Record<string, unknown> = { text };
    if (mediaId) {
      body.media = { media_ids: [mediaId] };
    }

    const res = await fetch(`${TWITTER_API}/tweets`, {
      method: 'POST',
      headers: {
        ...authHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: `Tweet failed: ${JSON.stringify(data)}` };
    }

    return { success: true, platformPostId: data.data?.id as string };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[twitter.postTweet]', msg);
    return { success: false, error: msg };
  }
}

export async function deleteTweet(
  token: string,
  tweetId: string
): Promise<PublishResult> {
  try {
    const res = await fetch(
      `${TWITTER_API}/tweets/${encodeURIComponent(tweetId)}`,
      {
        method: 'DELETE',
        headers: authHeaders(token),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );

    if (res.ok) {
      return { success: true, platformPostId: tweetId };
    }

    const data = await res.json().catch(() => null);
    return {
      success: false,
      error: `Delete tweet failed: ${JSON.stringify(data || res.status)}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[twitter.deleteTweet]', msg);
    return { success: false, error: msg };
  }
}
