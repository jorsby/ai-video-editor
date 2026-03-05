import type { PublishResult } from './types';

const TIKTOK_API = 'https://open.tiktokapis.com';
const FETCH_TIMEOUT_MS = 30_000;

export async function publishVideo(
  token: string,
  videoUrl: string,
  title: string
): Promise<PublishResult> {
  try {
    const res = await fetch(`${TIKTOK_API}/v2/post/publish/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
        post_info: {
          title,
          privacy_level: 'SELF_ONLY',
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: videoUrl,
        },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const data = await res.json();

    if (!res.ok || data.error?.code !== 'ok') {
      return {
        success: false,
        error: `TikTok publish failed: ${JSON.stringify(data.error || data)}`,
      };
    }

    return {
      success: true,
      platformPostId: data.data?.publish_id as string | undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[tiktok.publishVideo]', msg);
    return { success: false, error: msg };
  }
}
