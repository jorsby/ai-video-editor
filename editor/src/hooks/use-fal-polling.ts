import { useEffect, useRef, useCallback } from 'react';

const POLL_INTERVAL_MS = 10_000; // 10 seconds

interface PollResult {
  success: boolean;
  has_processing: boolean;
  total_completed: number;
  total_still_running: number;
}

/**
 * Hook that polls /api/workflow/poll-fal when items are in 'processing' state.
 * Acts as a safety net for when webhooks don't reach the server (e.g. local dev).
 *
 * @param isProcessing - Whether any workflow items are currently processing
 * @param storyboardId - Optional storyboard ID to scope polling
 * @param onCompleted - Callback fired when polling detects newly completed items (trigger refresh)
 */
export function useFalPolling(
  isProcessing: boolean,
  storyboardId?: string | null,
  onCompleted?: () => void
) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingRef = useRef(false);

  const poll = useCallback(async () => {
    // Prevent overlapping polls
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      const res = await fetch('/api/workflow/poll-fal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard_id: storyboardId || undefined }),
      });

      if (!res.ok) return;

      const data: PollResult = await res.json();

      // If any items completed, trigger a data refresh
      if (data.total_completed > 0 && onCompleted) {
        onCompleted();
      }
    } catch {
      // Silently ignore — polling is best-effort
    } finally {
      isPollingRef.current = false;
    }
  }, [storyboardId, onCompleted]);

  useEffect(() => {
    if (!isProcessing) {
      // Nothing processing — stop polling
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Start polling
    // Do an immediate first poll, then every POLL_INTERVAL_MS
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
