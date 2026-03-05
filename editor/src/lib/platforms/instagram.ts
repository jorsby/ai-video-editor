import type { PublishResult } from './types';

const GRAPH_API = 'https://graph.facebook.com/v24.0';
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_MS = 5 * 60 * 1_000; // 5 minutes for video
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

async function waitForMediaReady(
  containerId: string,
  token: string,
  maxWaitMs = POLL_MAX_MS
): Promise<void> {
  const start = Date.now();
  let delay = POLL_INTERVAL_MS;

  while (Date.now() - start < maxWaitMs) {
    const res = await graphFetch(
      `${GRAPH_API}/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`
    );
    const data = await res.json();
    const status = data.status_code as string;

    if (status === 'FINISHED') return;
    if (status === 'ERROR') {
      throw new Error(
        `Media container ${containerId} failed: ${JSON.stringify(data)}`
      );
    }

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 15_000); // exponential backoff, cap 15s
  }

  throw new Error(
    `Media container ${containerId} not ready after ${maxWaitMs / 1000}s`
  );
}

export async function publishPhoto(
  accountId: string,
  token: string,
  imageUrl: string,
  caption: string
): Promise<PublishResult> {
  try {
    // 1. Create container
    const createRes = await graphFetch(`${GRAPH_API}/${accountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
        access_token: token,
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      return { success: false, error: `Create container failed: ${JSON.stringify(createData.error || createData)}` };
    }
    const containerId = createData.id as string;

    // 2. Poll until ready
    await waitForMediaReady(containerId, token);

    // 3. Publish
    const publishRes = await graphFetch(
      `${GRAPH_API}/${accountId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: token,
        }),
      }
    );
    const publishData = await publishRes.json();
    if (!publishRes.ok) {
      return { success: false, error: `Publish failed: ${JSON.stringify(publishData.error || publishData)}` };
    }

    return { success: true, platformPostId: publishData.id as string };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[instagram.publishPhoto]', msg);
    return { success: false, error: msg };
  }
}

export async function publishCarousel(
  accountId: string,
  token: string,
  imageUrls: string[],
  caption: string
): Promise<PublishResult> {
  try {
    // 1. Create child containers
    const childIds: string[] = [];
    for (const url of imageUrls.slice(0, 20)) {
      const res = await graphFetch(`${GRAPH_API}/${accountId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: url,
          is_carousel_item: true,
          access_token: token,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: `Child container failed: ${JSON.stringify(data.error || data)}` };
      }
      childIds.push(data.id as string);
    }

    // 2. Poll all children
    await Promise.all(childIds.map((id) => waitForMediaReady(id, token)));

    // 3. Create carousel container
    const carouselRes = await graphFetch(`${GRAPH_API}/${accountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'CAROUSEL',
        children: childIds,
        caption,
        access_token: token,
      }),
    });
    const carouselData = await carouselRes.json();
    if (!carouselRes.ok) {
      return { success: false, error: `Carousel container failed: ${JSON.stringify(carouselData.error || carouselData)}` };
    }
    const carouselId = carouselData.id as string;

    // 4. Poll carousel
    await waitForMediaReady(carouselId, token);

    // 5. Publish
    const publishRes = await graphFetch(
      `${GRAPH_API}/${accountId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: carouselId,
          access_token: token,
        }),
      }
    );
    const publishData = await publishRes.json();
    if (!publishRes.ok) {
      return { success: false, error: `Publish failed: ${JSON.stringify(publishData.error || publishData)}` };
    }

    return { success: true, platformPostId: publishData.id as string };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[instagram.publishCarousel]', msg);
    return { success: false, error: msg };
  }
}

export async function publishReel(
  accountId: string,
  token: string,
  videoUrl: string,
  caption: string
): Promise<PublishResult> {
  try {
    // 1. Create reel container
    const createRes = await graphFetch(`${GRAPH_API}/${accountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_url: videoUrl,
        caption,
        media_type: 'REELS',
        access_token: token,
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      return { success: false, error: `Create reel container failed: ${JSON.stringify(createData.error || createData)}` };
    }
    const containerId = createData.id as string;

    // 2. Poll — videos can take up to 5 min
    await waitForMediaReady(containerId, token, POLL_MAX_MS);

    // 3. Publish
    const publishRes = await graphFetch(
      `${GRAPH_API}/${accountId}/media_publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: token,
        }),
      }
    );
    const publishData = await publishRes.json();
    if (!publishRes.ok) {
      return { success: false, error: `Publish reel failed: ${JSON.stringify(publishData.error || publishData)}` };
    }

    return { success: true, platformPostId: publishData.id as string };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[instagram.publishReel]', msg);
    return { success: false, error: msg };
  }
}
