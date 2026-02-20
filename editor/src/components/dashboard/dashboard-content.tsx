'use client';

import { useState, useEffect } from 'react';
import { ProjectList } from './project-list';
import { SocialAccountsList } from './social-accounts-list';
import { PostsTab } from './posts-tab';
import { CreateProjectModal } from './create-project-modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { DBProject } from '@/types/project';
import type { MixpostAccount, AccountGroupWithMembers, AccountTagMap } from '@/types/mixpost';

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

  useEffect(() => {
    fetchAccounts();
    fetchGroups();
    fetchTags();
  }, []);

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

  return (
    <>
      <Tabs defaultValue="projects">
        <TabsList>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="social">Social</TabsTrigger>
          <TabsTrigger value="posts">Posts</TabsTrigger>
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
          />
        </TabsContent>

        <TabsContent value="posts">
          <PostsTab
            accounts={accounts}
            accountsLoading={accountsLoading}
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
