'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ProjectList } from './project-list';
import { SocialAccountsList } from './social-accounts-list';
import { CreateProjectModal } from './create-project-modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { DBProject } from '@/types/project';
import type { MixpostAccount, AccountGroupWithMembers, AccountTagMap } from '@/types/mixpost';
import type { MixpostPost, MixpostPaginationMeta } from '@/types/calendar';

export function DashboardContent() {
  const [projects, setProjects] = useState<DBProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [accounts, setAccounts] = useState<MixpostAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [groups, setGroups] = useState<AccountGroupWithMembers[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);

  const [tags, setTags] = useState<AccountTagMap>({});

  const [posts, setPosts] = useState<MixpostPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  const [platformPostsByAccount, setPlatformPostsByAccount] = useState<Map<number, MixpostPost[]>>(new Map());
  const [platformMediaLoading, setPlatformMediaLoading] = useState<Set<number>>(new Set());
  const [platformMediaErrors, setPlatformMediaErrors] = useState<Map<number, string>>(new Map());
  const [platformMediaSyncedAt, setPlatformMediaSyncedAt] = useState<Map<number, Date>>(new Map());

  const fetchAllPosts = useCallback(async () => {
    setPostsLoading(true);
    try {
      const firstRes = await fetch('/api/mixpost/posts/list?page=1');
      if (!firstRes.ok) return;

      const firstData: { posts: MixpostPost[]; meta: MixpostPaginationMeta } =
        await firstRes.json();
      let allPosts: MixpostPost[] = [...firstData.posts];

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

      setPosts(
        allPosts.filter(
          (p) => !p.trashed && (p.scheduled_at || p.published_at)
        )
      );
    } catch (error) {
      console.error('Failed to fetch posts:', error);
    } finally {
      setPostsLoading(false);
    }
  }, []);

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

  const mergedPostsByAccount = useMemo(() => {
    const merged = new Map<number, MixpostPost[]>(postsByAccount);
    for (const [accountId, platformPosts] of platformPostsByAccount) {
      merged.set(accountId, platformPosts);
    }
    return merged;
  }, [postsByAccount, platformPostsByAccount]);

  const fetchPlatformMedia = useCallback(async (accountId: number, force?: boolean) => {
    if (!force && platformPostsByAccount.has(accountId)) return;

    setPlatformMediaLoading((prev) => new Set(prev).add(accountId));
    setPlatformMediaErrors((prev) => {
      const next = new Map(prev);
      next.delete(accountId);
      return next;
    });

    try {
      const res = await fetch(`/api/social/media?accountId=${accountId}`);
      if (!res.ok) {
        const { error } = await res.json();
        setPlatformMediaErrors((prev) => new Map(prev).set(accountId, error || 'Failed to fetch platform media'));
        return;
      }
      const { posts: platformPosts } = await res.json();
      setPlatformPostsByAccount((prev) => new Map(prev).set(accountId, platformPosts));
      setPlatformMediaSyncedAt((prev) => new Map(prev).set(accountId, new Date()));
    } catch {
      setPlatformMediaErrors((prev) => new Map(prev).set(accountId, 'Failed to fetch platform media'));
    } finally {
      setPlatformMediaLoading((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  }, [platformPostsByAccount]);

  useEffect(() => {
    fetchAccounts();
    fetchGroups();
    fetchTags();
    fetchAllPosts();
  }, [fetchAllPosts]);

  useEffect(() => {
    fetchProjects(showArchived);
  }, [showArchived]);

  const fetchProjects = async (archived = false) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/projects?archived=${archived}`);
      if (response.ok) {
        const { projects } = await response.json();
        setProjects(projects);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAccounts = async () => {
    try {
      const response = await fetch('/api/mixpost/accounts');
      if (response.ok) {
        const { accounts } = await response.json();
        setAccounts(accounts);
      } else {
        const { error } = await response.json();
        setAccountsError(error || 'Failed to fetch accounts');
      }
    } catch (error) {
      setAccountsError('Failed to fetch accounts');
    } finally {
      setAccountsLoading(false);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await fetch('/api/account-groups');
      if (response.ok) {
        const { groups } = await response.json();
        setGroups(groups);
      }
    } catch (error) {
      console.error('Failed to fetch groups:', error);
    } finally {
      setGroupsLoading(false);
    }
  };

  const fetchTags = async () => {
    try {
      const response = await fetch('/api/account-tags');
      if (response.ok) {
        const { tags } = await response.json();
        setTags(tags);
      }
    } catch (error) {
      console.error('Failed to fetch tags:', error);
    }
  };

  const handleTagAdded = async (accountUuid: string, tag: string) => {
    setTags((prev) => ({
      ...prev,
      [accountUuid]: [...(prev[accountUuid] || []), tag],
    }));
    try {
      const response = await fetch('/api/account-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_uuid: accountUuid, tag }),
      });
      if (!response.ok) {
        setTags((prev) => ({
          ...prev,
          [accountUuid]: (prev[accountUuid] || []).filter((t) => t !== tag),
        }));
      }
    } catch {
      setTags((prev) => ({
        ...prev,
        [accountUuid]: (prev[accountUuid] || []).filter((t) => t !== tag),
      }));
    }
  };

  const handleTagRemoved = async (accountUuid: string, tag: string) => {
    setTags((prev) => ({
      ...prev,
      [accountUuid]: (prev[accountUuid] || []).filter((t) => t !== tag),
    }));
    try {
      const response = await fetch(
        `/api/account-tags?account_uuid=${encodeURIComponent(accountUuid)}&tag=${encodeURIComponent(tag)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        setTags((prev) => ({
          ...prev,
          [accountUuid]: [...(prev[accountUuid] || []), tag],
        }));
      }
    } catch {
      setTags((prev) => ({
        ...prev,
        [accountUuid]: [...(prev[accountUuid] || []), tag],
      }));
    }
  };

  const handleProjectCreated = (project: DBProject) => {
    setProjects((prev) => [project, ...prev]);
    // Open the new project in a new tab
    window.open(`/editor/${project.id}`, '_blank');
  };

  const handleDeleteProject = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  const handleArchiveProject = async (id: string) => {
    const previousProjects = projects;
    setProjects((prev) => prev.filter((p) => p.id !== id));

    try {
      const response = await fetch('/api/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, archive: !showArchived }),
      });

      if (!response.ok) {
        setProjects(previousProjects);
      }
    } catch {
      setProjects(previousProjects);
    }
  };

  const handleOpenProject = (id: string) => {
    window.open(`/editor/${id}`, '_blank');
  };

  const handleGroupCreated = (group: AccountGroupWithMembers) => {
    setGroups((prev) => [...prev, group]);
  };

  const handleGroupRenamed = (id: string, name: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, name } : g))
    );
  };

  const handleGroupDeleted = (id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
  };

  const handleMemberAdded = (groupId: string, accountUuid: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, account_uuids: [...g.account_uuids, accountUuid] }
          : g
      )
    );
  };

  const handleMemberRemoved = (groupId: string, accountUuid: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? {
              ...g,
              account_uuids: g.account_uuids.filter(
                (uuid) => uuid !== accountUuid
              ),
            }
          : g
      )
    );
  };

  const handlePostDeleted = (postUuid: string) => {
    setPosts((prev) => prev.filter((p) => p.uuid !== postUuid));
    setPlatformPostsByAccount((prev) => {
      const next = new Map(prev);
      for (const [accountId, posts] of next) {
        const filtered = posts.filter((p) => p.uuid !== postUuid);
        if (filtered.length !== posts.length) {
          next.set(accountId, filtered);
        }
      }
      return next;
    });
  };

  const handlePostUpdated = (postUuid: string, fields: Record<string, string>) => {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.uuid !== postUuid) return p;
        // Update the original version's content to reflect the edit
        const updatedVersions = p.versions.map((v) => {
          if (!v.is_original) return v;
          const newBody = fields.description || fields.message || v.content[0]?.body || '';
          return {
            ...v,
            content: v.content.map((c, i) =>
              i === 0 ? { ...c, body: newBody } : c
            ),
          };
        });
        return { ...p, versions: updatedVersions };
      })
    );
  };

  return (
    <>
      <Tabs defaultValue="projects" className="w-full max-w-3xl mx-auto">
        <TabsList>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="social">Social</TabsTrigger>
        </TabsList>

        <TabsContent value="projects">
          <ProjectList
            projects={projects}
            isLoading={isLoading}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((prev) => !prev)}
            onCreateProject={() => setShowCreateModal(true)}
            onDeleteProject={handleDeleteProject}
            onArchiveProject={handleArchiveProject}
            onOpenProject={handleOpenProject}
          />
        </TabsContent>

        <TabsContent value="social">
          <SocialAccountsList
            accounts={accounts}
            isLoading={accountsLoading}
            error={accountsError}
            groups={groups}
            groupsLoading={groupsLoading}
            onGroupCreated={handleGroupCreated}
            onGroupRenamed={handleGroupRenamed}
            onGroupDeleted={handleGroupDeleted}
            onMemberAdded={handleMemberAdded}
            onMemberRemoved={handleMemberRemoved}
            tags={tags}
            onTagAdded={handleTagAdded}
            onTagRemoved={handleTagRemoved}
            postsByAccount={mergedPostsByAccount}
            postsLoading={postsLoading}
            onPostDeleted={handlePostDeleted}
            onPostUpdated={handlePostUpdated}
            onFetchPlatformMedia={fetchPlatformMedia}
            platformMediaLoading={platformMediaLoading}
            platformMediaErrors={platformMediaErrors}
            platformMediaSyncedAt={platformMediaSyncedAt}
          />
        </TabsContent>

      </Tabs>

      <CreateProjectModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreated={handleProjectCreated}
      />
    </>
  );
}
