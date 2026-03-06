'use client';

import { useState, use, useCallback } from 'react';
import { MediaPanel } from '@/components/editor/media-panel';
import { PreviewPanel } from '@/components/editor/preview-panel';
import { Timeline } from '@/components/editor/timeline';
import FloatingControl from '@/components/editor/floating-controls/floating-control';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { usePanelStore } from '@/stores/panel-store';
import Header from '@/components/editor/header';
import { Loading } from '@/components/editor/loading';
import { ProjectProvider, useProjectId } from '@/contexts/project-context';
import { DeleteConfirmationProvider } from '@/contexts/delete-confirmation-context';
import { useAutoSave, type SaveStatus } from '@/hooks/use-auto-save';
import { useWorkflowToasts } from '@/hooks/use-workflow-toasts';

interface EditorPageProps {
  params: Promise<{ projectId: string }>;
}

function EditorContent({ onReady }: { onReady: () => void }) {
  const {
    toolsPanel,
    mainContent,
    timeline,
    setToolsPanel,
    setMainContent,
    setTimeline,
  } = usePanelStore();

  return (
    <div className="flex-1 min-h-0 min-w-0 px-3">
      <ResizablePanelGroup
        direction="horizontal"
        className="h-full w-full gap-1"
      >
        {/* Left Column: Media Panel */}
        <ResizablePanel
          defaultSize={toolsPanel}
          minSize={15}
          maxSize={50}
          onResize={setToolsPanel}
          className="min-w-96 relative overflow-visible! rounded-sm"
        >
          <MediaPanel />
          <FloatingControl />
        </ResizablePanel>

        <ResizableHandle />

        {/* Middle Column: Preview + Timeline */}
        <ResizablePanel
          defaultSize={100 - toolsPanel}
          minSize={40}
          className="min-w-0 min-h-0"
        >
          <ResizablePanelGroup
            direction="vertical"
            className="h-full w-full gap-1"
          >
            {/* Preview Panel */}
            <ResizablePanel
              defaultSize={mainContent}
              minSize={30}
              maxSize={85}
              onResize={setMainContent}
              className="min-h-0"
            >
              <PreviewPanel onReady={onReady} />
            </ResizablePanel>

            <ResizableHandle />

            {/* Timeline Panel */}
            <ResizablePanel
              defaultSize={timeline}
              minSize={15}
              maxSize={70}
              onResize={setTimeline}
              className="min-h-0"
            >
              <Timeline />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function EditorShell() {
  const [isReady, setIsReady] = useState(false);
  const { saveNow, saveStatus } = useAutoSave();
  const handleReady = useCallback(() => setIsReady(true), []);
  const projectId = useProjectId();
  useWorkflowToasts(projectId);

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden">
      {!isReady && (
        <div className="absolute inset-0 z-50">
          <Loading />
        </div>
      )}
      <Header saveNow={saveNow} saveStatus={saveStatus} />
      <EditorContent onReady={handleReady} />
    </div>
  );
}

export default function Editor({ params }: EditorPageProps) {
  const { projectId } = use(params);

  return (
    <ProjectProvider projectId={projectId}>
      <DeleteConfirmationProvider>
        <EditorShell />
      </DeleteConfirmationProvider>
    </ProjectProvider>
  );
}
