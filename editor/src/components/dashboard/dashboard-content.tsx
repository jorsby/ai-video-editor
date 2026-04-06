'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ProjectList } from './project-list';
import { SocialAccountsList } from './social-accounts-list';
import { CreateProjectModal } from './create-project-modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { DBProject, ProjectTagMap } from '@/types/project';
import type { OctupostAccount } from '@/lib/octupost/types';
import type {
  SocialPost,
  AccountGroupWithMembers,
  AccountTagMap,
} from '@/types/social';
import { toast } from 'sonner';

export function DashboardContent() {
  const [projects, setProjects] = useState<DBProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [projectTags, setProjectTags] = useState<ProjectTagMap>({});
  const [selectedProjectTags, setSelectedProjectTags] = useState<
    Map<string, 'include' | 'exclude'>
  >(new Map());

  const [accounts, setAccounts] = useState<OctupostAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [groups, setGroups] = useState<AccountGroupWithMembers[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);

  const [tags, setTags] = useState<AccountTagMap>({});

  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  const [platformPostsByAccount, setPlatformPostsByAccount] = useState<
    Map<string, SocialPost[]>
  >(new Map());
  const [platformMediaLoading, setPlatformMediaLoading] = useState<Set<string>>(
    new Set()
  );
  const [platformMediaErrors, setPlatformMediaErrors] = useState<
    Map<string, string>
  >(new Map());
  const [platformMediaSyncedAt, setPlatformMediaSyncedAt] = useState<
    Map<string, Date>
  >(new Map());
  const [tokenInvalidAccountIds, setTokenInvalidAccountIds] = useState<
    Set<string>
  >(new Set());

  const fetchAllPosts = useCallback(async () => {
    setPostsLoading(true);
    try {
      const PAGE_SIZE = 100;
      const firstRes = await fetch(
        `/api/v2/posts/list?limit=${PAGE_SIZE}&offset=0`
      );
      if (!firstRes.ok) return;

      const firstData: { posts: SocialPost[]; total: number } =
        await firstRes.json();
      let allPosts: SocialPost[] = [...firstData.posts];

      if (firstData.total > PAGE_SIZE) {
        const remaining = firstData.total - PAGE_SIZE;
        const pages = Math.ceil(remaining / PAGE_SIZE);
        const pagePromises = [];
        for (let p = 1; p <= pages; p++) {
          pagePromises.push(
            fetch(
              `/api/v2/posts/list?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}`
            ).then((r) => r.json())
          );
        }
        const results = await Promise.all(pagePromises);
        for (const result of results) {
          if (result.posts) {
            allPosts = [...allPosts, ...result.posts];
          }
        }
      }

      setPosts(allPosts);
    } catch (error) {
      console.error('Failed to fetch posts:', error);
    } finally {
      setPostsLoading(false);
    }
  }, []);

  const postsByAccount = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    for (const post of posts) {
      for (const account of post.accounts || []) {
        const existing = map.get(account.octupost_account_id) || [];
        existing.push(post);
        map.set(account.octupost_account_id, existing);
      }
    }
    return map;
  }, [posts]);

  const mergedPostsByAccount = useMemo(() => {
    const merged = new Map<string, SocialPost[]>();
    // Start with DB posts
    for (const [accountId, dbPosts] of postsByAccount) {
      merged.set(accountId, [...dbPosts]);
    }
    // Overlay platform posts
    for (const [accountId, platformPosts] of platformPostsByAccount) {
      const existing = merged.get(accountId) || [];
      const existingIds = new Set(existing.map((p) => p.id));
      const newPosts = platformPosts.filter((p) => !existingIds.has(p.id));
      merged.set(accountId, [...existing, ...newPosts]);
    }
    return merged;
  }, [postsByAccount, platformPostsByAccount]);

  const filteredProjects = useMemo(() => {
    if (selectedProjectTags.size === 0) return projects;
    const includeTags: string[] = [];
    const excludeTags: string[] = [];
    for (const [tag, mode] of selectedProjectTags) {
      if (mode === 'include') includeTags.push(tag);
      else excludeTags.push(tag);
    }
    return projects.filter((p) => {
      const pTags = projectTags[p.id] ?? [];
      if (
        includeTags.length > 0 &&
        !includeTags.every((t) => pTags.includes(t))
      )
        return false;
      if (excludeTags.length > 0 && excludeTags.some((t) => pTags.includes(t)))
        return false;
      return true;
    });
  }, [projects, projectTags, selectedProjectTags]);

  const fetchPlatformMedia = useCallback(
    async (accountId: string, force?: boolean) => {
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
          const body = await res.json();
          if (body.tokenExpired) {
            setTokenInvalidAccountIds((prev) => new Set(prev).add(accountId));
          }
          setPlatformMediaErrors((prev) =>
            new Map(prev).set(
              accountId,
              body.error || 'Failed to fetch platform media'
            )
          );
          return;
        }
        const { posts: platformPosts } = await res.json();
        setPlatformPostsByAccount((prev) =>
          new Map(prev).set(accountId, platformPosts)
        );
        setPlatformMediaSyncedAt((prev) =>
          new Map(prev).set(accountId, new Date())
        );
      } catch {
        setPlatformMediaErrors((prev) =>
          new Map(prev).set(accountId, 'Failed to fetch platform media')
        );
      } finally {
        setPlatformMediaLoading((prev) => {
          const next = new Set(prev);
          next.delete(accountId);
          return next;
        });
      }
    },
    [platformPostsByAccount]
  );

  useEffect(() => {
    fetchAccounts();
    fetchGroups();
    fetchTags();
    fetchProjectTags();
    fetchAllPosts();
  }, [fetchAllPosts]);

  const fetchProjects = useCallback(async (archived = false) => {
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
  }, []);

  useEffect(() => {
    fetchProjects(showArchived);
  }, [showArchived, fetchProjects]);

  const fetchAccounts = async () => {
    try {
      const response = await fetch('/api/v2/accounts');
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

  const fetchProjectTags = async () => {
    try {
      const response = await fetch('/api/project-tags');
      if (response.ok) {
        const { tags } = await response.json();
        setProjectTags(tags);
      }
    } catch (error) {
      console.error('Failed to fetch project tags:', error);
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

  const handleProjectTagAdded = async (projectId: string, tag: string) => {
    setProjectTags((prev) => ({
      ...prev,
      [projectId]: [...(prev[projectId] || []), tag],
    }));
    try {
      const response = await fetch('/api/project-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, tag }),
      });
      if (!response.ok) {
        setProjectTags((prev) => ({
          ...prev,
          [projectId]: (prev[projectId] || []).filter((t) => t !== tag),
        }));
        toast.error('Failed to add tag');
      }
    } catch {
      setProjectTags((prev) => ({
        ...prev,
        [projectId]: (prev[projectId] || []).filter((t) => t !== tag),
      }));
      toast.error('Failed to add tag');
    }
  };

  const handleProjectTagRemoved = async (projectId: string, tag: string) => {
    setProjectTags((prev) => ({
      ...prev,
      [projectId]: (prev[projectId] || []).filter((t) => t !== tag),
    }));
    try {
      const response = await fetch(
        `/api/project-tags?project_id=${encodeURIComponent(projectId)}&tag=${encodeURIComponent(tag)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        setProjectTags((prev) => ({
          ...prev,
          [projectId]: [...(prev[projectId] || []), tag],
        }));
        toast.error('Failed to remove tag');
      }
    } catch {
      setProjectTags((prev) => ({
        ...prev,
        [projectId]: [...(prev[projectId] || []), tag],
      }));
      toast.error('Failed to remove tag');
    }
  };

  const handleProjectCreated = (project: DBProject) => {
    setProjects((prev) => [project, ...prev]);
    // Open canonical project/video flow in a new tab
    window.open(`/editor/${project.id}`, '_blank');
  };

  const handleDeleteProject = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setProjectTags((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
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

  const handlePostDeleted = (postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    setPlatformPostsByAccount((prev) => {
      const next = new Map(prev);
      for (const [accountId, posts] of next) {
        const filtered = posts.filter((p) => p.id !== postId);
        if (filtered.length !== posts.length) {
          next.set(accountId, filtered);
        }
      }
      return next;
    });
  };

  const handlePostUpdated = (
    postId: string,
    fields: Record<string, string>
  ) => {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== postId) return p;
        return {
          ...p,
          caption: fields.description || fields.message || p.caption,
        };
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
            projects={filteredProjects}
            isLoading={isLoading}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((prev) => !prev)}
            onCreateProject={() => setShowCreateModal(true)}
            onDeleteProject={handleDeleteProject}
            onArchiveProject={handleArchiveProject}
            onOpenProject={handleOpenProject}
            projectTags={projectTags}
            selectedProjectTags={selectedProjectTags}
            onToggleProjectTag={(tag) =>
              setSelectedProjectTags((prev) => {
                const next = new Map(prev);
                const current = next.get(tag);
                if (!current) next.set(tag, 'include');
                else if (current === 'include') next.set(tag, 'exclude');
                else next.delete(tag);
                return next;
              })
            }
            onClearProjectTags={() => setSelectedProjectTags(new Map())}
            onProjectTagAdded={handleProjectTagAdded}
            onProjectTagRemoved={handleProjectTagRemoved}
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
            tokenInvalidAccountIds={tokenInvalidAccountIds}
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
