'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { FileVideo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AccountPostCard } from './account-post-card';
import { AccountPostsList } from './account-posts-list';
import type { MixpostAccount } from '@/types/mixpost';
import type { MixpostPost, MixpostPaginationMeta } from '@/types/calendar';

interface PostsTabProps {
  accounts: MixpostAccount[];
  accountsLoading: boolean;
}

function isPublished(status: string): boolean {
  return status === 'published' || status === '3';
}

export function PostsTab({ accounts, accountsLoading }: PostsTabProps) {
  const [posts, setPosts] = useState<MixpostPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(
    null
  );

  const fetchAllPosts = useCallback(async () => {
    setPostsLoading(true);
    setPostsError(null);
    try {
      const firstRes = await fetch('/api/mixpost/posts/list?page=1');
      if (!firstRes.ok) {
        const err = await firstRes.json();
        throw new Error(err.error || 'Failed to fetch posts');
      }

      const firstData: { posts: MixpostPost[]; meta: MixpostPaginationMeta } =
        await firstRes.json();
      let allPosts: MixpostPost[] = [...firstData.posts];

      // Fetch remaining pages in parallel
      if (firstData.meta.last_page > 1) {
        const pagePromises = [];
        for (let p = 2; p <= firstData.meta.last_page; p++) {
          pagePromises.push(
            fetch(`/api/mixpost/posts/list?page=${p}`).then((r) => r.json())
          );
        }
        const results = await Promise.all(pagePromises);
        for (const result of results) {
          if (result.posts) {
            allPosts = [...allPosts, ...result.posts];
          }
        }
      }

      // Keep only non-trashed published posts
      setPosts(allPosts.filter((p) => !p.trashed && isPublished(p.status)));
    } catch (err) {
      setPostsError(
        err instanceof Error ? err.message : 'Failed to fetch posts'
      );
    } finally {
      setPostsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllPosts();
  }, [fetchAllPosts]);

  // Group posts by account ID
  const postsByAccount = useMemo(() => {
    const map = new Map<number, MixpostPost[]>();
    for (const post of posts) {
      for (const account of post.accounts) {
        const existing = map.get(account.id) || [];
        existing.push(post);
        map.set(account.id, existing);
      }
    }
    return map;
  }, [posts]);

  const isLoading = accountsLoading || postsLoading;

  // Loading state
  if (isLoading) {
    return (
      <div className="w-full max-w-3xl mx-auto">
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[72px] bg-muted/50 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (postsError) {
    return (
      <div className="space-y-2 py-12 text-center">
        <p className="text-sm text-destructive">{postsError}</p>
        <Button variant="outline" size="sm" onClick={fetchAllPosts}>
          Retry
        </Button>
      </div>
    );
  }

  // Drilldown into a specific account
  if (selectedAccountId !== null) {
    const account = accounts.find((a) => a.id === selectedAccountId);
    if (!account) {
      setSelectedAccountId(null);
      return null;
    }
    const accountPosts = postsByAccount.get(selectedAccountId) || [];
    return (
      <AccountPostsList
        account={account}
        posts={accountPosts}
        onBack={() => setSelectedAccountId(null)}
      />
    );
  }

  // No accounts
  if (accounts.length === 0) {
    return (
      <div className="text-center space-y-4 py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted">
          <FileVideo className="w-8 h-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">
            No connected accounts
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Connect your social accounts to see published posts here.
          </p>
        </div>
      </div>
    );
  }

  // No published posts at all
  if (posts.length === 0) {
    return (
      <div className="text-center space-y-4 py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted">
          <FileVideo className="w-8 h-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">
            No published posts yet
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Posts published through your connected accounts will appear here.
          </p>
        </div>
      </div>
    );
  }

  // Account cards grid
  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <h2 className="text-lg font-semibold text-foreground">
        Published Posts
      </h2>
      <div className="grid gap-2">
        {accounts.map((account) => {
          const count = postsByAccount.get(account.id)?.length || 0;
          return (
            <AccountPostCard
              key={account.id}
              account={account}
              postCount={count}
              onClick={() => setSelectedAccountId(account.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
