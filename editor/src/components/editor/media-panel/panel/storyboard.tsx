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
import { useProjectId } from '@/contexts/project-context';
import { useDeleteConfirmation } from '@/contexts/delete-confirmation-context';
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

const VIDEO_MODES = [
  { value: 'image_to_video' as const, label: 'Image to Video' },
  { value: 'ref_to_video' as const, label: 'Ref to Video' },
] as const;

const VIDEO_MODELS = [
  { value: 'klingo3' as const, label: 'Kling O3' },
  { value: 'wan26flash' as const, label: 'WAN 2.6 Flash' },
] as const;

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
    useState<StoryboardMode>('image_to_video');
  const [formVideoModel, setFormVideoModel] = useState<VideoModel>('klingo3');

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

  // Fetch storyboards on mount and when projectId changes
  useEffect(() => {
    if (!projectId) return;

    const loadStoryboards = async () => {
      const data = await getStoryboardsForProject(projectId);
      setStoryboards(data);

      // Auto-select most recent storyboard if exists
      if (data.length > 0) {
        setSelectedStoryboardId(data[0].id);
      }

      // Check for existing draft
      const draft = await getDraftStoryboard(projectId);
      if (draft?.plan) {
        // Restore draft state
        setDraftPlan(draft.plan);
        setDraftStoryboardId(draft.id);
        setDraftMode(draft.mode || 'image_to_video');
        setDraftVideoModel(draft.model || null);
        setViewMode('draft');
        return;
      }

      // Set view mode based on storyboard existence
      if (data.length > 0) {
        setViewMode('view');
      } else {
        setViewMode('create');
      }
    };

    loadStoryboards();
  }, [projectId]);

  const refreshStoryboardsAfterCreate = async () => {
    if (!projectId) return;
    const newStoryboards = await getStoryboardsForProject(projectId);
    setStoryboards(newStoryboards);
    if (newStoryboards.length > 0) {
      setSelectedStoryboardId(newStoryboards[0].id);
      setViewMode('view');
    }
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
      if (updatedStoryboards.length > 0) {
        setSelectedStoryboardId(updatedStoryboards[0].id);
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

      // Generate storyboard with AI and create draft record
      const response = await fetch('/api/storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceoverText: formVoiceover,
          model: formModel,
          projectId,
          aspectRatio: formAspectRatio,
          mode: formVideoMode,
          ...(formVideoMode === 'ref_to_video' && {
            videoModel: formVideoModel,
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
      const sceneCount =
        data.mode === 'ref_to_video'
          ? (data.voiceover_list?.en?.length ?? data.scene_prompts?.length)
          : (data.voiceover_list?.en?.length ?? 0);
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
        setDraftVideoModel(model || formVideoModel);
      } else {
        setDraftPlan({
          rows: data.rows,
          cols: data.cols,
          grid_image_prompt: data.grid_image_prompt,
          voiceover_list: data.voiceover_list,
          visual_flow: data.visual_flow,
        });
        setDraftMode('image_to_video');
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
              setSelectedStoryboardId(value);
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
                  {formatDate(sb.created_at)} ({sb.aspect_ratio})
                  {sb.mode === 'ref_to_video' ? ' [Ref]' : ''}
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
              setResult(null);
              setError(null);
              setWorkflowStarted(false);
            }}
          >
            <IconPlus className="size-3" />
            New
          </Button>
        </div>
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
          />
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
                  : (selectedStoryboard.plan.voiceover_list.en?.length ??
                    0)}{' '}
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
            /* View Mode - Read-only display of saved storyboard settings */
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
                    {selectedStoryboard.mode === 'ref_to_video' && (
                      <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded-md">
                        Ref
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

                  <Select
                    value={formVideoMode}
                    onValueChange={(v) => setFormVideoMode(v as StoryboardMode)}
                  >
                    <SelectTrigger className="h-8 flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VIDEO_MODES.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <Select
                    value={formModel}
                    onValueChange={(v) => setFormModel(v as StoryboardModel)}
                  >
                    <SelectTrigger className="h-8 flex-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STORYBOARD_MODELS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {formVideoMode === 'ref_to_video' && (
                    <Select
                      value={formVideoModel}
                      onValueChange={(v) => setFormVideoModel(v as VideoModel)}
                    >
                      <SelectTrigger className="h-8 w-[130px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIDEO_MODELS.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

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
