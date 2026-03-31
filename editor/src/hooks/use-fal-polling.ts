import { useEffect } from 'react';

/**
 * Webhook-only mode.
 *
 * Polling is intentionally disabled.
 * UI state should be updated only via webhook → DB updates + realtime subscriptions.
 */
export function useProviderPolling(
  _isProcessing: boolean,
  _storyboardId?: string | null,
  _onCompleted?: () => void
) {
  useEffect(() => {
    // no-op (polling disabled by product decision)
  }, []);
}

/**
 * @deprecated Use useProviderPolling instead.
 */
export const useFalPolling = useProviderPolling;
