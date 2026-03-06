import type { OctupostAccount, OctupostToken } from './types';

const OCTUPOST_API_URL =
  process.env.OCTUPOST_API_URL || 'https://app.octupost.com/api';
const OCTUPOST_API_KEY =
  process.env.OCTUPOST_API_KEY || process.env.SOCIALPOST_API_KEY;

const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const tokenCache = new Map<
  string,
  { token: OctupostToken; cachedAt: number }
>();

class OctupostError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string
  ) {
    super(message);
    this.name = 'OctupostError';
  }
}

function getApiKey(): string {
  if (!OCTUPOST_API_KEY) {
    throw new Error(
      'Missing Octupost API key. Set OCTUPOST_API_KEY or SOCIALPOST_API_KEY.'
    );
  }
  return OCTUPOST_API_KEY;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${OCTUPOST_API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'x-api-key': getApiKey(),
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new OctupostError(
      `Octupost ${res.status}: ${body || res.statusText}`,
      res.status,
      path
    );
  }

  return res.json() as Promise<T>;
}

/**
 * Parse the access_token from the API response.
 * Some platforms (IG/FB) return a JSON-wrapped token like
 * {"access_token":"EAA...","token_type":"bearer"}, while others
 * (YouTube, Twitter, TikTok) return a plain string.
 */
function parseAccessToken(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      return parsed.access_token ?? trimmed;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export async function fetchAccounts(): Promise<OctupostAccount[]> {
  const data = await request<{ accounts: OctupostAccount[] }>('/accounts');
  return data.accounts;
}

export async function fetchToken(accountId: string): Promise<OctupostToken> {
  const now = Date.now();
  const cached = tokenCache.get(accountId);
  if (cached && now - cached.cachedAt < TOKEN_CACHE_TTL) {
    return cached.token;
  }

  const raw = await request<OctupostToken>(`/tokens/by-id/${accountId}`);
  const token: OctupostToken = {
    ...raw,
    access_token: parseAccessToken(raw.access_token),
  };

  tokenCache.set(accountId, { token, cachedAt: now });
  return token;
}

export async function refreshTokens(): Promise<void> {
  await request<void>('/refresh', { method: 'POST' });
  tokenCache.clear();
}

export function clearTokenCache(): void {
  tokenCache.clear();
}
