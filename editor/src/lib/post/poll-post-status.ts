import type {
  Platform,
  PostStatus,
  PostAccountResult,
  PostVerificationResult,
} from '@/types/social';

const POLL_TIMEOUT_MS = 600_000; // 10 minutes — video processing can take several minutes

const TERMINAL_STATUSES: PostStatus[] = ['published', 'partial', 'failed'];

const MAX_CONSECUTIVE_ERRORS = 5;

/**
 * Returns the next poll interval based on how long we've been waiting.
 *
 * - 0–30s  → 3s  (fast resolution for text/image posts)
 * - 30–120s → 10s (video processing phase)
 * - 120s+  → 30s (slow platforms / long queues)
 */
function getNextInterval(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 3_000;
  if (elapsedMs < 120_000) return 10_000;
  return 30_000;
}

interface PollOptions {
  postId: string;
  signal?: AbortSignal;
  onStatusChange?: (status: PostStatus) => void;
}

export class PollAuthError extends Error {
  constructor() {
    super(
      'Authentication expired while verifying post status. Please re-publish.'
    );
    this.name = 'PollAuthError';
  }
}

/**
 * Polls GET /api/v2/posts/{id} until the post reaches a terminal status
 * or the timeout expires. Returns a PostVerificationResult.
 * Throws PollAuthError if authentication fails during polling.
 */
export async function pollPostStatus({
  postId,
  signal,
  onStatusChange,
}: PollOptions): Promise<PostVerificationResult> {
  const startTime = Date.now();
  let consecutiveErrors = 0;

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    if (signal?.aborted) {
      return { status: 'scheduled', accounts: [] };
    }

    const res = await fetch(`/api/v2/posts/${postId}`, { signal });

    if (res.status === 401) {
      throw new PollAuthError();
    }

    if (!res.ok) {
      let lastErrorDetail = `HTTP ${res.status}`;
      try {
        const errBody = await res.text();
        const parsed = JSON.parse(errBody);
        lastErrorDetail =
          parsed.message ?? parsed.error ?? (errBody || lastErrorDetail);
      } catch {
        /* keep HTTP status as fallback */
      }

      // 4xx = permanent client/auth error, don't retry
      if (res.status >= 400 && res.status < 500) {
        return {
          status: 'failed',
          accounts: [
            {
              accountId: '0',
              accountName: 'System',
              platform: 'unknown' as PostAccountResult['platform'],
              status: 'failed',
              errorMessage: `Post status check failed: ${lastErrorDetail}`,
              platformPostId: null,
            },
          ],
        };
      }

      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return {
          status: 'failed',
          accounts: [
            {
              accountId: '0',
              accountName: 'System',
              platform: 'unknown' as PostAccountResult['platform'],
              status: 'failed',
              errorMessage: `Unable to verify post status after ${MAX_CONSECUTIVE_ERRORS} attempts: ${lastErrorDetail}`,
              platformPostId: null,
            },
          ],
        };
      }
      await sleep(getNextInterval(Date.now() - startTime), signal);
      continue;
    }

    consecutiveErrors = 0;
    const { post } = await res.json();
    const status = post.status as PostStatus;

    onStatusChange?.(status);

    if (TERMINAL_STATUSES.includes(status)) {
      const accounts = extractAccountResults(post);
      return { status, accounts };
    }

    await sleep(getNextInterval(Date.now() - startTime), signal);
  }

  // Timeout — return unconfirmed
  return {
    status: 'publishing' as PostVerificationResult['status'],
    accounts: [],
  };
}

function extractAccountResults(
  post: Record<string, unknown>
): PostAccountResult[] {
  const postAccounts = post.post_accounts as
    | Array<Record<string, unknown>>
    | undefined;
  if (!Array.isArray(postAccounts)) return [];

  return postAccounts.map((pa) => ({
    accountId: (pa.octupost_account_id as string) || '',
    accountName:
      (pa.account_name as string) || (pa.platform as string) || 'Unknown',
    platform: ((pa.platform as string) || 'unknown') as Platform,
    status:
      (pa.status as string) === 'published'
        ? ('published' as const)
        : ('failed' as const),
    errorMessage: (pa.error_message as string) || null,
    platformPostId: (pa.platform_post_id as string) || null,
  }));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}
