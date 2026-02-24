'use client';

import { Plus, FolderPlus, Archive, ArchiveRestore } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProjectCard } from './project-card';
import { ProjectTagFilter } from './project-tag-filter';
import type { DBProject, ProjectTagMap } from '@/types/project';

interface ProjectListProps {
  projects: DBProject[];
  isLoading: boolean;
  showArchived: boolean;
  onToggleArchived: () => void;
  onCreateProject: () => void;
  onDeleteProject: (id: string) => void;
  onArchiveProject: (id: string) => void;
  onOpenProject: (id: string) => void;
  projectTags: ProjectTagMap;
  selectedProjectTags: Set<string>;
  onToggleProjectTag: (tag: string) => void;
  onClearProjectTags: () => void;
  onProjectTagAdded: (projectId: string, tag: string) => void;
  onProjectTagRemoved: (projectId: string, tag: string) => void;
}

export function ProjectList({
  projects,
  isLoading,
  showArchived,
  onToggleArchived,
  onCreateProject,
  onDeleteProject,
  onArchiveProject,
  onOpenProject,
  projectTags,
  selectedProjectTags,
  onToggleProjectTag,
  onClearProjectTags,
  onProjectTagAdded,
  onProjectTagRemoved,
}: ProjectListProps) {
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

  if (projects.length === 0) {
    if (showArchived) {
      return (
        <div className="w-full max-w-3xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Archived Projects</h2>
            <Button variant="outline" size="sm" onClick={onToggleArchived} className="gap-2">
              <ArchiveRestore className="w-4 h-4" />
              View Active
            </Button>
          </div>
          <div className="text-center py-12">
            <p className="text-muted-foreground">No archived projects</p>
          </div>
        </div>
      );
    }

    return (
      <div className="text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted">
          <FolderPlus className="w-8 h-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">
            No projects yet
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Create your first project to start editing videos with AI
            assistance.
          </p>
        </div>
        <Button size="lg" onClick={onCreateProject} className="gap-2">
          <Plus className="w-4 h-4" />
          Create Project
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">
          {showArchived ? 'Archived Projects' : 'Your Projects'}
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleArchived}
            className="gap-2"
          >
            {showArchived ? (
              <>
                <ArchiveRestore className="w-4 h-4" />
                View Active
              </>
            ) : (
              <>
                <Archive className="w-4 h-4" />
                View Archived
              </>
            )}
          </Button>
          {!showArchived && (
            <Button size="sm" onClick={onCreateProject} className="gap-2">
              <Plus className="w-4 h-4" />
              New Project
            </Button>
          )}
        </div>
      </div>

      <ProjectTagFilter
        tags={projectTags}
        selectedTags={selectedProjectTags}
        onToggleTag={onToggleProjectTag}
        onClear={onClearProjectTags}
      />

      <div className="grid gap-3">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            isArchived={showArchived}
            onDelete={onDeleteProject}
            onArchive={onArchiveProject}
            onClick={() => onOpenProject(project.id)}
            tags={projectTags[project.id] ?? []}
            onTagAdded={onProjectTagAdded}
            onTagRemoved={onProjectTagRemoved}
          />
        ))}
      </div>
    </div>
  );
}
