import type { PublishResult } from './types';

const YT_API = 'https://www.googleapis.com/youtube/v3';
const YT_UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';
const FETCH_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1_000; // 10 min for large videos

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function uploadVideo(
  token: string,
  videoUrl: string,
  title: string,
  description: string,
  privacy: string = 'private'
): Promise<PublishResult> {
  try {
    // 1. Download video to buffer
    const downloadRes = await fetch(videoUrl, {
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!downloadRes.ok) {
      return {
        success: false,
        error: `Failed to download video: ${downloadRes.status}`,
      };
    }
    const videoBuffer = await downloadRes.arrayBuffer();
    const contentType = downloadRes.headers.get('content-type') || 'video/mp4';

    // 2. Initiate resumable upload
    const metadata = {
      snippet: { title, description, categoryId: '22' },
      status: { privacyStatus: privacy },
    };

    const initRes = await fetch(
      `${YT_UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`,
      {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(videoBuffer.byteLength),
          'X-Upload-Content-Type': contentType,
        },
        body: JSON.stringify(metadata),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    if (!initRes.ok) {
      const err = await initRes.text();
      return { success: false, error: `Resumable upload init failed: ${err}` };
    }

    const uploadUri = initRes.headers.get('location');
    if (!uploadUri) {
      return { success: false, error: 'No upload URI returned from YouTube' };
    }

    // 3. Upload video binary
    const uploadRes = await fetch(uploadUri, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: videoBuffer,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) {
      return {
        success: false,
        error: `Upload failed: ${JSON.stringify(uploadData.error || uploadData)}`,
      };
    }

    return { success: true, platformPostId: uploadData.id as string };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[youtube.uploadVideo]', msg);
    return { success: false, error: msg };
  }
}

export async function deleteVideo(
  token: string,
  videoId: string
): Promise<PublishResult> {
  try {
    const res = await fetch(
      `${YT_API}/videos?id=${encodeURIComponent(videoId)}`,
      {
        method: 'DELETE',
        headers: authHeaders(token),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );

    if (res.status === 204 || res.ok) {
      return { success: true, platformPostId: videoId };
    }

    const data = await res.json().catch(() => null);
    return {
      success: false,
      error: `Delete failed: ${JSON.stringify(data?.error || res.status)}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[youtube.deleteVideo]', msg);
    return { success: false, error: msg };
  }
}

export async function updateVideo(
  token: string,
  videoId: string,
  fields: { title?: string; description?: string }
): Promise<PublishResult> {
  try {
    // 1. Get current snippet
    const getRes = await fetch(
      `${YT_API}/videos?part=snippet&id=${encodeURIComponent(videoId)}`,
      {
        headers: authHeaders(token),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    const getData = await getRes.json();
    if (!getRes.ok || !getData.items?.length) {
      return {
        success: false,
        error: `Failed to get video: ${JSON.stringify(getData.error || getData)}`,
      };
    }

    const snippet = getData.items[0].snippet;

    // 2. Merge fields
    if (fields.title !== undefined) snippet.title = fields.title;
    if (fields.description !== undefined)
      snippet.description = fields.description;

    // 3. Update
    const updateRes = await fetch(`${YT_API}/videos?part=snippet`, {
      method: 'PUT',
      headers: {
        ...authHeaders(token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: videoId, snippet }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const updateData = await updateRes.json();
    if (!updateRes.ok) {
      return {
        success: false,
        error: `Update failed: ${JSON.stringify(updateData.error || updateData)}`,
      };
    }

    return { success: true, platformPostId: videoId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[youtube.updateVideo]', msg);
    return { success: false, error: msg };
  }
}
