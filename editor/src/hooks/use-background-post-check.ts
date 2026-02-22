'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import {
  getPendingPosts,
  removePendingPost,
} from '@/lib/post/pending-posts-store';

const MIN_AGE_BEFORE_CHECK_MS = 2 * 60 * 1000; // wait 2 min before first background check

/**
 * On mount, checks any posts that timed out during verification and are still
 * in the pending-posts localStorage store. Fires a success toast if any have
 * since been confirmed published by Mixpost.
 *
 * Wire this into the root layout so it runs on every page load.
 */
export function useBackgroundPostCheck() {
  useEffect(() => {
    const pending = getPendingPosts();
    if (pending.length === 0) return;

    const now = Date.now();

    pending.forEach(async ({ postUuid, accountNames, savedAt }) => {
      // Skip posts that were just saved — give Mixpost time to finish
      if (now - savedAt < MIN_AGE_BEFORE_CHECK_MS) return;

      try {
        const res = await fetch(`/api/mixpost/posts/${postUuid}`);
        if (!res.ok) return;

        const { post } = await res.json();

        // Mixpost status 2 = published (numeric) or 'published' (string)
        const isPublished =
          post.status === 2 ||
          post.status === 'published';

        if (isPublished) {
          removePendingPost(postUuid);
          const names = accountNames.join(', ');
          toast.success(
            accountNames.length === 1
              ? `Your post to ${names} is now live!`
              : `Your post to ${names} is now live!`,
            { duration: 8000 }
          );
        }
      } catch {
        // Network error — will retry on next page load
      }
    });
  }, []); // run once on mount
}
