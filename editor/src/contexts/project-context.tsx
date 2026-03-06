'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

interface ProjectContextValue {
  projectId: string;
  projectName: string;
  renameProject: (name: string) => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [projectName, setProjectName] = useState('Untitled video');

  useEffect(() => {
    async function fetchName() {
      try {
        const res = await fetch('/api/projects');
        if (!res.ok) return;
        const { projects } = await res.json();
        const project = projects?.find(
          (p: { id: string; name: string }) => p.id === projectId
        );
        if (project?.name) {
          setProjectName(project.name);
        }
      } catch {
        // keep default name
      }
    }
    fetchName();
  }, [projectId]);

  const renameProject = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const previous = projectName;
      setProjectName(trimmed);
      try {
        const res = await fetch('/api/projects', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: projectId, name: trimmed }),
        });
        if (!res.ok) {
          setProjectName(previous);
        }
      } catch {
        setProjectName(previous);
      }
    },
    [projectId, projectName]
  );

  return (
    <ProjectContext.Provider value={{ projectId, projectName, renameProject }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}

export function useProjectId() {
  return useProject().projectId;
}
