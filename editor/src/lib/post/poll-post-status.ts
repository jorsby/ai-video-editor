import type {
  MixpostPostStatus,
  PostAccountResult,
  PostVerificationResult,
} from '@/types/post';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 90_000;

const TERMINAL_STATUSES: MixpostPostStatus[] = ['published', 'failed'];

const MAX_CONSECUTIVE_ERRORS = 5;

interface PollOptions {
  postUuid: string;
  signal?: AbortSignal;
  onStatusChange?: (status: MixpostPostStatus) => void;
}

export class PollAuthError extends Error {
  constructor() {
    super('Authentication expired while verifying post status. Please re-publish.');
    this.name = 'PollAuthError';
  }
}

/**
 * Polls GET /api/mixpost/posts/{uuid} until the post reaches a terminal status
 * or the timeout expires. Returns a PostVerificationResult.
 * Throws PollAuthError if authentication fails during polling.
 */
export async function pollPostStatus({
  postUuid,
  signal,
  onStatusChange,
}: PollOptions): Promise<PostVerificationResult> {
  const startTime = Date.now();
  let consecutiveErrors = 0;

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    if (signal?.aborted) {
      return { status: 'scheduled', accounts: [] };
    }

    const res = await fetch(`/api/mixpost/posts/${postUuid}`, { signal });

    if (res.status === 401) {
      throw new PollAuthError();
    }

    if (!res.ok) {
      let lastErrorDetail = `HTTP ${res.status}`;
      try {
        const errBody = await res.text();
        const parsed = JSON.parse(errBody);
        lastErrorDetail = parsed.message ?? parsed.error ?? (errBody || lastErrorDetail);
      } catch { /* keep HTTP status as fallback */ }

      // 4xx = permanent client/auth error, don't retry
      if (res.status >= 400 && res.status < 500) {
        return {
          status: 'failed',
          accounts: [{
            accountId: 0,
            accountName: 'System',
            provider: 'unknown',
            status: 'failed',
            errors: [`Post status check failed: ${lastErrorDetail}`],
            external_url: null,
          }],
        };
      }

      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return {
          status: 'failed',
          accounts: [{
            accountId: 0,
            accountName: 'System',
            provider: 'unknown',
            status: 'failed',
            errors: [`Unable to verify post status after ${MAX_CONSECUTIVE_ERRORS} attempts: ${lastErrorDetail}`],
            external_url: null,
          }],
        };
      }
      await sleep(POLL_INTERVAL_MS, signal);
      continue;
    }

    consecutiveErrors = 0;
    const { post } = await res.json();
    const status = mapMixpostStatus(post.status);

    onStatusChange?.(status);

    if (TERMINAL_STATUSES.includes(status)) {
      return {
        status,
        accounts: extractAccountResults(post, status),
      };
    }

    await sleep(POLL_INTERVAL_MS, signal);
  }

  // Timeout — post is queued but we couldn't confirm the outcome
  return { status: 'unconfirmed', accounts: [] };
}

function mapMixpostStatus(rawStatus: number | string): MixpostPostStatus {
  // Mixpost uses numeric statuses: 0=draft, 1=scheduled, 2=publishing, 3=published, 4=failed
  const statusMap: Record<number, MixpostPostStatus> = {
    0: 'draft',
    1: 'scheduled',
    2: 'publishing',
    3: 'published',
    4: 'failed',
  };

  if (typeof rawStatus === 'number') {
    return statusMap[rawStatus] ?? 'scheduled';
  }

  // If it's already a string status
  const validStatuses: MixpostPostStatus[] = [
    'draft',
    'scheduled',
    'publishing',
    'published',
    'failed',
  ];
  if (validStatuses.includes(rawStatus as MixpostPostStatus)) {
    return rawStatus as MixpostPostStatus;
  }

  return 'scheduled';
}

function parseErrors(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' && raw.length > 0) {
    // Handle JSON-encoded error arrays (e.g. '["service_disabled"]')
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Not JSON — treat the string itself as the error
    }
    return [raw];
  }
  return [];
}

function extractAccountResults(
  post: Record<string, unknown>,
  postStatus: MixpostPostStatus
): PostAccountResult[] {
  const accounts = post.accounts as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(accounts)) return [];

  return accounts.map((account) => {
    // Mixpost API returns errors and external_url directly on the account object.
    // Also check account.pivot as a fallback for different Mixpost versions.
    const pivot = account.pivot as Record<string, unknown> | undefined;

    const accountErrors = parseErrors(account.errors);
    const errorList = accountErrors.length > 0
      ? accountErrors
      : parseErrors(pivot?.errors);

    const externalUrl =
      (account.external_url as string) ??
      (pivot?.external_url as string) ??
      ((pivot?.provider_post_data as Record<string, unknown> | undefined)?.url as string) ??
      null;

    const hasErrors = errorList.length > 0;

    return {
      accountId: Number(account.id),
      accountName: (account.name as string) || 'Unknown',
      provider: (account.provider as string) || 'unknown',
      status: hasErrors ? 'failed' : postStatus === 'published' ? 'published' : 'pending',
      errors: errorList,
      external_url: externalUrl,
    } satisfies PostAccountResult;
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
