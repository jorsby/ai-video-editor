'use client';

import { useState, useEffect } from 'react';
import { ProjectList } from './project-list';
import { SocialAccountsList } from './social-accounts-list';
import { CreateProjectModal } from './create-project-modal';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { DBProject } from '@/types/project';
import type { MixpostAccount } from '@/types/mixpost';

export function DashboardContent() {
  const [projects, setProjects] = useState<DBProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [accounts, setAccounts] = useState<MixpostAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects();
    fetchAccounts();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects');
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

  const handleProjectCreated = (project: DBProject) => {
    setProjects((prev) => [project, ...prev]);
    // Open the new project in a new tab
    window.open(`/editor/${project.id}`, '_blank');
  };

  const handleDeleteProject = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  const handleOpenProject = (id: string) => {
    window.open(`/editor/${id}`, '_blank');
  };

  return (
    <>
      <Tabs defaultValue="projects">
        <TabsList>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="social">Social</TabsTrigger>
        </TabsList>

        <TabsContent value="projects">
          <ProjectList
            projects={projects}
            isLoading={isLoading}
            onCreateProject={() => setShowCreateModal(true)}
            onDeleteProject={handleDeleteProject}
            onOpenProject={handleOpenProject}
          />
        </TabsContent>

        <TabsContent value="social">
          <SocialAccountsList
            accounts={accounts}
            isLoading={accountsLoading}
            error={accountsError}
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
