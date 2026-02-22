/**
 * Shared publish utilities used by both the single-post flow (post-page.tsx)
 * and the batch workflow (workflow-page.tsx).
 */

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 2
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      // Don't retry on client errors (4xx) — only on server/network errors
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        return res;
      }
      lastError = new Error(`Server error: ${res.status}`);
    } catch (err) {
      lastError = err as Error;
    }
    if (attempt < maxRetries) {
      // Exponential backoff: 1s, 2s
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error('Request failed after retries');
}

// Polls the media status endpoint until the download completes or fails.
// Called client-side when the server returns 202 for large file uploads.
export async function pollMediaDownload(downloadId: string): Promise<{ id: number }> {
  const POLL_INTERVAL_MS = 3_000;
  const MAX_ATTEMPTS = 60; // 3 minutes client-side tolerance

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`/api/mixpost/media?download_id=${encodeURIComponent(downloadId)}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Media status check failed (${res.status})`);
    }

    if (data.media) {
      return data.media as { id: number };
    }

    if (!data.pending) {
      throw new Error(data.error || 'Media upload failed');
    }
  }

  throw new Error('Media upload timed out. Please try again.');
}
