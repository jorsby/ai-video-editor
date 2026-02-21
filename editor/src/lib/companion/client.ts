const COMPANION_URL = 'http://127.0.0.1:12345';

export async function pingCompanion(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${COMPANION_URL}/ping`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

export async function openAccountInBrowser(
  platform: string,
  accountUuid: string,
  url?: string
): Promise<{ ok: boolean; notRunning?: boolean; error?: string }> {
  try {
    const res = await fetch(`${COMPANION_URL}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, accountUuid, url }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error || 'Failed to open browser' };
    return { ok: true };
  } catch {
    return { ok: false, notRunning: true };
  }
}
