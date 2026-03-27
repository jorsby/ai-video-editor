'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  IconBug,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconLayoutGrid,
  IconLoader2,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
// DropdownMenu removed — series-level settings no longer selectable per storyboard
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LanguageCode } from '@/lib/constants/languages';
import { useLanguageStore } from '@/stores/language-store';
import { useProjectId } from '@/contexts/project-context';
import { useDeleteConfirmation } from '@/contexts/delete-confirmation-context';
import { useMediaPanelStore } from '../store';
import { toast } from 'sonner';
import {
  getDraftStoryboard,
  getStoryboardsForProject,
  type Storyboard,
  type StoryboardPlan,
  type RefPlan,
  type StoryboardMode,
  type VideoModel,
} from '@/lib/supabase/workflow-service';
import { StoryboardCards } from './storyboard-cards';
import { DraftPlanEditor } from './draft-plan-editor';

type RefWorkflowVariant = 'i2v_from_refs' | 'direct_ref_to_video';

function getRefWorkflowVariant(plan: unknown): RefWorkflowVariant | null {
  const workflowVariant =
    plan && typeof plan === 'object' && 'workflow_variant' in plan
      ? (plan as { workflow_variant?: unknown }).workflow_variant
      : undefined;

  if (
    workflowVariant === 'i2v_from_refs' ||
    workflowVariant === 'direct_ref_to_video'
  ) {
    return workflowVariant;
  }

  return null;
}

function getStoryboardModeLabel(storyboard: Storyboard): string {
  if (storyboard.mode === 'quick_video') return '[Quick]';

  if (storyboard.mode === 'image_to_video') return '[I2V Legacy]';

  if (storyboard.mode !== 'ref_to_video') return '';

  const variant = getRefWorkflowVariant(storyboard.plan);

  if (variant === 'i2v_from_refs') return '[I2V]';

  return '[Ref]';
}

function getStoryboardVideoModeBadge(
  storyboard: Storyboard
): 'Narrative' | 'Cinematic' | null {
  if (
    storyboard.mode === 'ref_to_video' &&
    storyboard.plan &&
    typeof storyboard.plan === 'object' &&
    'video_mode' in storyboard.plan
  ) {
    if (storyboard.plan.video_mode === 'dialogue_scene') {
      return 'Cinematic';
    }

    if (storyboard.plan.video_mode === 'narrative') {
      return 'Narrative';
    }
  }

  return null;
}

function pickPreferredStoryboard(storyboards: Storyboard[]): Storyboard | null {
  if (storyboards.length === 0) return null;

  const approved = storyboards.find((sb) => sb.plan_status === 'approved');
  if (approved) return approved;

  const nonDraft = storyboards.find((sb) => sb.plan_status !== 'draft');
  if (nonDraft) return nonDraft;

  return storyboards[0];
}

function getStatusBadgeClasses(status: Storyboard['plan_status']) {
  if (status === 'approved') {
    return 'bg-green-500/10 text-green-400 border-green-500/30';
  }

  if (status === 'draft') {
    return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
  }

  if (status === 'failed') {
    return 'bg-red-500/10 text-red-400 border-red-500/30';
  }

  return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
}

type V2AssetJob = {
  asset_type: 'object' | 'background';
  grid_position: number;
  name: string;
  request_id: string | null;
  status: 'queued' | 'failed';
  error?: string;
};

function getV2AssetJobs(plan: Storyboard['plan']): V2AssetJob[] {
  if (!plan || typeof plan !== 'object' || !('v2_asset_jobs' in plan)) {
    return [];
  }

  const assetJobs = (plan as Record<string, unknown>).v2_asset_jobs;
  if (
    !assetJobs ||
    typeof assetJobs !== 'object' ||
    !('jobs' in assetJobs) ||
    !Array.isArray((assetJobs as { jobs?: unknown }).jobs)
  ) {
    return [];
  }

  return ((assetJobs as { jobs: unknown[] }).jobs ?? []).filter(
    (job): job is V2AssetJob => {
      if (!job || typeof job !== 'object') return false;
      const cast = job as Partial<V2AssetJob>;

      return (
        (cast.asset_type === 'object' || cast.asset_type === 'background') &&
        typeof cast.grid_position === 'number' &&
        typeof cast.name === 'string' &&
        (cast.status === 'queued' || cast.status === 'failed')
      );
    }
  );
}

interface StoryboardResponse {
  rows: number;
  cols: number;
  grid_image_prompt: string;
  voiceover_list: string[];
  visual_flow: string[];
}

type ViewMode = 'view' | 'create' | 'draft';

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function PanelStoryboard() {
  const projectId = useProjectId();
  const { confirm } = useDeleteConfirmation();
  const selectedStoryboardIdFromStore = useMediaPanelStore(
    (state) => state.selectedStoryboardId
  );
  const setSelectedStoryboardIdInStore = useMediaPanelStore(
    (state) => state.setSelectedStoryboardId
  );
  const showStoryboardDebugPanel = useMediaPanelStore(
    (state) => state.showStoryboardDebugPanel
  );
  const setShowStoryboardDebugPanel = useMediaPanelStore(
    (state) => state.setShowStoryboardDebugPanel
  );

  // Storyboard navigation state
  const [viewMode, setViewMode] = useState<ViewMode>('create');
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [selectedStoryboardId, setSelectedStoryboardId] = useState<
    string | null
  >(null);

  // Generation state
  const [result, setResult] = useState<StoryboardResponse | null>(null);
  const [error, _setError] = useState<string | null>(null);
  const [workflowError, _setWorkflowError] = useState<string | null>(null);
  const [workflowStarted, setWorkflowStarted] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Draft state
  const [draftPlan, setDraftPlan] = useState<StoryboardPlan | RefPlan | null>(
    null
  );
  const [draftStoryboardId, setDraftStoryboardId] = useState<string | null>(
    null
  );
  const [draftMode, setDraftMode] = useState<StoryboardMode>('image_to_video');
  const [draftVideoModel, setDraftVideoModel] = useState<VideoModel | null>(
    null
  );
  const [isApprovingDraft, setIsApprovingDraft] = useState(false);
  const [isRetryingAssets, setIsRetryingAssets] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // Derived state
  const selectedStoryboard = storyboards.find(
    (sb) => sb.id === selectedStoryboardId
  );

  const selectedStoryboardAssetJobs = selectedStoryboard
    ? getV2AssetJobs(selectedStoryboard.plan)
    : [];
  const selectedStoryboardQueuedJobs = selectedStoryboardAssetJobs.filter(
    (job) => job.status === 'queued'
  );
  const selectedStoryboardFailedJobs = selectedStoryboardAssetJobs.filter(
    (job) => job.status === 'failed'
  );

  // Fetch storyboards on mount and when projectId changes
  useEffect(() => {
    if (!projectId) return;

    const loadStoryboards = async () => {
      const data = await getStoryboardsForProject(projectId);
      setStoryboards(data);

      const preferredStoryboard = pickPreferredStoryboard(data);
      const currentStillExists = selectedStoryboardId
        ? data.some((sb) => sb.id === selectedStoryboardId)
        : false;

      if (!currentStillExists) {
        setSelectedStoryboardId(preferredStoryboard?.id ?? null);
      }

      const inlineDraft = data.find((sb) => sb.plan_status === 'draft');
      const fallbackDraft = inlineDraft
        ? null
        : await getDraftStoryboard(projectId);
      const draft = inlineDraft ?? fallbackDraft;

      if (draft?.plan) {
        setDraftPlan(draft.plan);
        setDraftStoryboardId(draft.id);
        setDraftMode(draft.mode || 'image_to_video');
        setDraftVideoModel(draft.model || null);

        const nonDraftStoryboards = data.filter(
          (sb) => sb.plan_status !== 'draft'
        );
        if (nonDraftStoryboards.length === 0) {
          setViewMode('draft');
          return;
        }
      } else {
        setDraftPlan(null);
        setDraftStoryboardId(null);
        setDraftMode('image_to_video');
        setDraftVideoModel(null);
      }

      if (preferredStoryboard) {
        setViewMode('view');
      } else {
        setViewMode('create');
      }
    };

    loadStoryboards();
  }, [projectId, selectedStoryboardId]);

  useEffect(() => {
    if (!selectedStoryboardIdFromStore) return;

    const existsInCurrentList = storyboards.some(
      (storyboard) => storyboard.id === selectedStoryboardIdFromStore
    );

    if (!existsInCurrentList) {
      if (storyboards.length > 0) {
        setSelectedStoryboardIdInStore(null);
      }
      return;
    }

    setSelectedStoryboardId(selectedStoryboardIdFromStore);
    setViewMode('view');
    setSelectedStoryboardIdInStore(null);
  }, [
    selectedStoryboardIdFromStore,
    setSelectedStoryboardIdInStore,
    storyboards,
  ]);

  const refreshStoryboardsAfterCreate = async () => {
    if (!projectId) return;
    const newStoryboards = await getStoryboardsForProject(projectId);
    setStoryboards(newStoryboards);

    const preferredStoryboard = pickPreferredStoryboard(newStoryboards);
    if (preferredStoryboard) {
      setSelectedStoryboardId(preferredStoryboard.id);
      setViewMode('view');
      return;
    }

    setSelectedStoryboardId(null);
    setViewMode('create');
  };

  const handleDeleteStoryboard = async () => {
    if (!selectedStoryboardId) return;

    const confirmed = await confirm({
      title: 'Delete Storyboard',
      description:
        'Are you sure you want to delete this storyboard? All scenes and generated content will be permanently removed.',
    });

    if (!confirmed) return;

    try {
      const response = await fetch(
        `/api/storyboard?id=${selectedStoryboardId}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error('Failed to delete storyboard');
      }

      // Remove from local state
      const updatedStoryboards = storyboards.filter(
        (sb) => sb.id !== selectedStoryboardId
      );
      setStoryboards(updatedStoryboards);

      // Select next storyboard or switch to create mode
      const preferredStoryboard = pickPreferredStoryboard(updatedStoryboards);
      if (preferredStoryboard) {
        setSelectedStoryboardId(preferredStoryboard.id);
        setViewMode('view');
      } else {
        setSelectedStoryboardId(null);
        setViewMode('create');
      }
    } catch (error) {
      console.error('Failed to delete storyboard:', error);
    }
  };

  const handleApproveDraft = async () => {
    if (!draftStoryboardId || !draftPlan) return;

    setIsApprovingDraft(true);
    setDraftError(null);

    try {
      // First, save any pending plan changes
      const patchResponse = await fetch('/api/storyboard', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyboardId: draftStoryboardId,
          plan: draftPlan,
        }),
      });

      if (!patchResponse.ok) {
        const errorData = await patchResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save plan changes');
      }

      // Ref-to-video drafts must go through the v2 production approve path.
      const isRefToVideoDraft = draftMode === 'ref_to_video';
      const approveEndpoint = isRefToVideoDraft
        ? `/api/v2/storyboard/${draftStoryboardId}/approve`
        : '/api/storyboard/approve';
      const approveBody = isRefToVideoDraft
        ? {}
        : { storyboardId: draftStoryboardId };

      const approveResponse = await fetch(approveEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(approveBody),
      });

      if (!approveResponse.ok) {
        const errorData = await approveResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to approve storyboard');
      }

      console.log('[Storyboard] Draft approved, scenes created', {
        mode: draftMode,
        endpoint: approveEndpoint,
      });

      // Sync language store with storyboard's source language
      const voiceoverList = (
        draftPlan as { voiceover_list?: Record<string, string[]> }
      ).voiceover_list;
      if (voiceoverList) {
        const sourceLang = Object.keys(voiceoverList)[0] as LanguageCode;
        if (sourceLang) {
          const store = useLanguageStore.getState();
          if (sourceLang !== store.activeLanguage) {
            store.setActiveLanguage(sourceLang);
          }
          if (!store.availableLanguages.includes(sourceLang)) {
            store.setAvailableLanguages([
              ...store.availableLanguages,
              sourceLang,
            ]);
          }
        }
      }

      // Clear draft state and refresh
      setDraftPlan(null);
      setDraftStoryboardId(null);
      setResult(null);
      setWorkflowStarted(true);
      setRefreshTrigger((prev) => prev + 1);
      await refreshStoryboardsAfterCreate();
    } catch (err) {
      console.error('[Storyboard] Approve error:', err);
      setDraftError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsApprovingDraft(false);
    }
  };

  const handleRetryFailedAssets = async () => {
    if (!selectedStoryboardId) return;

    setIsRetryingAssets(true);

    try {
      const response = await fetch(
        `/api/v2/storyboard/${selectedStoryboardId}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resolution: '1k',
            retry_failed: true,
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Failed to retry failed assets');
      }

      toast.success('Retry started for failed assets');
      setRefreshTrigger((prev) => prev + 1);
      await refreshStoryboardsAfterCreate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Retry failed to start'
      );
    } finally {
      setIsRetryingAssets(false);
    }
  };

  const handleRegenerateDraft = async () => {
    if (!draftStoryboardId) return;

    // Delete the current draft
    try {
      await fetch(`/api/storyboard?id=${draftStoryboardId}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('[Storyboard] Failed to delete draft:', err);
    }

    // Clear draft state and fall back to view mode
    setDraftPlan(null);
    setDraftStoryboardId(null);
    setDraftMode('image_to_video');
    setDraftVideoModel(null);
    setDraftError(null);
    setResult(null);
    setViewMode('view');
    await refreshStoryboardsAfterCreate();
  };

  const handleCancelDraft = async () => {
    if (draftStoryboardId) {
      // Delete the draft
      try {
        await fetch(`/api/storyboard?id=${draftStoryboardId}`, {
          method: 'DELETE',
        });
      } catch (err) {
        console.error('[Storyboard] Failed to delete draft:', err);
      }
    }

    // Clear draft state
    setDraftPlan(null);
    setDraftStoryboardId(null);
    setDraftMode('image_to_video');
    setDraftVideoModel(null);
    setDraftError(null);
    setResult(null);
    setViewMode('create');
  };

  return (
    <div className="h-full flex flex-col">
      {/* Storyboard Navigation Header */}
      <div className="flex-none border-b border-border/50 p-3">
        <div className="flex items-center gap-2">
          <Select
            value={selectedStoryboardId || ''}
            onValueChange={(value) => {
              const selected = storyboards.find((sb) => sb.id === value);
              setSelectedStoryboardId(value);

              if (selected?.plan_status === 'draft' && selected.plan) {
                setDraftPlan(selected.plan);
                setDraftStoryboardId(selected.id);
                setDraftMode(selected.mode || 'image_to_video');
                setDraftVideoModel(selected.model || null);
                setViewMode('draft');
                return;
              }

              setViewMode('view');
            }}
            disabled={storyboards.length === 0}
          >
            <SelectTrigger className="flex-1 h-8 text-xs">
              <SelectValue placeholder="No storyboards yet" />
            </SelectTrigger>
            <SelectContent>
              {storyboards.map((sb) => (
                <SelectItem key={sb.id} value={sb.id}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate">
                      {sb.title || formatDate(sb.created_at)} ({sb.aspect_ratio}
                      ) {getStoryboardModeLabel(sb)}
                    </span>
                    {getStoryboardVideoModeBadge(sb) && (
                      <span className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded border bg-purple-500/10 text-purple-400 border-purple-500/30">
                        {getStoryboardVideoModeBadge(sb)}
                      </span>
                    )}
                    <span
                      className={`text-[9px] uppercase tracking-wide px-1 py-0.5 rounded border ${getStatusBadgeClasses(
                        sb.plan_status
                      )}`}
                    >
                      {sb.plan_status ?? 'unknown'}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedStoryboardId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={handleDeleteStoryboard}
            >
              <IconTrash className="size-4" />
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            onClick={() => {
              setViewMode('view');
            }}
          >
            <IconPlus className="size-3" />
            New
          </Button>
          {selectedStoryboardId && (
            <Button
              variant={showStoryboardDebugPanel ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 gap-1"
              onClick={() =>
                setShowStoryboardDebugPanel(!showStoryboardDebugPanel)
              }
              title="Toggle prompt-contract debug inspector"
            >
              <IconBug className="size-3" />
              Debug
            </Button>
          )}
        </div>

        {selectedStoryboardId && showStoryboardDebugPanel && (
          <div className="mt-1.5 rounded border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[10px] text-amber-200 font-medium">
            Prompt-contract debug mode is ON. Scene cards now show inspector
            data and execution-source context.
          </div>
        )}

        {/* Draft banner — show when viewing approved storyboards but a draft exists */}
        {viewMode === 'view' && draftPlan && draftStoryboardId && (
          <button
            type="button"
            className="w-full mt-1.5 px-2 py-1 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded hover:bg-amber-500/20 transition-colors text-left"
            onClick={() => setViewMode('draft')}
          >
            📝 Unsaved draft — click to resume
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <ScrollArea className="flex-1 p-4">
        {/* Error Display */}
        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive mb-4">
            {error}
          </div>
        )}

        {/* Workflow Status Messages - hide in draft mode */}
        {result && viewMode !== 'draft' && (
          <div className="flex flex-col gap-4 mb-4">
            {/* Raw JSON - collapsed by default */}
            <details className="p-3 bg-secondary/30 rounded-md">
              <summary className="text-xs text-muted-foreground cursor-pointer">
                Raw JSON
              </summary>
              <pre className="mt-2 text-xs overflow-x-auto p-2 bg-background/50 rounded whitespace-pre-wrap">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>

            {workflowError && (
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
                {workflowError}
              </div>
            )}

            {workflowStarted && (
              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-md flex items-center gap-2">
                <IconCheck className="size-4 text-green-500" />
                <span className="text-sm text-green-500">
                  Workflow started successfully
                </span>
              </div>
            )}
          </div>
        )}

        {/* Draft Plan Editor - show when in draft mode */}
        {viewMode === 'draft' && draftPlan && (
          <>
            {storyboards.some((sb) => sb.plan_status !== 'draft') && (
              <button
                type="button"
                className="w-full mb-2 px-2 py-1 text-[10px] text-muted-foreground bg-muted/30 border border-border/50 rounded hover:bg-muted/50 transition-colors text-left"
                onClick={() => {
                  const preferred = pickPreferredStoryboard(
                    storyboards.filter((sb) => sb.plan_status !== 'draft')
                  );
                  if (preferred) {
                    setSelectedStoryboardId(preferred.id);
                    setViewMode('view');
                  }
                }}
              >
                ← Back to storyboards
              </button>
            )}
            <DraftPlanEditor
              plan={draftPlan}
              mode={draftMode}
              videoModel={draftVideoModel}
              onPlanChange={setDraftPlan}
              onApprove={handleApproveDraft}
              onRegenerate={handleRegenerateDraft}
              onCancel={handleCancelDraft}
              isApproving={isApprovingDraft}
              error={draftError}
              hideAssetSections
            />
          </>
        )}

        {/* Plan (read-only) - show when viewing a storyboard that has a plan */}
        {viewMode === 'view' && selectedStoryboard?.plan && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between h-8 text-xs text-muted-foreground hover:text-foreground mb-2 group"
              >
                Plan (
                {'scene_prompts' in selectedStoryboard.plan
                  ? selectedStoryboard.plan.scene_prompts.length
                  : ((
                      Object.values(
                        (selectedStoryboard.plan.voiceover_list as Record<
                          string,
                          string[]
                        >) ?? {}
                      )[0] as string[] | undefined
                    )?.length ?? 0)}{' '}
                scenes)
                <IconChevronDown className="size-3 group-data-[state=open]:hidden" />
                <IconChevronUp className="size-3 hidden group-data-[state=open]:block" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <DraftPlanEditor
                plan={selectedStoryboard.plan}
                mode={selectedStoryboard.mode || 'image_to_video'}
                videoModel={selectedStoryboard.model}
                readOnly
                hideAssetSections
              />
            </CollapsibleContent>
          </Collapsible>
        )}

        {viewMode === 'view' &&
          selectedStoryboard?.mode === 'ref_to_video' &&
          (selectedStoryboard.plan_status === 'generating' ||
            selectedStoryboard.plan_status === 'failed') &&
          selectedStoryboardAssetJobs.length > 0 && (
            <div className="mb-3 rounded-md border border-border/60 bg-secondary/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium">
                    Missing asset generation
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Queued: {selectedStoryboardQueuedJobs.length} • Failed:{' '}
                    {selectedStoryboardFailedJobs.length}
                  </div>
                </div>
                {selectedStoryboardFailedJobs.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={handleRetryFailedAssets}
                    disabled={isRetryingAssets}
                  >
                    {isRetryingAssets && (
                      <IconLoader2 className="mr-1.5 size-3 animate-spin" />
                    )}
                    Retry failed
                  </Button>
                )}
              </div>
              {selectedStoryboardFailedJobs.length > 0 && (
                <div className="mt-2 space-y-1 text-[11px] text-red-400">
                  {selectedStoryboardFailedJobs.slice(0, 5).map((job) => (
                    <div
                      key={`${job.asset_type}-${job.grid_position}-${job.name}`}
                    >
                      {job.asset_type}: {job.name}
                      {job.error ? ` — ${job.error}` : ''}
                    </div>
                  ))}
                  {selectedStoryboardFailedJobs.length > 5 && (
                    <div className="text-muted-foreground">
                      +{selectedStoryboardFailedJobs.length - 5} more failed
                      items
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        {/* Scene Cards - show only when viewing a selected storyboard */}
        {projectId && viewMode === 'view' && selectedStoryboardId && (
          <div className="mt-4">
            <div className="text-xs text-muted-foreground mb-2">Scenes</div>
            <StoryboardCards
              projectId={projectId}
              storyboardId={selectedStoryboardId}
              refreshTrigger={refreshTrigger}
            />
          </div>
        )}

        {/* Empty State */}
        {!projectId && (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
            <IconLayoutGrid size={32} className="opacity-50" />
            <span className="text-sm text-center">
              Enter your voiceover script to generate a storyboard.
            </span>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
