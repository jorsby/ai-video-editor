import type {
  MixpostPostStatus,
  PostAccountResult,
  PostVerificationResult,
} from '@/types/post';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 90_000;

const TERMINAL_STATUSES: MixpostPostStatus[] = ['published', 'failed'];

interface PollOptions {
  postUuid: string;
  signal?: AbortSignal;
  onStatusChange?: (status: MixpostPostStatus) => void;
}

/**
 * Polls GET /api/mixpost/posts/{uuid} until the post reaches a terminal status
 * or the timeout expires. Returns a PostVerificationResult.
 */
export async function pollPostStatus({
  postUuid,
  signal,
  onStatusChange,
}: PollOptions): Promise<PostVerificationResult> {
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    if (signal?.aborted) {
      return { status: 'scheduled', accounts: [] };
    }

    const res = await fetch(`/api/mixpost/posts/${postUuid}`, { signal });

    if (!res.ok) {
      // If the API call itself fails, wait and retry
      await sleep(POLL_INTERVAL_MS, signal);
      continue;
    }

    const { post } = await res.json();
    const status = mapMixpostStatus(post.status);

    onStatusChange?.(status);

    if (TERMINAL_STATUSES.includes(status)) {
      return {
        status,
        accounts: extractAccountResults(post),
      };
    }

    await sleep(POLL_INTERVAL_MS, signal);
  }

  // Timeout — return as-is with a 'scheduled' fallback (queued but unconfirmed)
  return { status: 'scheduled', accounts: [] };
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

function extractAccountResults(post: Record<string, unknown>): PostAccountResult[] {
  const accounts = post.accounts as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(accounts)) return [];

  return accounts.map((account) => {
    const pivot = account.pivot as Record<string, unknown> | undefined;
    const errors = pivot?.errors;
    const errorList: string[] = Array.isArray(errors)
      ? errors.map(String)
      : typeof errors === 'string' && errors.length > 0
        ? [errors]
        : [];

    const providerData = pivot?.provider_post_data as Record<string, unknown> | undefined;
    const externalUrl =
      (providerData?.url as string) ??
      (providerData?.external_url as string) ??
      null;

    const hasErrors = errorList.length > 0;

    return {
      accountId: Number(account.id),
      accountName: (account.name as string) || 'Unknown',
      provider: (account.provider as string) || 'unknown',
      status: hasErrors ? 'failed' : 'pending',
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
