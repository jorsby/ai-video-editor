'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconLayoutGrid,
  IconLoader2,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  type RefVideoMode,
} from '@/lib/supabase/workflow-service';
import { StoryboardCards } from './storyboard-cards';
import { DraftPlanEditor } from './draft-plan-editor';
import {
  DEFAULT_STORYBOARD_CONTENT_TEMPLATE,
  STORYBOARD_CONTENT_TEMPLATE_OPTIONS,
  type StoryboardContentTemplate,
} from '@/lib/storyboard-content-template';

const ASPECT_RATIOS = [
  { value: '16:9', label: '16:9', width: 1920, height: 1080 },
  { value: '9:16', label: '9:16', width: 1080, height: 1920 },
  { value: '1:1', label: '1:1', width: 1080, height: 1080 },
] as const;

type AspectRatio = (typeof ASPECT_RATIOS)[number]['value'];

const STORYBOARD_MODELS = [
  { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { value: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
  { value: 'openai/gpt-5.2-pro', label: 'GPT 5.2 Pro' },
  { value: 'z-ai/glm-5', label: 'GLM-5' },
] as const;

type StoryboardModel = (typeof STORYBOARD_MODELS)[number]['value'];

type CreateVideoMode =
  | 'image_to_video'
  | 'image_to_video_legacy'
  | 'ref_to_video'
  | 'quick_video';

const VIDEO_MODES = [
  {
    value: 'image_to_video' as const,
    label: 'Image to Video',
  },
  {
    value: 'image_to_video_legacy' as const,
    label: 'Image to Video (Legacy)',
  },
  { value: 'ref_to_video' as const, label: 'Ref to Video' },
] as const;

const VIDEO_MODELS = [
  { value: 'klingo3' as const, label: 'Kling O3' },
] as const;

const REF_VIDEO_MODE_OPTIONS = [
  { value: 'narrative' as const, label: 'Narrative (Audio OFF)' },
  { value: 'dialogue_scene' as const, label: 'Cinematic (Audio ON)' },
] as const;

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

  // Storyboard navigation state
  const [viewMode, setViewMode] = useState<ViewMode>('create');
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [selectedStoryboardId, setSelectedStoryboardId] = useState<
    string | null
  >(null);

  // Form state (for create mode)
  const [formVoiceover, setFormVoiceover] = useState('');
  const [formAspectRatio, setFormAspectRatio] = useState<AspectRatio>('9:16');
  const [formModel, setFormModel] = useState<StoryboardModel>(
    'google/gemini-3.1-pro-preview'
  );
  const [formVideoMode, setFormVideoMode] =
    useState<CreateVideoMode>('image_to_video');
  const [formVideoModel, setFormVideoModel] = useState<VideoModel>('klingo3');
  const [formRefVideoMode, setFormRefVideoMode] =
    useState<RefVideoMode>('narrative');
  const [formContentTemplate, setFormContentTemplate] =
    useState<StoryboardContentTemplate>(DEFAULT_STORYBOARD_CONTENT_TEMPLATE);

  // Generation state
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StoryboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
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
  const [draftError, setDraftError] = useState<string | null>(null);

  // Derived state
  const selectedStoryboard = storyboards.find(
    (sb) => sb.id === selectedStoryboardId
  );
  const selectedStoryboardRefVariant = selectedStoryboard
    ? getRefWorkflowVariant(selectedStoryboard.plan)
    : null;
  const selectedStoryboardVideoMode =
    selectedStoryboard?.mode === 'ref_to_video' &&
    selectedStoryboard.plan &&
    typeof selectedStoryboard.plan === 'object' &&
    'video_mode' in selectedStoryboard.plan
      ? (selectedStoryboard.plan.video_mode as RefVideoMode | undefined)
      : undefined;
  const isSelectedStoryboardCinematic =
    selectedStoryboard?.mode === 'ref_to_video' &&
    selectedStoryboardVideoMode === 'dialogue_scene';

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

  const handleGenerate = async () => {
    if (!formVoiceover.trim()) return;

    if (!projectId) {
      setError(
        'No project selected. Create or select a project before generating a storyboard.'
      );
      console.error('[Storyboard] Generate blocked: projectId is null');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setWorkflowStarted(false);
    setWorkflowError(null);
    setDraftError(null);

    try {
      console.log('[Storyboard] Generating storyboard plan...', {
        projectId,
        aspectRatio: formAspectRatio,
        voiceoverLength: formVoiceover.length,
      });

      const resolvedMode: StoryboardMode =
        formVideoMode === 'image_to_video'
          ? 'ref_to_video'
          : formVideoMode === 'image_to_video_legacy'
            ? 'image_to_video'
            : formVideoMode;

      const workflowVariant: RefWorkflowVariant | undefined =
        formVideoMode === 'image_to_video'
          ? 'i2v_from_refs'
          : formVideoMode === 'ref_to_video'
            ? 'direct_ref_to_video'
            : undefined;

      const resolvedVideoModel =
        formVideoMode === 'image_to_video' ? 'wan26flash' : formVideoModel;

      const resolvedRefVideoMode: RefVideoMode =
        resolvedMode === 'ref_to_video' &&
        (resolvedVideoModel === 'wan26flash' ||
          resolvedVideoModel === 'klingo3' ||
          resolvedVideoModel === 'klingo3pro')
          ? formRefVideoMode
          : 'narrative';

      // Generate storyboard with AI and create draft record
      const response = await fetch('/api/storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceoverText: formVoiceover,
          model: formModel,
          projectId,
          aspectRatio: formAspectRatio,
          mode: resolvedMode,
          contentTemplate: formContentTemplate,
          ...(resolvedMode === 'ref_to_video' && {
            videoModel: resolvedVideoModel,
            workflowVariant,
            videoMode: resolvedRefVideoMode,
          }),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[Storyboard] AI generation failed:', {
          status: response.status,
          errorData,
        });
        throw new Error(errorData.error || 'Failed to generate storyboard');
      }

      const data = await response.json();
      const voiceoverMap = (data.voiceover_list ?? {}) as Record<
        string,
        string[]
      >;
      const firstLangArr = Object.values(voiceoverMap)[0] as
        | string[]
        | undefined;
      const sceneCount =
        data.mode === 'ref_to_video'
          ? (firstLangArr?.length ?? data.scene_prompts?.length ?? 0)
          : (firstLangArr?.length ?? 0);
      console.log('[Storyboard] Plan generated:', {
        mode: data.mode || 'image_to_video',
        scenes: sceneCount,
        storyboard_id: data.storyboard_id,
      });

      // Set draft state and switch to draft mode for review
      if (data.mode === 'ref_to_video') {
        // Ref plan — store the entire plan object
        const { storyboard_id, mode, model, ...planData } = data;
        setDraftPlan(planData as RefPlan);
        setDraftMode('ref_to_video');

        const variant = getRefWorkflowVariant(planData);
        setDraftVideoModel(
          variant === 'direct_ref_to_video' ? model || formVideoModel : null
        );
      } else {
        setDraftPlan({
          rows: data.rows,
          cols: data.cols,
          grid_image_prompt: data.grid_image_prompt,
          voiceover_list: data.voiceover_list,
          visual_flow: data.visual_flow,
        });
        setDraftMode(
          data.mode === 'quick_video' ? 'quick_video' : 'image_to_video'
        );
        setDraftVideoModel(null);
      }
      setDraftStoryboardId(data.storyboard_id);
      setViewMode('draft');
      setResult(data);
    } catch (err) {
      console.error('[Storyboard] Generate error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
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

      // Then approve and start scene generation
      const approveResponse = await fetch('/api/storyboard/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboardId: draftStoryboardId }),
      });

      if (!approveResponse.ok) {
        const errorData = await approveResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to start scene generation');
      }

      console.log('[Storyboard] Draft approved, scenes generating');

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

    // Clear draft state and regenerate
    setDraftPlan(null);
    setDraftStoryboardId(null);
    setViewMode('create');

    // Trigger regeneration
    handleGenerate();
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
                      {formatDate(sb.created_at)} ({sb.aspect_ratio}){' '}
                      {getStoryboardModeLabel(sb)}
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
              setSelectedStoryboardId(null);
              setViewMode('create');
              setFormVoiceover('');
              setFormAspectRatio('9:16');
              setFormModel('google/gemini-3.1-pro-preview');
              setFormVideoMode('image_to_video');
              setFormVideoModel('klingo3');
              setFormRefVideoMode('narrative');
              setResult(null);
              setError(null);
              setWorkflowStarted(false);
            }}
          >
            <IconPlus className="size-3" />
            New
          </Button>
        </div>

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

      {/* Input Section - Fixed at Bottom (hidden in draft mode) */}
      {viewMode !== 'draft' && (
        <div className="flex-none border-t border-border/50">
          {viewMode === 'view' && selectedStoryboard ? (
            isSelectedStoryboardCinematic ? (
              <div className="px-4 py-2 text-xs text-muted-foreground">
                Cinematic mode — no voiceover script.
              </div>
            ) : (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button className="group w-full flex items-center justify-between px-4 py-2 hover:bg-secondary/20 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Voiceover Script
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-secondary rounded-md">
                        {selectedStoryboard.aspect_ratio}
                      </span>
                      {selectedStoryboard.mode === 'ref_to_video' &&
                        selectedStoryboardRefVariant === 'i2v_from_refs' && (
                          <span className="text-xs px-2 py-0.5 bg-violet-500/10 text-violet-500 rounded-md">
                            I2V
                          </span>
                        )}
                      {selectedStoryboard.mode === 'ref_to_video' &&
                        selectedStoryboardRefVariant !== 'i2v_from_refs' && (
                          <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded-md">
                            Ref
                          </span>
                        )}
                      {selectedStoryboard.mode === 'image_to_video' && (
                        <span className="text-xs px-2 py-0.5 bg-amber-500/10 text-amber-500 rounded-md">
                          I2V Legacy
                        </span>
                      )}
                      {selectedStoryboard.mode === 'quick_video' && (
                        <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-500 rounded-md">
                          Quick
                        </span>
                      )}
                      {selectedStoryboardVideoMode === 'narrative' && (
                        <span className="text-xs px-2 py-0.5 bg-slate-500/10 text-slate-300 rounded-md">
                          Narrative · Audio OFF
                        </span>
                      )}
                      {selectedStoryboardVideoMode === 'dialogue_scene' && (
                        <span className="text-xs px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-md">
                          Cinematic · Audio ON
                        </span>
                      )}
                    </div>
                    <IconChevronDown className="size-3 text-muted-foreground transition-transform duration-200 group-data-[state=open]:hidden" />
                    <IconChevronUp className="size-3 text-muted-foreground hidden group-data-[state=open]:block" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-3">
                    <div className="relative group/vo">
                      <div className="p-2 bg-background/50 rounded-md text-sm max-h-[120px] overflow-y-auto whitespace-pre-wrap">
                        {selectedStoryboard.voiceover || (
                          <span className="text-muted-foreground italic">
                            No voiceover
                          </span>
                        )}
                      </div>
                      {selectedStoryboard.voiceover && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover/vo:opacity-100 transition-opacity"
                          onClick={() => {
                            navigator.clipboard.writeText(
                              selectedStoryboard.voiceover!
                            );
                            toast.success('Copied to clipboard');
                          }}
                        >
                          <IconCopy className="size-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          ) : (
            /* Create Mode - Editable form */
            <div className="p-4 flex flex-col gap-3">
              {/* Voiceover Text Input */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Voiceover Script
                </span>
                <Textarea
                  placeholder="Enter your voiceover script..."
                  className="resize-none text-sm min-h-[80px] max-h-[200px] overflow-y-auto"
                  value={formVoiceover}
                  onChange={(e) => setFormVoiceover(e.target.value)}
                />
              </div>

              {/* Controls Row: Dropdowns */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="secondary" size="sm" className="gap-1">
                        {formAspectRatio}
                        <IconChevronDown className="size-3 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {ASPECT_RATIOS.map((option) => (
                        <DropdownMenuItem
                          key={option.value}
                          onClick={() => setFormAspectRatio(option.value)}
                        >
                          {option.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Mode locked to ref_to_video + Kling O3 */}
                  <span className="h-8 px-3 text-xs border rounded-md flex items-center text-muted-foreground">
                    Ref to Video · Kling O3
                  </span>
                </div>
              </div>

              {(formVideoMode === 'image_to_video' ||
                (formVideoMode === 'ref_to_video' &&
                  (formVideoModel === 'wan26flash' ||
                    formVideoModel === 'klingo3' ||
                    formVideoModel === 'klingo3pro'))) && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Scene Mode
                  </span>
                  <Select
                    value={formRefVideoMode}
                    onValueChange={(value) =>
                      setFormRefVideoMode(value as RefVideoMode)
                    }
                  >
                    <SelectTrigger className="h-8 flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REF_VIDEO_MODE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Generate Button */}
              <Button
                className="h-9 rounded-full text-sm w-full"
                size="sm"
                onClick={handleGenerate}
                disabled={loading || !formVoiceover.trim()}
              >
                {loading ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  'Generate Storyboard'
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
