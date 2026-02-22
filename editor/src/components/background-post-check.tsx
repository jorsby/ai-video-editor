'use client';

import { useBackgroundPostCheck } from '@/hooks/use-background-post-check';

/**
 * Invisible client component that runs the background post-confirmation check.
 * Renders nothing — included in the root layout so it runs on every page load.
 */
export function BackgroundPostCheck() {
  useBackgroundPostCheck();
  return null;
}
