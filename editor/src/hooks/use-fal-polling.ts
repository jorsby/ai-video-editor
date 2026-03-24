import { useEffect, useRef, useCallback } from 'react';

const POLL_INTERVAL_MS = 10_000; // 10 seconds

interface PollResult {
  success: boolean;
  has_processing: boolean;
  total_completed: number;
  total_still_running: number;
}

/**
 * Generic provider polling hook.
 *
 * Polls /api/workflow/poll-tasks when items are in a processing state.
 * It acts as a safety net when webhook callbacks are delayed/missed
 * (especially in local/tunnel environments).
 */
export function useProviderPolling(
  isProcessing: boolean,
  storyboardId?: string | null,
  onCompleted?: () => void
) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingRef = useRef(false);

  const poll = useCallback(async () => {
    // Prevent overlapping polls.
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      const res = await fetch('/api/workflow/poll-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard_id: storyboardId || undefined }),
      });

      if (!res.ok) return;

      const data: PollResult = await res.json();

      if (data.total_completed > 0 && onCompleted) {
        onCompleted();
      }
    } catch {
      // Best-effort safety net — ignore polling errors.
    } finally {
      isPollingRef.current = false;
    }
  }, [storyboardId, onCompleted]);

  useEffect(() => {
    if (!isProcessing) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isProcessing, poll]);
}

/**
 * @deprecated Use useProviderPolling instead.
 */
export const useFalPolling = useProviderPolling;
