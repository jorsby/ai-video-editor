'use client';

import { useState } from 'react';
import {
  Plus,
  FolderPlus,
  Archive,
  ArchiveRestore,
  CheckSquare,
  Square,
  Trash2,
  X,
} from 'lucide-react';
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
  selectedProjectTags: Map<string, 'include' | 'exclude'>;
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
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(projects.map((p) => p.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = window.confirm(
      `Delete ${selectedIds.size} project(s)? This cannot be undone.`
    );
    if (!confirmed) return;

    setBulkDeleting(true);
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/projects?id=${id}`, {
          method: 'DELETE',
        });
        if (res.ok) onDeleteProject(id);
      } catch {
        // continue
      }
    }
    setSelectedIds(new Set());
    setSelectMode(false);
    setBulkDeleting(false);
  };

  const handleBulkArchive = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    for (const id of selectedIds) {
      try {
        onArchiveProject(id);
      } catch {
        // continue
      }
    }
    setSelectedIds(new Set());
    setSelectMode(false);
    setBulkDeleting(false);
  };

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
            <h2 className="text-lg font-semibold text-foreground">
              Archived Projects
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleArchived}
              className="gap-2"
            >
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
          {selectMode ? (
            <>
              <span className="text-xs text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={
                  selectedIds.size === projects.length ? deselectAll : selectAll
                }
                className="gap-1 text-xs"
              >
                {selectedIds.size === projects.length
                  ? 'Deselect All'
                  : 'Select All'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkArchive}
                disabled={selectedIds.size === 0 || bulkDeleting}
                className="gap-1 text-xs"
              >
                <Archive className="w-3.5 h-3.5" />
                Archive
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0 || bulkDeleting}
                className="gap-1 text-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {bulkDeleting ? 'Deleting...' : 'Delete'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectMode(false);
                  setSelectedIds(new Set());
                }}
                className="gap-1 text-xs"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectMode(true)}
                className="gap-2"
              >
                <CheckSquare className="w-4 h-4" />
                Select
              </Button>
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
            </>
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
          <div key={project.id} className="flex items-center gap-2">
            {selectMode && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelect(project.id);
                }}
                className="shrink-0 p-1"
              >
                {selectedIds.has(project.id) ? (
                  <CheckSquare className="w-5 h-5 text-primary" />
                ) : (
                  <Square className="w-5 h-5 text-muted-foreground" />
                )}
              </button>
            )}
            <div className="flex-1">
              <ProjectCard
                project={project}
                isArchived={showArchived}
                onDelete={onDeleteProject}
                onArchive={onArchiveProject}
                onClick={() =>
                  selectMode
                    ? toggleSelect(project.id)
                    : onOpenProject(project.id)
                }
                tags={projectTags[project.id] ?? []}
                onTagAdded={onProjectTagAdded}
                onTagRemoved={onProjectTagRemoved}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
