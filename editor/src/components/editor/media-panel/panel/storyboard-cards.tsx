'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  IconChevronDown,
  IconChevronUp,
  IconFileText,
  IconLayoutGrid,
  IconLoader2,
  IconMicrophone,
  IconPlayerTrackNext,
  IconSparkles,
  IconVideo,
  IconVolume,
  IconFocusCentered,
  IconArrowBackUp,
  IconVideoOff,
  IconUsers,
  IconAlertTriangle,
  IconPhoto,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import {
  SceneCard,
  VoiceoverPlayButton,
  parseMultiShotPrompt,
} from './scene-card';
import { StatusBadge } from './status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { useWorkflow } from '@/hooks/use-workflow';
import {
  resolveAssetImageUrl,
  useAssetImageResolver,
} from '@/hooks/use-asset-image-resolver';
import { useFalPolling } from '@/hooks/use-fal-polling';
import { useStudioStore } from '@/stores/studio-store';
import { useLanguageStore } from '@/stores/language-store';
import {
  DEFAULT_VOICE_MAP,
  FALLBACK_VOICE,
  type LanguageCode,
} from '@/lib/constants/languages';
import { createClient } from '@/lib/supabase/client';
import {
  addSceneToTimeline,
  addVoiceoverToTimeline,
  findCompatibleTrack,
} from '@/lib/scene-timeline-utils';
import { applyTemplate } from '@/lib/templates/apply-template';
import { getTemplate, TEMPLATE_LIST } from '@/lib/templates';
import { TemplatePicker } from './template-picker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invokeWorkflow(
  route: string,
  body: Record<string, unknown>
): Promise<{ data: any; error: any }> {
  try {
    const res = await fetch(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok)
      return {
        data: null,
        error: new Error(data.error || `Request failed: ${res.status}`),
      };
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}
import type {
  GridImage,
  RefObject,
  Scene,
  Storyboard,
  StoryboardWithScenes,
} from '@/lib/supabase/workflow-service';
import { GridImageReview } from './grid-image-review';
import { RefGridImageReview } from './ref-grid-image-review';
import { useDeleteConfirmation } from '@/contexts/delete-confirmation-context';

function buildScenePromptUpdate(editedPrompt: string): {
  prompt: string | null;
  multi_prompt: string[] | null;
} {
  const parsed = parseMultiShotPrompt(editedPrompt);
  if (parsed) {
    return { prompt: null, multi_prompt: parsed };
  }
  return { prompt: editedPrompt, multi_prompt: null };
}

const VOICES = [
  {
    value: '75SIZa3vvET95PHhf1yD',
    label: 'Ahmet (Turkish)',
    description: 'Deep male voice, Turkish language',
  },
  {
    value: 'NFG5qt843uXKj4pFvR7C',
    label: 'Adam Stone (English)',
    description: 'Late night radio host with a smooth, deep voice',
  },
  {
    value: 'IES4nrmZdUBHByLBde0P',
    label: 'Haytham (Arabic)',
    description: 'Middle aged Arab male voice',
  },
  // {
  //   value: "pNInz6obpgDQGcFmaJgB",
  //   label: "Adam",
  //   description: "American, middle-aged male",
  // },
  // {
  //   value: "Xb7hH8MSUJpSbSDYk0k2",
  //   label: "Alice",
  //   description: "British, middle-aged female",
  // },
  // {
  //   value: "hpp4J3VqNfWAUOO0d1Us",
  //   label: "Bella",
  //   description: "American, middle-aged female",
  // },
  // {
  //   value: "pqHfZKP75CvOlQylNhV4",
  //   label: "Bill",
  //   description: "American, older male",
  // },
  // {
  //   value: "nPczCjzI2devNBz1zQrb",
  //   label: "Brian",
  //   description: "American, middle-aged male",
  // },
  // {
  //   value: "N2lVS1w4EtoT3dr4eOWO",
  //   label: "Callum",
  //   description: "American, middle-aged male",
  // },
  // {
  //   value: "IKne3meq5aSn9XLyUdCD",
  //   label: "Charlie",
  //   description: "Australian, young male",
  // },
  // {
  //   value: "iP95p4xoKVk53GoZ742B",
  //   label: "Chris",
  //   description: "American, middle-aged male",
  // },
  // {
  //   value: "onwK4e9ZLuTAKqWW03F9",
  //   label: "Daniel",
  //   description: "British, middle-aged male",
  // },
  // {
  //   value: "cjVigY5qzO86Huf0OWal",
  //   label: "Eric",
  //   description: "American, middle-aged male",
  // },
  // {
  //   value: "JBFqnCBsd6RMkjVDRZzb",
  //   label: "George",
  //   description: "British, middle-aged male",
  // },
  // {
  //   value: "SOYHLrjzK2X1ezoPC6cr",
  //   label: "Harry",
  //   description: "American, young male",
  // },
  // {
  //   value: "cgSgspJ2msm6clMCkdW9",
  //   label: "Jessica",
  //   description: "American, young female",
  // },
  // {
  //   value: "FGY2WhTYpPnrIDTdsKH5",
  //   label: "Laura",
  //   description: "American, young female",
  // },
  // {
  //   value: "TX3LPaxmHKxFdv7VOQHJ",
  //   label: "Liam",
  //   description: "American, young male",
  // },
  // {
  //   value: "pFZP5JQG7iQjIQuC4Bku",
  //   label: "Lily",
  //   description: "British, middle-aged female",
  // },
  // {
  //   value: "XrExE9yKIg1WjnnlVkGX",
  //   label: "Matilda",
  //   description: "American, middle-aged female",
  // },
  // {
  //   value: "SAz9YHcvj6GT2YYXdXww",
  //   label: "River",
  //   description: "American, middle-aged neutral",
  // },
  // {
  //   value: "CwhRBWXzGAHq8TQ4Fs17",
  //   label: "Roger",
  //   description: "American, middle-aged male",
  // },
  // {
  //   value: "EXAVITQu4vr4xnSDxMaL",
  //   label: "Sarah",
  //   description: "American, young female",
  // },
  // {
  //   value: "bIHbv24MWmeRgasZH58o",
  //   label: "Will",
  //   description: "American, young male",
  // },
] as const;

const TTS_MODELS = {
  'turbo-v2.5': { label: 'Turbo v2.5', description: 'Fast' },
  'multilingual-v2': {
    label: 'Multilingual v2',
    description: 'Better languages',
  },
} as const;

type TTSModelKey = keyof typeof TTS_MODELS;

const OUTPAINT_MODELS = {
  kling: { label: 'Kling' },
  banana: { label: 'Banana' },
  fibo: { label: 'Fibo' },
  grok: { label: 'Grok' },
  'flux-pro': { label: 'Flux Pro' },
} as const;

const FIRST_FRAME_MODELS = {
  grok: { label: 'Grok' },
  kling: { label: 'Kling' },
  banana: { label: 'Banana' },
  fibo: { label: 'Fibo' },
  'flux-pro': { label: 'Flux Pro' },
} as const;

const FIRST_FRAME_ASPECT_RATIOS = {
  '1:1': { label: '1:1' },
  '9:16': { label: '9:16' },
  '16:9': { label: '16:9' },
} as const;

const FIRST_FRAME_RESOLUTIONS = {
  '1k': { label: '1K' },
  '1_5k': { label: '1.5K' },
  '2k': { label: '2K' },
  '3k': { label: '3K' },
  '4k': { label: '4K' },
} as const;

type FirstFrameModelKey = keyof typeof FIRST_FRAME_MODELS;
type FirstFrameAspectRatioKey = keyof typeof FIRST_FRAME_ASPECT_RATIOS;
type FirstFrameResolutionKey = keyof typeof FIRST_FRAME_RESOLUTIONS;

function ScriptViewRow({
  scene,
  playingVoiceoverId,
  setPlayingVoiceoverId,
  onSave,
  selectedLanguage,
}: {
  scene: Scene;
  playingVoiceoverId: string | null;
  setPlayingVoiceoverId: (id: string | null) => void;
  onSave: (sceneId: string, newText: string) => Promise<void>;
  selectedLanguage: LanguageCode;
}) {
  const voiceover =
    scene.voiceovers?.find((v) => v.language === selectedLanguage) ?? null;
  const isPlaying = voiceover ? playingVoiceoverId === voiceover.id : false;
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const handleStartEdit = () => {
    setEditText(voiceover?.text ?? '');
    setIsEditing(true);
  };

  const handleSave = async () => {
    setIsEditing(false);
    const trimmed = editText.trim();
    if (trimmed === (voiceover?.text ?? '').trim()) return;
    await onSave(scene.id, trimmed);
  };

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-secondary/30 transition-colors">
      <span className="text-[10px] font-medium text-muted-foreground w-5 flex-shrink-0 pt-0.5 text-right">
        {scene.order + 1}.
      </span>
      {isEditing ? (
        <Textarea
          autoFocus
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setIsEditing(false);
          }}
          className="text-[11px] min-h-[40px] resize-none p-1.5 bg-background/50 border-blue-400/30 focus-visible:border-blue-400/50 flex-1"
          placeholder="Voiceover text..."
        />
      ) : (
        <p
          className="text-[11px] text-foreground/80 leading-relaxed flex-1 min-w-0 cursor-pointer hover:text-foreground hover:bg-secondary/30 rounded px-1 -mx-1 transition-colors"
          onClick={handleStartEdit}
          title="Click to edit"
        >
          {voiceover?.text || (
            <span className="italic text-muted-foreground">No voiceover</span>
          )}
        </p>
      )}
      <div className="flex-shrink-0 pt-0.5">
        {voiceover?.status === 'processing' && (
          <IconLoader2 size={10} className="animate-spin text-blue-400" />
        )}
        {voiceover?.status === 'success' && voiceover?.audio_url && (
          <VoiceoverPlayButton
            voiceover={voiceover}
            isPlaying={isPlaying}
            onToggle={() =>
              setPlayingVoiceoverId(isPlaying ? null : voiceover.id)
            }
          />
        )}
        {voiceover?.status === 'pending' && (
          <StatusBadge status="pending" size="sm" />
        )}
        {voiceover?.status === 'failed' && (
          <StatusBadge status="failed" size="sm" />
        )}
      </div>
    </div>
  );
}

type TimelineAddMode = 'both' | 'video-only' | 'voiceover-only';

interface StoryboardCardsProps {
  projectId: string;
  storyboardId?: string | null;
  refreshTrigger?: number;
}

export function StoryboardCards({
  projectId,
  storyboardId,
  refreshTrigger,
}: StoryboardCardsProps) {
  const {
    gridImage,
    gridImages,
    storyboard,
    loading,
    error,
    isProcessing,
    isSplitting,
    refresh,
  } = useWorkflow(projectId, {
    realtime: true,
    includeScenes: true,
    storyboardId,
  });

  // Compute broader processing state that includes video/image-edit processing
  const hasAnyProcessing = useMemo(() => {
    if (isProcessing) return true;
    if (!storyboard || !('scenes' in storyboard)) return false;

    const isEditProcessing = (status: string | null | undefined) =>
      status === 'enhancing' ||
      status === 'editing' ||
      status === 'processing' ||
      status === 'outpainting';

    return storyboard.scenes.some(
      (scene) =>
        scene.video_status === 'processing' ||
        scene.sfx_status === 'processing' ||
        scene.voiceovers?.some(
          (voiceover) => voiceover.status === 'processing'
        ) ||
        scene.first_frames?.some((ff) =>
          isEditProcessing(ff.image_edit_status)
        ) ||
        scene.backgrounds?.some((bg) =>
          isEditProcessing(bg.image_edit_status)
        ) ||
        scene.objects?.some((obj) => isEditProcessing(obj.image_edit_status))
    );
  }, [isProcessing, storyboard]);

  // Polling fallback — picks up fal.ai results when webhooks can't reach us
  useFalPolling(hasAnyProcessing, storyboard?.id, refresh);

  const { confirm } = useDeleteConfirmation();
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(
    new Set()
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isOutpainting, setIsOutpainting] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isCustomEditing, setIsCustomEditing] = useState(false);
  const [selectedObjectName, setSelectedObjectName] = useState<string | null>(
    null
  );
  const [objectEditPrompt, setObjectEditPrompt] = useState('');
  const [isEnhancingObject, setIsEnhancingObject] = useState(false);
  const [isCustomEditingObject, setIsCustomEditingObject] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [isRefMode, setIsRefMode] = useState(false);
  const [targetSceneId, setTargetSceneId] = useState<string | null>(null);
  const [refPrompt, setRefPrompt] = useState('');
  const [isRefGenerating, setIsRefGenerating] = useState(false);
  const [outpaintModel, setOutpaintModel] =
    useState<keyof typeof OUTPAINT_MODELS>('kling');
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [isApplyingTemplate, setIsApplyingTemplate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    'documentary'
  );

  const [videoModel, setVideoModel] = useState('klingo3');
  const [firstFrameModel, setFirstFrameModel] =
    useState<FirstFrameModelKey>('grok');
  const [firstFrameAspectRatio, setFirstFrameAspectRatio] =
    useState<FirstFrameAspectRatioKey>('1:1');
  const [firstFrameResolution, setFirstFrameResolution] =
    useState<FirstFrameResolutionKey>('2k');
  const [refVideoModel, setRefVideoModel] = useState<'klingo3' | 'klingo3pro'>(
    'klingo3'
  );
  const [videoResolution, setVideoResolution] = useState<
    '480p' | '720p' | '1080p'
  >('720p');
  const [isGeneratingRefFirstFrames, setIsGeneratingRefFirstFrames] =
    useState(false);
  const [isGeneratingSfx, setIsGeneratingSfx] = useState(false);
  const [isAddingToTimeline, setIsAddingToTimeline] = useState(false);
  const selectedLanguage = useLanguageStore((s) => s.activeLanguage);
  const availableLanguages = useLanguageStore((s) => s.availableLanguages);
  const [voiceConfig, setVoiceConfig] = useState<
    Record<string, { voice: string }>
  >({
    en: { voice: DEFAULT_VOICE_MAP.en ?? FALLBACK_VOICE },
  });
  const [ttsModel, setTtsModel] = useState<TTSModelKey>('turbo-v2.5');
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const voiceConfigSaveTimerRef =
    useRef<ReturnType<typeof setTimeout>>(undefined);
  const [videoVolume, setVideoVolume] = useState(0);
  const [timelineAddMode, setTimelineAddMode] =
    useState<TimelineAddMode>('both');
  const [playingVoiceoverId, setPlayingVoiceoverId] = useState<string | null>(
    null
  );
  const [isScriptViewOpen, setIsScriptViewOpen] = useState(false);
  const [isObjectsViewOpen, setIsObjectsViewOpen] = useState(false);
  const [isAudioOpen, setIsAudioOpen] = useState(false);
  const [isVisualOpen, setIsVisualOpen] = useState(false);
  const [isVideoOpen, setIsVideoOpen] = useState(false);
  const [cardMinWidth, setCardMinWidth] = useState(180);
  const { studio } = useStudioStore();

  // Re-initialize voiceConfig from storyboard plan when storyboard loads
  useEffect(() => {
    if (!storyboard?.plan?.voiceover_list) return;
    const langs = Object.keys(storyboard.plan.voiceover_list);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const savedConfig = (storyboard.plan as any).voice_config as
      | Record<string, { voice?: string; model?: string; speed?: number }>
      | undefined;

    setVoiceConfig(
      Object.fromEntries(
        langs.map((lang) => [
          lang,
          {
            voice:
              savedConfig?.[lang]?.voice ??
              DEFAULT_VOICE_MAP[lang] ??
              FALLBACK_VOICE,
          },
        ])
      )
    );

    // Restore model and speed from the first language that has saved config
    if (savedConfig) {
      const firstConfig = Object.values(savedConfig)[0];
      if (firstConfig?.model && firstConfig.model in TTS_MODELS) {
        setTtsModel(firstConfig.model as TTSModelKey);
      }
      if (
        firstConfig?.speed !== undefined &&
        firstConfig.speed >= 0.7 &&
        firstConfig.speed <= 1.2
      ) {
        setTtsSpeed(firstConfig.speed);
      }
    }
  }, [storyboard?.id]);

  // Ensure voiceConfig has entries for all available languages (e.g. after translation)
  useEffect(() => {
    if (availableLanguages.length === 0) return;
    setVoiceConfig((prev) => {
      const updated = { ...prev };
      let changed = false;
      for (const lang of availableLanguages) {
        if (!updated[lang]) {
          updated[lang] = { voice: DEFAULT_VOICE_MAP[lang] ?? FALLBACK_VOICE };
          changed = true;
        }
      }
      return changed ? updated : prev;
    });
  }, [availableLanguages]);

  // Persist voice config to storyboard plan (debounced)
  const saveVoiceConfig = useCallback(
    (
      config: Record<string, { voice: string }>,
      model: TTSModelKey,
      speed: number
    ) => {
      clearTimeout(voiceConfigSaveTimerRef.current);
      voiceConfigSaveTimerRef.current = setTimeout(async () => {
        if (!storyboard?.id) return;
        const supabase = createClient('studio');
        const voiceConfigPayload: Record<
          string,
          { voice: string; model: string; speed: number }
        > = {};
        for (const [lang, cfg] of Object.entries(config)) {
          voiceConfigPayload[lang] = {
            voice: cfg.voice,
            model,
            speed,
          };
        }
        const { data: sb } = await supabase
          .from('storyboards')
          .select('plan')
          .eq('id', storyboard.id)
          .single();
        if (sb?.plan) {
          await supabase
            .from('storyboards')
            .update({
              plan: {
                ...(sb.plan as Record<string, unknown>),
                voice_config: voiceConfigPayload,
              },
            })
            .eq('id', storyboard.id);
        }
      }, 1000);
    },
    [storyboard?.id]
  );

  // Auto-save when voice/model/speed changes
  useEffect(() => {
    if (!storyboard?.id) return;
    saveVoiceConfig(voiceConfig, ttsModel, ttsSpeed);
  }, [voiceConfig, ttsModel, ttsSpeed, storyboard?.id, saveVoiceConfig]);

  // Refresh data when refreshTrigger changes (new storyboard generated)
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      refresh();
    }
  }, [refreshTrigger, refresh]);

  // Auto-correct resolution — cap at 720p for Kling
  useEffect(() => {
    if (videoResolution === '480p') {
      setVideoResolution('720p');
    }
  }, [videoResolution]);

  const scenes =
    storyboard && 'scenes' in storyboard
      ? (storyboard as StoryboardWithScenes).scenes
      : [];

  const sortedScenes = scenes.sort((a, b) => a.order - b.order);

  const variantIds = useMemo(() => {
    const ids: string[] = [];

    for (const scene of sortedScenes) {
      for (const obj of scene.objects ?? []) {
        if (obj.series_asset_variant_id) {
          ids.push(obj.series_asset_variant_id);
        }
      }

      for (const bg of scene.backgrounds ?? []) {
        if (bg.series_asset_variant_id) {
          ids.push(bg.series_asset_variant_id);
        }
      }
    }

    return ids;
  }, [sortedScenes]);

  const assetImageMap = useAssetImageResolver(variantIds);

  const isRefToVideoMode = storyboard?.mode === 'ref_to_video';
  const isQuickVideoMode = storyboard?.mode === 'quick_video';

  const refWorkflowVariant =
    isRefToVideoMode &&
    storyboard?.plan &&
    'workflow_variant' in storyboard.plan
      ? (storyboard.plan.workflow_variant as
          | 'i2v_from_refs'
          | 'direct_ref_to_video'
          | undefined)
      : undefined;

  const isRefI2VMode =
    isRefToVideoMode && refWorkflowVariant === 'i2v_from_refs';
  const isRefDirectMode = isRefToVideoMode && !isRefI2VMode;

  const refVideoMode =
    isRefToVideoMode && storyboard?.plan && 'video_mode' in storyboard.plan
      ? (storyboard.plan.video_mode as
          | 'narrative'
          | 'dialogue_scene'
          | undefined)
      : undefined;

  const isKlingModel = storyboard?.model?.startsWith('kling') ?? false;

  // DEPRECATED: was blocking TTS in narrative mode (wrong). Use isCinematicMode to block TTS instead.
  const isNarrativeNoAudioMode = false;

  // Dialogue/cinematic mode: Kling generates native audio — no TTS, no voiceover controls
  const isDialogueMode =
    isRefToVideoMode && isKlingModel && refVideoMode === 'dialogue_scene';
  const isCinematicMode = isDialogueMode;

  const processingVideoCount = useMemo(
    () =>
      sortedScenes.filter((scene) => scene.video_status === 'processing')
        .length,
    [sortedScenes]
  );

  const firstFramePromptBySceneId = useMemo(() => {
    const map = new Map<string, string>();
    if (!isRefI2VMode || !storyboard?.plan) return map;

    const prompts =
      'scene_first_frame_prompts' in storyboard.plan
        ? storyboard.plan.scene_first_frame_prompts
        : undefined;

    if (!Array.isArray(prompts)) return map;

    for (const scene of sortedScenes) {
      const prompt = prompts[scene.order];
      if (typeof prompt === 'string' && prompt.trim().length > 0) {
        map.set(scene.id, prompt.trim());
      }
    }

    return map;
  }, [isRefI2VMode, storyboard?.plan, sortedScenes]);

  useEffect(() => {
    if (!isRefToVideoMode) return;

    const sbModel = storyboard?.model;
    if (sbModel === 'klingo3' || sbModel === 'klingo3pro') {
      setRefVideoModel(sbModel);
    }
  }, [isRefToVideoMode, storyboard?.model]);

  useEffect(() => {
    const aspect = storyboard?.aspect_ratio;
    if (
      aspect &&
      (aspect === '1:1' || aspect === '9:16' || aspect === '16:9')
    ) {
      setFirstFrameAspectRatio(aspect);
    }
  }, [storyboard?.aspect_ratio]);

  const splitProgress = useMemo(() => {
    if (!isRefToVideoMode) return null;

    const allObjects = sortedScenes.flatMap((scene) => scene.objects ?? []);
    const allBackgrounds = sortedScenes.flatMap(
      (scene) => scene.backgrounds ?? []
    );

    const countByStatus = (
      items: Array<{ status: 'pending' | 'processing' | 'success' | 'failed' }>
    ) => ({
      total: items.length,
      pending: items.filter((item) => item.status === 'pending').length,
      processing: items.filter((item) => item.status === 'processing').length,
      success: items.filter((item) => item.status === 'success').length,
      failed: items.filter((item) => item.status === 'failed').length,
    });

    const objects = countByStatus(allObjects);
    const backgrounds = countByStatus(allBackgrounds);

    const total = objects.total + backgrounds.total;
    const completed =
      objects.success +
      objects.failed +
      backgrounds.success +
      backgrounds.failed;
    const processing = objects.processing + backgrounds.processing;
    const pending = objects.pending + backgrounds.pending;

    const isActive =
      storyboard?.plan_status === 'splitting' ||
      processing > 0 ||
      (total > 0 && completed < total);

    if (!isActive) return null;

    const progressPercent =
      total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

    let stageLabel = 'Preparing split...';
    if (sortedScenes.length === 0) {
      stageLabel = 'Creating scenes and linking voiceovers...';
    } else if (processing > 0) {
      stageLabel = 'Splitting grid tiles and assigning scene assets...';
    } else if (pending > 0) {
      stageLabel = 'Queuing split asset updates...';
    } else {
      stageLabel = 'Finalizing split results...';
    }

    return {
      progressPercent,
      stageLabel,
      objects,
      backgrounds,
    };
  }, [isRefToVideoMode, sortedScenes, storyboard?.plan_status]);

  const toggleScene = (sceneId: string, selected: boolean) => {
    setSelectedSceneIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(sceneId);
      } else {
        next.delete(sceneId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedSceneIds(new Set(sortedScenes.map((s) => s.id)));
  };

  const clearSelection = () => {
    setSelectedSceneIds(new Set());
  };

  const allSelected =
    sortedScenes.length > 0 && selectedSceneIds.size === sortedScenes.length;

  const handleGenerateVoiceovers = async () => {
    if (selectedSceneIds.size === 0) return;

    setIsGenerating(true);
    try {
      const { data, error } = await invokeWorkflow('/api/workflow/tts', {
        scene_ids: Array.from(selectedSceneIds),
        voice:
          (
            voiceConfig[selectedLanguage] ??
            voiceConfig[Object.keys(voiceConfig)[0]]
          )?.voice ?? FALLBACK_VOICE,
        model: ttsModel,
        language: selectedLanguage,
        speed: ttsSpeed,
      });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.success(
        `Voiceover generation started for ${(data as any).summary.queued} scene(s)`
      );
      clearSelection();
      refresh(); // Fetch updated voiceover statuses to show "Generating..." state
    } catch (err) {
      console.error('Failed to generate voiceovers:', err);
      toast.error('Failed to generate voiceovers');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAllVoiceovers = async () => {
    if (selectedSceneIds.size === 0) return;

    if (isNarrativeNoAudioMode) {
      toast.info(
        'Narrative mode keeps video silent in V1. Switch to Dialogue Scene for TTS.'
      );
      return;
    }

    setIsGeneratingAll(true);
    try {
      const languages = Object.keys(voiceConfig);
      const sceneIds = Array.from(selectedSceneIds);

      const results = await Promise.allSettled(
        languages.map((lang) =>
          invokeWorkflow('/api/workflow/tts', {
            scene_ids: sceneIds,
            voice: voiceConfig[lang].voice,
            model: ttsModel,
            language: lang,
            speed: ttsSpeed,
          })
        )
      );

      let totalQueued = 0;
      let failures = 0;
      for (const result of results) {
        if (result.status === 'fulfilled' && !result.value.error) {
          totalQueued += result.value.data?.summary?.queued ?? 0;
        } else {
          failures++;
        }
      }

      if (totalQueued > 0) {
        toast.success(
          `Voiceover generation started for ${totalQueued} scene(s) across ${languages.length - failures} language(s)`
        );
      }
      if (failures > 0) {
        toast.error(`${failures} language(s) failed to start`);
      }
      clearSelection();
      refresh();
    } catch (err) {
      console.error('Failed to generate all voiceovers:', err);
      toast.error('Failed to generate voiceovers for all languages');
    } finally {
      setIsGeneratingAll(false);
    }
  };

  const handleOutpaintImages = async () => {
    if (selectedSceneIds.size === 0) return;

    setIsOutpainting(true);
    try {
      const { data, error } = await invokeWorkflow('/api/workflow/edit-image', {
        scene_ids: Array.from(selectedSceneIds),
        model: outpaintModel,
      });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const summary = (data as any).summary;
      if (summary.queued > 0) {
        toast.success(`Image outpaint started for ${summary.queued} scene(s)`);
      }
      if (summary.skipped > 0) {
        toast.warning(
          `${summary.skipped} scene(s) skipped (already processing)`
        );
      }
      if (summary.failed > 0) {
        toast.error(
          `${summary.failed} scene(s) failed to submit for outpainting`
        );
      }
      clearSelection();
      refresh(); // Fetch updated outpaint statuses
    } catch (err) {
      console.error('Failed to outpaint images:', err);
      toast.error('Failed to outpaint images');
    } finally {
      setIsOutpainting(false);
    }
  };

  const handleEnhanceImages = async () => {
    if (selectedSceneIds.size === 0) return;

    setIsEnhancing(true);
    try {
      const { data, error } = await invokeWorkflow('/api/workflow/edit-image', {
        scene_ids: Array.from(selectedSceneIds),
        model: outpaintModel,
        action: 'enhance',
      });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const summary = (data as any).summary;
      if (summary.queued > 0) {
        toast.success(`Image enhance started for ${summary.queued} scene(s)`);
      }
      if (summary.skipped > 0) {
        toast.warning(
          `${summary.skipped} scene(s) skipped (already processing or no final image)`
        );
      }
      if (summary.failed > 0) {
        toast.error(
          `${summary.failed} scene(s) failed to submit for enhancing`
        );
      }
      clearSelection();
      refresh();
    } catch (err) {
      console.error('Failed to enhance images:', err);
      toast.error('Failed to enhance images');
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleCustomEdit = async () => {
    if (selectedSceneIds.size === 0 || !editPrompt.trim()) return;

    setIsCustomEditing(true);
    try {
      const { data, error } = await invokeWorkflow('/api/workflow/edit-image', {
        scene_ids: Array.from(selectedSceneIds),
        model: outpaintModel,
        action: 'custom_edit',
        prompt: editPrompt.trim(),
      });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const summary = (data as any).summary;
      if (summary.queued > 0) {
        toast.success(`Custom edit started for ${summary.queued} scene(s)`);
      }
      if (summary.skipped > 0) {
        toast.warning(
          `${summary.skipped} scene(s) skipped (already processing or no final image)`
        );
      }
      if (summary.failed > 0) {
        toast.error(`${summary.failed} scene(s) failed to submit for editing`);
      }
      clearSelection();
      refresh();
    } catch (err) {
      console.error('Failed to custom edit images:', err);
      toast.error('Failed to custom edit images');
    } finally {
      setIsCustomEditing(false);
    }
  };

  const handleRefToImage = async () => {
    if (selectedSceneIds.size === 0 || !targetSceneId || !refPrompt.trim())
      return;

    setIsRefGenerating(true);
    try {
      const { data, error } = await invokeWorkflow('/api/workflow/edit-image', {
        scene_ids: Array.from(selectedSceneIds),
        model: outpaintModel,
        action: 'ref_to_image',
        prompt: refPrompt.trim(),
        target_scene_id: targetSceneId,
      });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = data as any;
      if (d.success) {
        toast.success(
          `Reference-to-image started (${d.reference_count} references)`
        );
      } else {
        toast.error(d.error || 'Failed to start ref-to-image');
      }
      clearSelection();
      setTargetSceneId(null);
      setIsRefMode(false);
      refresh();
    } catch (err) {
      console.error('Failed ref-to-image:', err);
      toast.error('Failed to start ref-to-image');
    } finally {
      setIsRefGenerating(false);
    }
  };

  const handleResetImages = async () => {
    if (selectedSceneIds.size === 0) return;

    const confirmed = await confirm({
      title: 'Reset Images',
      description:
        "Reset selected scenes' images back to the original padded version? This will undo any outpainting, enhancing, or custom edits.",
    });

    if (!confirmed) return;

    try {
      const supabase = createClient('studio');
      const firstFrames = sortedScenes
        .filter((s) => selectedSceneIds.has(s.id))
        .flatMap((s) => s.first_frames)
        .filter((ff) => ff.out_padded_url);

      for (const ff of firstFrames) {
        await supabase
          .from('first_frames')
          .update({
            final_url: ff.out_padded_url,
            outpainted_url: null,
            image_edit_status: null,
            image_edit_error_message: null,
            image_edit_request_id: null,
          })
          .eq('id', ff.id);
      }

      toast.success(`Reset ${firstFrames.length} image(s) to original`);
      clearSelection();
      refresh();
    } catch (err) {
      console.error('Failed to reset images:', err);
      toast.error('Failed to reset images');
    }
  };

  const handleEnhanceBackgroundImages = async () => {
    if (selectedSceneIds.size === 0) return;

    setIsEnhancing(true);
    try {
      const { data, error } = await invokeWorkflow('/api/workflow/edit-image', {
        scene_ids: Array.from(selectedSceneIds),
        model: outpaintModel,
        action: 'enhance',
        source: 'background',
      });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const summary = (data as any).summary;
      if (summary.queued > 0) {
        toast.success(
          `Background enhance started for ${summary.queued} scene(s)`
        );
      }
      if (summary.skipped > 0) {
        toast.warning(
          `${summary.skipped} scene(s) skipped (already processing or no final image)`
        );
      }
      if (summary.failed > 0) {
        toast.error(
          `${summary.failed} scene(s) failed to submit for enhancing`
        );
      }
      clearSelection();
      refresh();
    } catch (err) {
      console.error('Failed to enhance background images:', err);
      toast.error('Failed to enhance background images');
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleCustomEditBackgrounds = async () => {
    if (selectedSceneIds.size === 0 || !editPrompt.trim()) return;

    setIsCustomEditing(true);
    try {
      const { data, error } = await invokeWorkflow('/api/workflow/edit-image', {
        scene_ids: Array.from(selectedSceneIds),
        model: outpaintModel,
        action: 'custom_edit',
        prompt: editPrompt.trim(),
        source: 'background',
      });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const summary = (data as any).summary;
      if (summary.queued > 0) {
        toast.success(
          `Custom edit started for ${summary.queued} background(s)`
        );
      }
      if (summary.skipped > 0) {
        toast.warning(
          `${summary.skipped} scene(s) skipped (already processing or no final image)`
        );
      }
      if (summary.failed > 0) {
        toast.error(`${summary.failed} scene(s) failed to submit for editing`);
      }
      clearSelection();
      refresh();
    } catch (err) {
      console.error('Failed to custom edit backgrounds:', err);
      toast.error('Failed to custom edit backgrounds');
    } finally {
      setIsCustomEditing(false);
    }
  };

  const handleResetBackgroundImages = async () => {
    if (selectedSceneIds.size === 0) return;

    const confirmed = await confirm({
      title: 'Reset Background Images',
      description:
        "Reset selected scenes' background images back to the original version? This will undo any enhancing or custom edits.",
    });

    if (!confirmed) return;

    try {
      const supabase = createClient('studio');
      const backgrounds = sortedScenes
        .filter((s) => selectedSceneIds.has(s.id))
        .flatMap((s) => s.backgrounds ?? [])
        .filter((bg) => bg.url);

      for (const bg of backgrounds) {
        await supabase
          .from('backgrounds')
          .update({
            final_url: bg.url,
            image_edit_status: null,
            image_edit_error_message: null,
            image_edit_request_id: null,
          })
          .eq('id', bg.id);
      }

      toast.success(
        `Reset ${backgrounds.length} background image(s) to original`
      );
      clearSelection();
      refresh();
    } catch (err) {
      console.error('Failed to reset background images:', err);
      toast.error('Failed to reset background images');
    }
  };

  const handleEnhanceObject = async (objectName: string) => {
    // Find one object with that name that has final_url
    const obj = sortedScenes
      .flatMap((s) => s.objects ?? [])
      .find((o) => o.name === objectName && o.final_url);
    if (!obj) {
      toast.warning(`No image found for "${objectName}"`);
      return;
    }

    setIsEnhancingObject(true);
    try {
      const sceneIds = sortedScenes
        .filter((s) => (s.objects ?? []).some((o) => o.name === objectName))
        .map((s) => s.id);
      const { data, error } = await invokeWorkflow('/api/workflow/edit-image', {
        scene_ids: sceneIds,
        object_ids: [obj.id],
        model: outpaintModel,
        action: 'enhance',
        source: 'object',
      });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const summary = (data as any).summary;
      if (summary.queued > 0) {
        toast.success(`Enhance started for "${objectName}"`);
      }
      if (summary.skipped > 0) {
        toast.warning(`"${objectName}" skipped (already processing)`);
      }
      refresh();
    } catch (err) {
      console.error('Failed to enhance object:', err);
      toast.error('Failed to enhance object');
    } finally {
      setIsEnhancingObject(false);
    }
  };

  const handleCustomEditObject = async (objectName: string, prompt: string) => {
    if (!prompt.trim()) return;

    const obj = sortedScenes
      .flatMap((s) => s.objects ?? [])
      .find((o) => o.name === objectName && o.final_url);
    if (!obj) {
      toast.warning(`No image found for "${objectName}"`);
      return;
    }

    setIsCustomEditingObject(true);
    try {
      const sceneIds = sortedScenes
        .filter((s) => (s.objects ?? []).some((o) => o.name === objectName))
        .map((s) => s.id);
      const { data, error } = await invokeWorkflow('/api/workflow/edit-image', {
        scene_ids: sceneIds,
        object_ids: [obj.id],
        model: outpaintModel,
        action: 'custom_edit',
        prompt: prompt.trim(),
        source: 'object',
      });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const summary = (data as any).summary;
      if (summary.queued > 0) {
        toast.success(`Custom edit started for "${objectName}"`);
      }
      if (summary.skipped > 0) {
        toast.warning(`"${objectName}" skipped (already processing)`);
      }
      refresh();
    } catch (err) {
      console.error('Failed to custom edit object:', err);
      toast.error('Failed to custom edit object');
    } finally {
      setIsCustomEditingObject(false);
    }
  };

  const handleResetObject = async (objectName: string) => {
    const confirmed = await confirm({
      title: 'Reset Object',
      description: `Reset "${objectName}" back to the original image? This will undo any enhancing or custom edits across all scenes.`,
    });

    if (!confirmed) return;

    try {
      const supabase = createClient('studio');
      const objects = sortedScenes
        .flatMap((s) => s.objects ?? [])
        .filter((o) => o.name === objectName && o.url);

      for (const obj of objects) {
        await supabase
          .from('objects')
          .update({
            final_url: obj.url,
            image_edit_status: null,
            image_edit_error_message: null,
            image_edit_request_id: null,
          })
          .eq('id', obj.id);
      }

      toast.success(
        `Reset "${objectName}" to original (${objects.length} instance(s))`
      );
      setSelectedObjectName(null);
      refresh();
    } catch (err) {
      console.error('Failed to reset object:', err);
      toast.error('Failed to reset object');
    }
  };

  // Build map of all available backgrounds keyed by grid_position (ref_to_video only)
  const availableBackgrounds = useMemo(() => {
    if (!isRefToVideoMode)
      return new Map<
        number,
        {
          name: string;
          url: string;
          final_url: string;
          series_asset_variant_id?: string | null;
        }
      >();
    const map = new Map<
      number,
      {
        name: string;
        url: string;
        final_url: string;
        series_asset_variant_id?: string | null;
      }
    >();
    for (const scene of sortedScenes) {
      for (const bg of scene.backgrounds ?? []) {
        const resolvedBgUrl = resolveAssetImageUrl(bg, assetImageMap);

        if (
          bg.grid_position != null &&
          resolvedBgUrl &&
          !map.has(bg.grid_position)
        ) {
          map.set(bg.grid_position, {
            name: bg.name,
            url: bg.url ?? resolvedBgUrl,
            final_url: resolvedBgUrl,
            series_asset_variant_id: bg.series_asset_variant_id ?? null,
          });
        }
      }
    }
    return map;
  }, [assetImageMap, isRefToVideoMode, sortedScenes]);

  const handleChangeBackground = async (
    sceneId: string,
    newGridPosition: number
  ) => {
    const source = availableBackgrounds.get(newGridPosition);
    if (!source) return;

    try {
      const supabase = createClient('studio');
      const scene = sortedScenes.find((s) => s.id === sceneId);
      const bg = scene?.backgrounds?.[0];
      if (!bg) return;

      const { error } = await supabase
        .from('backgrounds')
        .update({
          grid_position: newGridPosition,
          name: source.name,
          url: source.url,
          final_url: source.final_url,
          series_asset_variant_id: source.series_asset_variant_id ?? null,
          image_edit_status: null,
          image_edit_error_message: null,
          image_edit_request_id: null,
        })
        .eq('id', bg.id);

      if (error) throw error;

      toast.success(`Background changed to "${source.name}"`);
      refresh();
    } catch (err) {
      console.error('Failed to change background:', err);
      toast.error('Failed to change background');
    }
  };

  const handleGenerateRefFirstFrames = async () => {
    if (!isRefI2VMode || selectedSceneIds.size === 0) return;

    setIsGeneratingRefFirstFrames(true);
    try {
      const { data, error } = await invokeWorkflow(
        '/api/workflow/ref-first-frame',
        {
          scene_ids: Array.from(selectedSceneIds),
          model: firstFrameModel,
          aspect_ratio: firstFrameAspectRatio,
          resolution: firstFrameResolution,
        }
      );

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.success(
        `First-frame generation started for ${(data as any).summary.queued} scene(s)`
      );
      refresh();
    } catch (err) {
      console.error('Failed to generate first frames from refs:', err);
      toast.error('Failed to generate first frames');
    } finally {
      setIsGeneratingRefFirstFrames(false);
    }
  };

  const handleGenerateVideoFromFirstFrame = async () => {
    if (!isRefI2VMode || selectedSceneIds.size === 0) return;

    setIsGeneratingVideo(true);
    try {
      const { data, error } = await invokeWorkflow('/api/workflow/video', {
        scene_ids: Array.from(selectedSceneIds),
        resolution: videoResolution,
        model: videoModel,
        generation_path: 'i2v',
        aspect_ratio:
          storyboard && 'aspect_ratio' in storyboard
            ? storyboard.aspect_ratio
            : '16:9',
        ...(storyboard?.mode === 'ref_to_video' && {
          storyboard_id: storyboard.id,
        }),
      });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.success(
        `First-frame video generation started for ${(data as any).summary.queued} scene(s)`
      );
      clearSelection();
      refresh();
    } catch (err) {
      console.error('Failed to generate videos from first frames:', err);
      toast.error('Failed to generate videos from first frames');
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  const handleUpdateShotDurations = useCallback(
    async (sceneId: string, durations: Array<{ duration: string }>) => {
      const supabase = createClient('studio');
      const { error } = await supabase
        .from('scenes')
        .update({ multi_shots: durations })
        .eq('id', sceneId);

      if (error) {
        toast.error('Failed to update duration');
        return;
      }

      // Update local state immediately
      refresh();
    },
    [refresh]
  );

  const handleGenerateVideo = async () => {
    if (selectedSceneIds.size === 0) return;

    const selectedScenes = sortedScenes.filter((s) =>
      selectedSceneIds.has(s.id)
    );

    let fallbackDuration: number | undefined;

    const shouldSkipMissingVoiceoverCheck =
      // Kling dialogue mode generates native audio — no voiceover expected
      isKlingModel && refVideoMode === 'dialogue_scene';

    if (!shouldSkipMissingVoiceoverCheck) {
      // Check for scenes without voiceover audio
      const scenesWithoutVoiceover = selectedScenes.filter((s) => {
        const maxDuration = Math.max(
          ...(s.voiceovers || []).map((v) => v.duration ?? 0),
          0
        );
        return maxDuration === 0;
      });

      if (scenesWithoutVoiceover.length > 0) {
        const sceneLabels = scenesWithoutVoiceover
          .map((s) => `Scene ${s.order + 1}`)
          .join(', ');
        const confirmed = await confirm({
          title: 'Missing Voiceover Audio',
          description: `${sceneLabels} ${scenesWithoutVoiceover.length === 1 ? 'has' : 'have'} no voiceover audio. Video duration will default to 3 seconds for ${scenesWithoutVoiceover.length === 1 ? 'this scene' : 'these scenes'}. Continue?`,
          confirmLabel: 'Continue',
        });
        if (!confirmed) return;
        fallbackDuration = 3;
      }
    }

    setIsGeneratingVideo(true);
    try {
      const isRefStoryboard = storyboard?.mode === 'ref_to_video';

      const { data, error } = isRefStoryboard
        ? await invokeWorkflow(
            `/api/v2/storyboard/${storyboard?.id}/generate-video`,
            {
              scene_ids: Array.from(selectedSceneIds),
              audio: isCinematicMode,
              confirm: true,
            }
          )
        : await invokeWorkflow('/api/workflow/video', {
            scene_ids: Array.from(selectedSceneIds),
            resolution: videoResolution,
            model: videoModel,
            aspect_ratio:
              storyboard && 'aspect_ratio' in storyboard
                ? storyboard.aspect_ratio
                : '16:9',
            ...(fallbackDuration && { fallback_duration: fallbackDuration }),
            ...(storyboard?.mode === 'ref_to_video' && {
              storyboard_id: storyboard.id,
            }),
          });

      if (error) throw error;

      const queued = isRefStoryboard
        ? ((data as any).jobs ?? []).filter((j: any) => j.status === 'queued')
            .length
        : (data as any).summary?.queued;

      toast.success(`Video generation started for ${queued ?? 0} scene(s)`);
      clearSelection();
      refresh(); // Fetch updated video statuses
    } catch (err) {
      console.error('Failed to generate videos:', err);
      toast.error('Failed to generate videos');
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  const handleRemoveVideos = async () => {
    if (selectedScenesWithVideo.length === 0) return;

    const confirmed = await confirm({
      title: 'Remove Videos',
      description:
        'Remove generated videos from the selected scenes? The images will remain intact.',
    });

    if (!confirmed) return;

    try {
      const supabase = createClient('studio');

      for (const scene of selectedScenesWithVideo) {
        await supabase
          .from('scenes')
          .update({
            video_url: null,
            video_status: null,
            video_request_id: null,
            video_error_message: null,
            video_resolution: null,
          })
          .eq('id', scene.id);
      }

      toast.success(
        `Removed video from ${selectedScenesWithVideo.length} scene(s)`
      );
      clearSelection();
      refresh();
    } catch (err) {
      console.error('Failed to remove videos:', err);
      toast.error('Failed to remove videos');
    }
  };

  const handleGenerateSfx = async () => {
    if (selectedSceneIds.size === 0) return;

    setIsGeneratingSfx(true);
    try {
      const { data, error } = await invokeWorkflow('/api/workflow/sfx', {
        scene_ids: Array.from(selectedSceneIds),
      });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.success(
        `SFX generation started for ${(data as any).summary.queued} scene(s)`
      );
      clearSelection();
      refresh();
    } catch (err) {
      console.error('Failed to generate SFX:', err);
      toast.error('Failed to generate SFX');
    } finally {
      setIsGeneratingSfx(false);
    }
  };

  // Check if any selected scenes have videos ready (for SFX and timeline)
  const selectedScenesWithVideoForSfx = sortedScenes.filter(
    (s) =>
      selectedSceneIds.has(s.id) && s.video_status === 'success' && s.video_url
  );

  // Check if any selected scenes have videos ready
  const selectedScenesWithVideo = sortedScenes.filter(
    (s) =>
      selectedSceneIds.has(s.id) && s.video_status === 'success' && s.video_url
  );

  // Check if any selected scenes have voiceovers ready
  const selectedScenesWithVoiceover = sortedScenes.filter((s) => {
    if (!selectedSceneIds.has(s.id)) return false;
    const vo = s.voiceovers?.find((v) => v.language === selectedLanguage);
    return vo?.status === 'success' && vo?.audio_url;
  });

  const handleSaveVoiceoverText = async (sceneId: string, newText: string) => {
    const scene = sortedScenes.find((s) => s.id === sceneId);
    const voiceover = scene?.voiceovers?.find(
      (v) => v.language === selectedLanguage
    );
    if (!voiceover) return;
    const supabase = createClient('studio');
    const { error } = await supabase
      .from('voiceovers')
      .update({ text: newText })
      .eq('id', voiceover.id);

    if (error) {
      console.error('Failed to save voiceover text:', error);
      toast.error('Failed to save voiceover text');
      throw error;
    }
    refresh();
  };

  const handleSaveVisualPrompt = async (sceneId: string, newPrompt: string) => {
    const supabase = createClient('studio');
    const isRef = storyboard?.mode === 'ref_to_video';

    if (isRef && isRefI2VMode) {
      const scene = sortedScenes.find((s) => s.id === sceneId);
      const sceneOrder = scene?.order;

      if (sceneOrder == null || !storyboard?.id) {
        toast.error('Failed to resolve scene prompt index');
        return;
      }

      const { data: latestStoryboard, error: latestStoryboardError } =
        await supabase
          .from('storyboards')
          .select('plan')
          .eq('id', storyboard.id)
          .single();

      if (latestStoryboardError) {
        console.error(
          'Failed to fetch latest storyboard plan:',
          latestStoryboardError
        );
        toast.error('Failed to save first-frame prompt');
        throw latestStoryboardError;
      }

      const latestPlan =
        latestStoryboard?.plan && typeof latestStoryboard.plan === 'object'
          ? (latestStoryboard.plan as Record<string, unknown>)
          : ((storyboard.plan ?? {}) as unknown as Record<string, unknown>);

      const existingPrompts = latestPlan.scene_first_frame_prompts;
      const promptList = Array.isArray(existingPrompts)
        ? existingPrompts.map((value) =>
            typeof value === 'string' ? value : ''
          )
        : Array.from({ length: sortedScenes.length }, () => '');
      promptList[sceneOrder] = newPrompt.trim();

      const updatedPlan = {
        ...latestPlan,
        scene_first_frame_prompts: promptList,
      };

      const { error: planError } = await supabase
        .from('storyboards')
        .update({ plan: updatedPlan })
        .eq('id', storyboard.id);

      if (planError) {
        console.error('Failed to save first-frame prompt in plan:', planError);
        toast.error('Failed to save first-frame prompt');
        throw planError;
      }

      const promptUpdate = buildScenePromptUpdate(newPrompt);
      const { error: scenePromptError } = await supabase
        .from('scenes')
        .update(promptUpdate)
        .eq('id', sceneId);

      if (scenePromptError) {
        console.error('Failed to save scene prompt:', scenePromptError);
        toast.error('Failed to save scene prompt');
        throw scenePromptError;
      }

      const { error: framePromptError } = await supabase
        .from('first_frames')
        .update({ visual_prompt: newPrompt })
        .eq('scene_id', sceneId);

      if (framePromptError) {
        console.error(
          'Failed to save first-frame prompt on first_frames:',
          framePromptError
        );
      }
    } else if (isRef) {
      const promptUpdate = buildScenePromptUpdate(newPrompt);
      const { error } = await supabase
        .from('scenes')
        .update(promptUpdate)
        .eq('id', sceneId);

      if (error) {
        console.error('Failed to save scene prompt:', error);
        toast.error('Failed to save scene prompt');
        throw error;
      }
    } else {
      const { error } = await supabase
        .from('first_frames')
        .update({ visual_prompt: newPrompt })
        .eq('scene_id', sceneId);

      if (error) {
        console.error('Failed to save visual prompt:', error);
        toast.error('Failed to save visual prompt');
        throw error;
      }
    }

    await refresh();
  };

  const handleReadScene = async (sceneId: string, newVoiceoverText: string) => {
    if (isNarrativeNoAudioMode) {
      toast.info('Narrative mode keeps video silent in V1.');
      return;
    }

    const supabase = createClient('studio');
    const scene = sortedScenes.find((s) => s.id === sceneId);
    const voiceover = scene?.voiceovers?.find(
      (v) => v.language === selectedLanguage
    );
    if (!voiceover) return;

    const { error: voiceoverError } = await supabase
      .from('voiceovers')
      .update({
        text: newVoiceoverText,
        status: 'pending',
        audio_url: null,
        duration: null,
      })
      .eq('id', voiceover.id);

    if (voiceoverError) {
      toast.error('Failed to update voiceover text');
      throw voiceoverError;
    }

    const { error: ttsError } = await invokeWorkflow('/api/workflow/tts', {
      scene_ids: [sceneId],
      voice:
        (
          voiceConfig[selectedLanguage] ??
          voiceConfig[Object.keys(voiceConfig)[0]]
        )?.voice ?? FALLBACK_VOICE,
      model: ttsModel,
      language: selectedLanguage,
      speed: ttsSpeed,
    });

    if (ttsError) {
      console.error('TTS generation failed:', ttsError);
      toast.error('Failed to start voiceover generation');
    } else {
      toast.success('Voiceover generation started');
    }

    refresh();
  };

  const handleTranslateSceneVoiceover = async (
    sceneId: string,
    sourceText: string
  ) => {
    if (!sourceText.trim()) {
      toast.error('No voiceover text to translate');
      return;
    }

    const targetLanguages = availableLanguages.filter(
      (l) => l !== selectedLanguage
    );
    if (targetLanguages.length === 0) {
      toast.info('No other languages configured');
      return;
    }

    const res = await fetch('/api/translate-scene-voiceover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scene_id: sceneId,
        source_text: sourceText,
        source_language: selectedLanguage,
        target_languages: targetLanguages,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      toast.error(data.error ?? 'Translation failed');
      return;
    }

    const translatedCount = data.translated?.length ?? 0;
    const failedCount = data.failed?.length ?? 0;

    if (failedCount > 0 && translatedCount > 0) {
      toast.warning(
        `Translated to ${translatedCount} language(s), ${failedCount} failed`
      );
    } else if (translatedCount > 0) {
      toast.success(`Translated to ${translatedCount} language(s)`);
    } else {
      toast.error('Translation failed for all languages');
    }

    refresh();
  };

  const handleReadSceneAllLanguages = async (
    sceneId: string,
    currentText: string
  ) => {
    if (isNarrativeNoAudioMode) {
      toast.info('Narrative mode keeps video silent in V1.');
      return;
    }

    const supabase = createClient('studio');
    const scene = sortedScenes.find((s) => s.id === sceneId);
    if (!scene) return;

    // Save current language voiceover text first
    const currentVoiceover = scene.voiceovers?.find(
      (v) => v.language === selectedLanguage
    );
    if (currentVoiceover) {
      await supabase
        .from('voiceovers')
        .update({
          text: currentText,
          status: 'pending',
          audio_url: null,
          duration: null,
        })
        .eq('id', currentVoiceover.id);
    }

    // Find all languages with voiceover text for this scene
    const voiceoversWithText = (scene.voiceovers ?? []).filter(
      (v) => v.text?.trim() && v.language !== selectedLanguage
    );

    // Include current language if it has text
    const allLanguages = currentVoiceover
      ? [selectedLanguage, ...voiceoversWithText.map((v) => v.language)]
      : voiceoversWithText.map((v) => v.language);

    if (allLanguages.length === 0) {
      toast.info('No languages with voiceover text');
      return;
    }

    // Set non-current voiceovers to pending and clear audio
    for (const vo of voiceoversWithText) {
      await supabase
        .from('voiceovers')
        .update({ status: 'pending', audio_url: null, duration: null })
        .eq('id', vo.id);
    }

    // Fire TTS for all languages in parallel
    const results = await Promise.allSettled(
      allLanguages.map((lang) =>
        invokeWorkflow('/api/workflow/tts', {
          scene_ids: [sceneId],
          voice: voiceConfig[lang]?.voice ?? FALLBACK_VOICE,
          model: ttsModel,
          language: lang,
          speed: ttsSpeed,
        })
      )
    );

    let successes = 0;
    let failures = 0;
    for (const result of results) {
      if (result.status === 'fulfilled' && !result.value.error) {
        successes++;
      } else {
        failures++;
      }
    }

    if (successes > 0) {
      toast.success(
        `Voiceover generation started for ${successes} language(s)`
      );
    }
    if (failures > 0) {
      toast.error(`${failures} language(s) failed to start`);
    }

    refresh();
  };

  const handleGenerateSceneVideo = async (
    sceneId: string,
    newVisualPrompt: string
  ) => {
    const supabase = createClient('studio');
    const scene = sortedScenes.find((s) => s.id === sceneId);
    const isRef = storyboard?.mode === 'ref_to_video';
    const useFirstFrameI2V = isRef && isRefI2VMode;

    // For i2v paths, require a final first frame image
    if (!isRef || useFirstFrameI2V) {
      const finalUrl = scene?.first_frames?.[0]?.final_url;
      if (!finalUrl) {
        toast.error('Cannot generate video — generate first frames first.');
        return;
      }

      // Update visual prompt on first_frames
      const { error: promptError } = await supabase
        .from('first_frames')
        .update({ visual_prompt: newVisualPrompt })
        .eq('scene_id', sceneId);

      if (promptError) {
        toast.error('Failed to update visual prompt');
        throw promptError;
      }
    } else {
      // Direct ref mode: update scene prompt
      const promptUpdate = buildScenePromptUpdate(newVisualPrompt);
      const { error: promptError } = await supabase
        .from('scenes')
        .update(promptUpdate)
        .eq('id', sceneId);

      if (promptError) {
        toast.error('Failed to update scene prompt');
        throw promptError;
      }
    }

    // Set video status to processing immediately so UI shows spinner
    const { error: resetError } = await supabase
      .from('scenes')
      .update({
        video_status: 'processing',
        video_url: null,
        video_request_id: null,
        video_error_message: null,
      })
      .eq('id', sceneId);

    if (resetError) {
      toast.error('Failed to reset video status');
      throw resetError;
    }

    const { error: videoError } = useFirstFrameI2V
      ? await invokeWorkflow('/api/workflow/video', {
          scene_ids: [sceneId],
          resolution: videoResolution,
          model: videoModel,
          generation_path: 'i2v',
          aspect_ratio:
            storyboard && 'aspect_ratio' in storyboard
              ? storyboard.aspect_ratio
              : '16:9',
          ...(isRef && { storyboard_id: storyboard?.id }),
        })
      : isRef
        ? await invokeWorkflow(
            `/api/v2/storyboard/${storyboard?.id}/generate-video`,
            {
              scene_ids: [sceneId],
              audio: isCinematicMode,
              confirm: true,
            }
          )
        : await invokeWorkflow('/api/workflow/video', {
            scene_ids: [sceneId],
            resolution: videoResolution,
            model: videoModel,
            aspect_ratio:
              storyboard && 'aspect_ratio' in storyboard
                ? storyboard.aspect_ratio
                : '16:9',
          });

    if (videoError) {
      console.error('Video generation failed:', videoError);
      toast.error('Failed to start video generation');
    } else {
      toast.success('Video generation started');
    }

    refresh();
  };

  const handleAddAllToTimeline = async () => {
    if (!studio) return;

    // Pick the right source list based on mode
    const scenesToAdd =
      timelineAddMode === 'voiceover-only'
        ? [...selectedScenesWithVoiceover].sort((a, b) => a.order - b.order)
        : [...selectedScenesWithVideo].sort((a, b) => a.order - b.order);

    if (scenesToAdd.length === 0) return;

    setIsAddingToTimeline(true);
    try {
      let runningEnd = 0;
      let videoTrackId: string | undefined;
      let audioTrackId: string | undefined;

      const failedScenes: number[] = [];
      for (const scene of scenesToAdd) {
        try {
          const voiceover = scene.voiceovers?.find(
            (v) => v.language === selectedLanguage
          );
          const hasVoiceover =
            voiceover?.status === 'success' && voiceover?.audio_url;

          if (timelineAddMode === 'voiceover-only') {
            if (!hasVoiceover) continue;
            const result = await addVoiceoverToTimeline(
              studio,
              { audioUrl: voiceover!.audio_url!, voiceoverId: voiceover!.id },
              { startTime: runningEnd, audioTrackId }
            );
            runningEnd = result.endTime;
            audioTrackId = result.audioTrackId;
          } else {
            const result = await addSceneToTimeline(
              studio,
              {
                videoUrl: scene.video_url!,
                voiceover: hasVoiceover
                  ? {
                      audioUrl: voiceover!.audio_url!,
                      voiceoverId: voiceover!.id,
                    }
                  : null,
              },
              {
                startTime: runningEnd,
                videoTrackId,
                audioTrackId,
                videoVolume: videoVolume / 100,
                skipAudioClip: timelineAddMode === 'video-only',
              }
            );
            runningEnd = result.endTime;
            videoTrackId = result.videoTrackId;
            if (timelineAddMode === 'both') {
              audioTrackId = result.audioTrackId;
            }
          }
        } catch (err) {
          console.error(`Failed to add scene ${scene.order} to timeline:`, err);
          failedScenes.push(scene.order);
        }
      }

      const added = scenesToAdd.length - failedScenes.length;
      if (failedScenes.length > 0) {
        toast.error(
          `Failed to add scene(s) ${failedScenes.join(', ')}. Try regenerating their videos.`
        );
      }
      if (added > 0) {
        toast.success(`Added ${added} scene(s) to timeline`);
      }
      clearSelection();
    } catch (err) {
      console.error('Failed to add scenes to timeline:', err);
      toast.error('Failed to add scenes to timeline');
    } finally {
      setIsAddingToTimeline(false);
    }
  };

  const handleApplyTemplate = async () => {
    if (!studio || !selectedTemplateId) return;
    const template = getTemplate(selectedTemplateId);
    if (!template) return;

    const scenesToApply = sortedScenes.filter(
      (s) =>
        selectedSceneIds.has(s.id) &&
        s.first_frames?.some(
          (ff) => ff.url || ff.final_url || ff.outpainted_url
        )
    );

    if (scenesToApply.length === 0) {
      toast.error('No scenes with images to apply template to');
      return;
    }

    setIsApplyingTemplate(true);
    try {
      const canvasWidth = studio.opts.width;
      const canvasHeight = studio.opts.height;

      await applyTemplate(
        template,
        scenesToApply,
        studio,
        {
          width: canvasWidth,
          height: canvasHeight,
        },
        { language: selectedLanguage }
      );

      toast.success(
        `Applied "${template.name}" template to ${scenesToApply.length} scene(s)`
      );
      clearSelection();
    } catch (err) {
      console.error('Failed to apply template:', err);
      toast.error('Failed to apply template');
    } finally {
      setIsApplyingTemplate(false);
    }
  };

  const handleAddVideoToTimeline = async (sceneId: string) => {
    if (!studio) return;
    const scene = sortedScenes.find((s) => s.id === sceneId);
    if (!scene?.video_url) return;

    try {
      const lastClipEnd = studio.clips.reduce((max, c) => {
        const end =
          c.display.to > 0 ? c.display.to : c.display.from + c.duration;
        return end > max ? end : max;
      }, 0);
      const estimatedEnd = lastClipEnd + 10;
      const existingVideoTrack = findCompatibleTrack(
        studio,
        'Video',
        lastClipEnd,
        estimatedEnd
      );

      await addSceneToTimeline(
        studio,
        { videoUrl: scene.video_url, voiceover: null },
        {
          startTime: lastClipEnd,
          videoTrackId: existingVideoTrack?.id,
          videoVolume: videoVolume / 100,
        }
      );
      toast.success('Video added to timeline');
    } catch (err) {
      console.error('Failed to add video to timeline:', err);
      toast.error('Failed to add video to timeline');
    }
  };

  const handleAddVoiceoverToTimeline = async (sceneId: string) => {
    if (!studio) return;
    const scene = sortedScenes.find((s) => s.id === sceneId);
    const voiceover = scene?.voiceovers?.find(
      (v) => v.language === selectedLanguage
    );
    if (!voiceover?.audio_url || voiceover.status !== 'success') return;

    try {
      const lastClipEnd = studio.clips.reduce((max, c) => {
        const end =
          c.display.to > 0 ? c.display.to : c.display.from + c.duration;
        return end > max ? end : max;
      }, 0);
      const estimatedEnd = lastClipEnd + 10;
      const existingAudioTrack = findCompatibleTrack(
        studio,
        'Audio',
        lastClipEnd,
        estimatedEnd
      );

      await addVoiceoverToTimeline(
        studio,
        { audioUrl: voiceover.audio_url, voiceoverId: voiceover.id },
        { startTime: lastClipEnd, audioTrackId: existingAudioTrack?.id }
      );
      toast.success('Voiceover added to timeline');
    } catch (err) {
      console.error('Failed to add voiceover to timeline:', err);
      toast.error('Failed to add voiceover to timeline');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
        {error.message}
      </div>
    );
  }

  // Ref grid image review: show while grids are being generated/regenerated and when ready
  if (isRefToVideoMode && sortedScenes.length === 0 && storyboard?.plan) {
    const objectsGrid = gridImages.find((g) => g.type === 'objects');
    const bgGrid = gridImages.find((g) => g.type === 'backgrounds');

    if (objectsGrid && bgGrid) {
      return (
        <RefGridImageReview
          objectsGrid={objectsGrid}
          bgGrid={bgGrid}
          storyboard={storyboard as Storyboard}
          onApproveComplete={() => refresh()}
          onRegenerateComplete={() => refresh()}
        />
      );
    }
  }

  // I2V Grid image review: show when grid is generated but not yet split into scenes
  if (
    !isRefToVideoMode &&
    gridImage?.status === 'generated' &&
    sortedScenes.length === 0 &&
    storyboard &&
    'plan' in storyboard &&
    storyboard.plan
  ) {
    return (
      <GridImageReview
        gridImage={gridImage as GridImage}
        storyboard={storyboard as Storyboard}
        onApproveComplete={() => refresh()}
        onRegenerateComplete={() => refresh()}
      />
    );
  }

  // Grid image is being generated — show progress indicator
  if (isProcessing && sortedScenes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-3">
        <IconLoader2 size={32} className="animate-spin text-blue-400" />
        <span className="text-sm text-center">
          {isRefToVideoMode
            ? 'Generating grid images...'
            : 'Generating grid image...'}
        </span>
        <span className="text-xs text-center text-muted-foreground/60">
          This may take a minute
        </span>
      </div>
    );
  }

  // Splitting in progress — show loading state instead of "No scenes yet"
  if (
    sortedScenes.length === 0 &&
    (isSplitting || storyboard?.plan_status === 'splitting')
  ) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-3">
        <IconLoader2 size={32} className="animate-spin text-blue-400" />
        <span className="text-sm text-center">
          {isRefToVideoMode
            ? 'Preparing split (creating scenes + linking assets)...'
            : 'Splitting grid image into scenes...'}
        </span>
        <span className="text-xs text-center text-muted-foreground/60">
          This may take a minute
        </span>
      </div>
    );
  }

  if (sortedScenes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
        <IconLayoutGrid size={32} className="opacity-50" />
        <span className="text-sm text-center">
          No scenes yet. Generate a storyboard to see scene cards.
        </span>
      </div>
    );
  }

  const renderSceneCards = () => (
    <>
      {/* Mode indicator */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <span
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
            isCinematicMode
              ? 'bg-purple-500/15 text-purple-400'
              : 'bg-blue-500/15 text-blue-400'
          }`}
        >
          {isCinematicMode ? '🎬 Cinematic' : '🎙️ Narrative'}
        </span>
        <span className="text-[9px] text-muted-foreground">
          {sortedScenes.length} scenes
        </span>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <Slider
          value={[cardMinWidth]}
          onValueChange={([v]) => setCardMinWidth(v)}
          min={120}
          max={400}
          step={10}
          className="flex-1"
        />
      </div>

      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth}px, 1fr))`,
        }}
      >
        {sortedScenes.map((scene) => {
          return (
            <SceneCard
              key={scene.id}
              scene={scene}
              compact
              isSelected={selectedSceneIds.has(scene.id)}
              onSelectionChange={(selected) => toggleScene(scene.id, selected)}
              playingVoiceoverId={playingVoiceoverId}
              setPlayingVoiceoverId={setPlayingVoiceoverId}
              onReadScene={
                isNarrativeNoAudioMode || isCinematicMode
                  ? undefined
                  : handleReadScene
              }
              onTranslateScene={
                isCinematicMode ? undefined : handleTranslateSceneVoiceover
              }
              onReadSceneAllLanguages={
                isNarrativeNoAudioMode || isCinematicMode
                  ? undefined
                  : handleReadSceneAllLanguages
              }
              onGenerateSceneVideo={handleGenerateSceneVideo}
              onSaveVisualPrompt={
                isCinematicMode ? undefined : handleSaveVisualPrompt
              }
              onSaveVoiceoverText={
                isCinematicMode ? undefined : handleSaveVoiceoverText
              }
              showVoiceover={!isCinematicMode}
              showVisual={false}
              promptLabel={isRefI2VMode ? 'First Frame Prompt' : 'Visual'}
              promptOverride={
                isRefI2VMode
                  ? (scene.first_frames?.[0]?.visual_prompt ??
                    firstFramePromptBySceneId.get(scene.id) ??
                    null)
                  : undefined
              }
              selectedLanguage={selectedLanguage}
              isRefMode={isRefMode}
              isTarget={targetSceneId === scene.id}
              onSetTarget={(id) =>
                setTargetSceneId(targetSceneId === id ? null : id)
              }
              aspectRatio={storyboard?.aspect_ratio}
              onAddVideoToTimeline={handleAddVideoToTimeline}
              onAddVoiceoverToTimeline={handleAddVoiceoverToTimeline}
              availableBackgrounds={
                isRefToVideoMode ? availableBackgrounds : undefined
              }
              assetImageMap={assetImageMap}
              onChangeBackground={
                isRefToVideoMode ? handleChangeBackground : undefined
              }
              isDialogueMode={isDialogueMode}
              onUpdateShotDurations={handleUpdateShotDurations}
            />
          );
        })}
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {splitProgress && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-blue-300">
              <IconLoader2 size={14} className="animate-spin" />
              <span>Splitting references into scene assets</span>
            </div>
            <span className="text-xs text-blue-200">
              {splitProgress.progressPercent}%
            </span>
          </div>

          <div className="h-1.5 rounded-full bg-blue-950/40 overflow-hidden">
            <div
              className="h-full bg-blue-400 transition-all"
              style={{ width: `${splitProgress.progressPercent}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] text-blue-200/90">
            <div>
              Objects:{' '}
              {splitProgress.objects.success + splitProgress.objects.failed}/
              {splitProgress.objects.total}
            </div>
            <div>
              Backgrounds:{' '}
              {splitProgress.backgrounds.success +
                splitProgress.backgrounds.failed}
              /{splitProgress.backgrounds.total}
            </div>
          </div>

          <div className="text-[11px] text-blue-200/80">
            {splitProgress.stageLabel}
          </div>
        </div>
      )}

      {/* Mode / Audio Status */}
      {isRefToVideoMode && (
        <div className="px-2 py-1.5 bg-secondary/20 rounded-md flex items-center gap-2 text-[10px]">
          <span className="text-muted-foreground">Mode:</span>
          <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/30 uppercase tracking-wide">
            {isDialogueMode ? 'Cinematic' : 'Narrative'}
          </span>
          <span className="text-muted-foreground">Audio:</span>
          <span
            className={`px-1.5 py-0.5 rounded border uppercase tracking-wide ${
              isDialogueMode
                ? 'bg-green-500/10 text-green-400 border-green-500/30'
                : 'bg-slate-500/10 text-slate-300 border-slate-500/30'
            }`}
          >
            {isDialogueMode ? 'ON' : 'OFF'}
          </span>
        </div>
      )}

      {/* Selection Action Bar */}
      <div className="flex flex-col gap-1.5">
        {/* Row 1: Selection */}
        <div className="flex items-center justify-between px-2 py-1.5 bg-secondary/20 rounded-md">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => {
                if (checked) {
                  selectAll();
                } else {
                  clearSelection();
                }
              }}
            />
            <span className="text-xs text-muted-foreground">
              {allSelected ? 'Deselect All' : 'Select All'}
            </span>
          </div>
          {selectedSceneIds.size > 0 && (
            <span className="text-xs text-muted-foreground">
              {selectedSceneIds.size} selected
            </span>
          )}
        </div>

        {/* Add to Timeline */}
        {selectedSceneIds.size > 0 && (
          <div className="flex flex-col gap-1.5 px-2">
            <div className="flex items-center gap-1.5">
              <div className="flex rounded-md overflow-hidden border">
                {(
                  [
                    { value: 'voiceover-only', label: 'VO' },
                    { value: 'video-only', label: 'Video' },
                    { value: 'both', label: 'Both' },
                  ] as { value: TimelineAddMode; label: string }[]
                ).map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setTimelineAddMode(value)}
                    className={cn(
                      'h-8 px-2.5 text-xs font-medium transition-colors border-r last:border-r-0',
                      timelineAddMode === value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-accent text-muted-foreground hover:text-accent-foreground'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  (timelineAddMode === 'voiceover-only'
                    ? selectedScenesWithVoiceover.length === 0
                    : selectedScenesWithVideo.length === 0) ||
                  isAddingToTimeline
                }
                onClick={handleAddAllToTimeline}
                className="h-8 text-xs flex-1"
                title={
                  timelineAddMode === 'voiceover-only'
                    ? selectedScenesWithVoiceover.length === 0
                      ? 'Select scenes with generated voiceovers'
                      : `Add ${selectedScenesWithVoiceover.length} voiceover(s) to timeline`
                    : selectedScenesWithVideo.length === 0
                      ? 'Select scenes with generated videos'
                      : `Add ${selectedScenesWithVideo.length} scene(s) to timeline`
                }
              >
                {isAddingToTimeline ? (
                  <IconLoader2 className="size-3.5 animate-spin mr-1" />
                ) : (
                  <IconPlayerTrackNext className="size-3.5 mr-1" />
                )}
                Add to Timeline
              </Button>
            </div>
            {timelineAddMode !== 'voiceover-only' && (
              <div className="flex items-center gap-2">
                <IconVolume className="size-3.5 text-muted-foreground flex-shrink-0" />
                <Slider
                  value={[videoVolume]}
                  onValueChange={([v]) => setVideoVolume(v)}
                  min={0}
                  max={100}
                  step={1}
                  className="flex-1"
                />
                <span className="text-[10px] text-muted-foreground w-7 text-right flex-shrink-0">
                  {videoVolume}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Scene Cards */}
        {renderSceneCards()}

        {/* Audio Section — hidden in dialogue mode (Kling generates native audio) */}
        {!isDialogueMode && (
          <Collapsible open={isAudioOpen} onOpenChange={setIsAudioOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between px-2 py-2 bg-secondary/20 rounded-md hover:bg-secondary/30 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <IconMicrophone className="size-3.5 text-blue-400" />
                  <span className="text-xs font-medium">Audio</span>
                </span>
                {isAudioOpen ? (
                  <IconChevronUp className="size-3 text-muted-foreground" />
                ) : (
                  <IconChevronDown className="size-3 text-muted-foreground" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-2 py-2 flex flex-col gap-2">
                {/* Voice select */}
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Voice
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={
                        (
                          voiceConfig[selectedLanguage] ??
                          voiceConfig[Object.keys(voiceConfig)[0]]
                        )?.voice ?? FALLBACK_VOICE
                      }
                      onValueChange={(value) => {
                        setVoiceConfig((prev) => ({
                          ...prev,
                          [selectedLanguage]: {
                            ...prev[selectedLanguage],
                            voice: value,
                          },
                        }));
                      }}
                    >
                      <SelectTrigger className="h-8 flex-1 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VOICES.map((v) => (
                          <SelectItem key={v.value} value={v.value}>
                            <span>{v.label}</span>
                            <span className="ml-1 text-muted-foreground">
                              {v.description}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* TTS Model + Speed */}
                <div className="flex items-end gap-2">
                  <div className="flex flex-col gap-1 flex-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      TTS Model
                    </span>
                    <Select
                      value={ttsModel}
                      onValueChange={(v) => setTtsModel(v as TTSModelKey)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(TTS_MODELS) as TTSModelKey[]).map(
                          (key) => (
                            <SelectItem key={key} value={key}>
                              <span>{TTS_MODELS[key].label}</span>
                              <span className="ml-1 text-muted-foreground">
                                {TTS_MODELS[key].description}
                              </span>
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1 flex-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Speed {ttsSpeed.toFixed(1)}x
                    </span>
                    <Slider
                      value={[ttsSpeed]}
                      onValueChange={([v]) => setTtsSpeed(v)}
                      min={0.7}
                      max={1.2}
                      step={0.05}
                      className="py-2"
                    />
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1.5 pt-1">
                  <Button
                    size="sm"
                    variant="default"
                    disabled={selectedSceneIds.size === 0 || isGenerating}
                    onClick={handleGenerateVoiceovers}
                    className="h-9 text-xs flex-1"
                  >
                    {isGenerating ? (
                      <IconLoader2 className="size-3.5 animate-spin mr-1" />
                    ) : (
                      <IconMicrophone className="size-3.5 mr-1" />
                    )}
                    Generate Voiceover
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      selectedSceneIds.size === 0 ||
                      isGeneratingAll ||
                      isGenerating
                    }
                    onClick={handleGenerateAllVoiceovers}
                    className="h-9 text-xs"
                    title={`Generate voiceovers for all languages (${Object.keys(
                      voiceConfig
                    )
                      .map((c) => c.toUpperCase())
                      .join(', ')})`}
                  >
                    {isGeneratingAll ? (
                      <IconLoader2 className="size-3.5 animate-spin mr-1" />
                    ) : (
                      <IconMicrophone className="size-3.5 mr-1" />
                    )}
                    All Languages
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      selectedScenesWithVideoForSfx.length === 0 ||
                      isGeneratingSfx
                    }
                    onClick={handleGenerateSfx}
                    className="h-9 text-xs"
                    title={
                      selectedScenesWithVideoForSfx.length === 0
                        ? 'Select scenes with generated videos'
                        : `Add SFX to ${selectedScenesWithVideoForSfx.length} scene(s)`
                    }
                  >
                    {isGeneratingSfx ? (
                      <IconLoader2 className="size-3.5 animate-spin mr-1" />
                    ) : (
                      <IconVolume className="size-3.5 mr-1" />
                    )}
                    SFX
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Visual Section removed — MVP: image edits happen at asset level in Assets tab */}

        {/* Apply Template Section (Quick Video mode) */}
        {isQuickVideoMode && selectedSceneIds.size > 0 && (
          <div className="flex flex-col gap-2 px-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Template
            </span>
            <TemplatePicker
              selectedTemplateId={selectedTemplateId}
              onSelect={(t) => setSelectedTemplateId(t.id)}
            />
            <Button
              size="sm"
              disabled={
                !selectedTemplateId ||
                isApplyingTemplate ||
                selectedSceneIds.size === 0
              }
              onClick={handleApplyTemplate}
              className="h-9 text-xs w-full"
            >
              {isApplyingTemplate ? (
                <IconLoader2 className="size-3.5 animate-spin mr-1" />
              ) : (
                <IconSparkles className="size-3.5 mr-1" />
              )}
              Apply Template
            </Button>
          </div>
        )}

        {/* Video Section (hidden in quick_video mode) */}
        {!isQuickVideoMode && (
          <Collapsible open={isVideoOpen} onOpenChange={setIsVideoOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between px-2 py-2 bg-secondary/20 rounded-md hover:bg-secondary/30 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <IconVideo className="size-3.5 text-cyan-400" />
                  <span className="text-xs font-medium">Video</span>
                </span>
                {isVideoOpen ? (
                  <IconChevronUp className="size-3 text-muted-foreground" />
                ) : (
                  <IconChevronDown className="size-3 text-muted-foreground" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-2 py-2 flex flex-col gap-2">
                {/* Video model + Resolution */}
                {isRefToVideoMode ? (
                  <div className="flex flex-col gap-2">
                    {isRefDirectMode && (
                      <>
                        {/* Direct ref-to-video model */}
                        {storyboard?.model?.startsWith('kling') ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Ref Video Model
                            </span>
                            <Select
                              value={refVideoModel}
                              onValueChange={(value: string) =>
                                setRefVideoModel(
                                  value as 'klingo3' | 'klingo3pro'
                                )
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="klingo3">
                                  Kling O3
                                </SelectItem>
                                <SelectItem value="klingo3pro">
                                  Kling O3 Pro
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground px-1">
                            Ref Video Model:{' '}
                            <span className="font-medium text-foreground">
                              Kling O3
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    {isRefI2VMode && (
                      <>
                        <div className="h-px bg-border/60 my-1" />

                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider px-1">
                          First Frame to Video
                        </div>

                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                            First Frame Model
                          </span>
                          <Select
                            value={firstFrameModel}
                            onValueChange={(value: string) =>
                              setFirstFrameModel(value as FirstFrameModelKey)
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(
                                Object.keys(
                                  FIRST_FRAME_MODELS
                                ) as FirstFrameModelKey[]
                              ).map((key) => (
                                <SelectItem key={key} value={key}>
                                  {FIRST_FRAME_MODELS[key].label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-end gap-2">
                          <div className="flex flex-col gap-1 flex-1">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Frame Aspect
                            </span>
                            <Select
                              value={firstFrameAspectRatio}
                              onValueChange={(value: string) =>
                                setFirstFrameAspectRatio(
                                  value as FirstFrameAspectRatioKey
                                )
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(
                                  Object.keys(
                                    FIRST_FRAME_ASPECT_RATIOS
                                  ) as FirstFrameAspectRatioKey[]
                                ).map((key) => (
                                  <SelectItem key={key} value={key}>
                                    {FIRST_FRAME_ASPECT_RATIOS[key].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1 w-[90px]">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Frame K
                            </span>
                            <Select
                              value={firstFrameResolution}
                              onValueChange={(value: string) =>
                                setFirstFrameResolution(
                                  value as FirstFrameResolutionKey
                                )
                              }
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(
                                  Object.keys(
                                    FIRST_FRAME_RESOLUTIONS
                                  ) as FirstFrameResolutionKey[]
                                ).map((key) => (
                                  <SelectItem key={key} value={key}>
                                    {FIRST_FRAME_RESOLUTIONS[key].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex-1 text-xs text-muted-foreground">
                            <span className="text-[10px] uppercase tracking-wider">
                              i2v Model:{' '}
                            </span>
                            <span className="font-medium text-foreground">
                              Kling O3
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 w-[100px]">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                              Resolution
                            </span>
                            <Select
                              value={videoResolution}
                              onValueChange={(
                                value: '480p' | '720p' | '1080p'
                              ) => setVideoResolution(value)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(['720p', '1080p'] as const).map((res) => (
                                  <SelectItem key={res} value={res}>
                                    {res}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            selectedSceneIds.size === 0 ||
                            isGeneratingRefFirstFrames
                          }
                          onClick={handleGenerateRefFirstFrames}
                          className="h-9 text-xs"
                        >
                          {isGeneratingRefFirstFrames ? (
                            <IconLoader2 className="size-3.5 animate-spin mr-1" />
                          ) : (
                            <IconPhoto className="size-3.5 mr-1" />
                          )}
                          Generate First Frames from Refs
                        </Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 text-xs text-muted-foreground">
                      <span className="text-[10px] uppercase tracking-wider">
                        Video Model:{' '}
                      </span>
                      <span className="font-medium text-foreground">
                        Kling O3
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 w-[100px]">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        Resolution
                      </span>
                      <Select
                        value={videoResolution}
                        onValueChange={(value: '480p' | '720p' | '1080p') =>
                          setVideoResolution(value)
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(['720p', '1080p'] as const).map((res) => (
                            <SelectItem key={res} value={res}>
                              {res}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-1.5 pt-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={selectedSceneIds.size === 0 || isGeneratingVideo}
                    onClick={
                      isRefI2VMode
                        ? handleGenerateVideoFromFirstFrame
                        : handleGenerateVideo
                    }
                    className="h-9 text-xs flex-1"
                  >
                    {isGeneratingVideo ? (
                      <IconLoader2 className="size-3.5 animate-spin mr-1" />
                    ) : (
                      <IconVideo className="size-3.5 mr-1" />
                    )}
                    {isRefI2VMode
                      ? 'Generate Video (First Frame)'
                      : isRefToVideoMode
                        ? 'Generate Video (Direct)'
                        : 'Generate Video'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedScenesWithVideo.length === 0}
                    onClick={handleRemoveVideos}
                    className="h-9 text-xs"
                    title={
                      selectedScenesWithVideo.length === 0
                        ? 'Select scenes with generated videos'
                        : `Remove video from ${selectedScenesWithVideo.length} scene(s)`
                    }
                  >
                    <IconVideoOff className="size-3.5 mr-1" />
                    Remove
                  </Button>
                </div>

                {(isGeneratingVideo || processingVideoCount > 0) && (
                  <div className="mt-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-300 flex items-center gap-1.5">
                    <IconLoader2 className="size-3 animate-spin" />
                    {isGeneratingVideo
                      ? 'Submitting video jobs...'
                      : `${processingVideoCount} scene${processingVideoCount === 1 ? '' : 's'} generating...`}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Overall Status */}
      {isProcessing && (
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md flex items-center gap-2">
          <IconLoader2 className="size-4 animate-spin text-blue-500" />
          <span className="text-sm text-blue-500">
            Processing storyboard...
          </span>
        </div>
      )}
      {isSplitting && (
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-md flex items-center gap-2">
          <IconLoader2 className="size-4 animate-spin text-blue-500" />
          <span className="text-sm text-blue-500">
            Splitting grid into scenes...
          </span>
        </div>
      )}
      {/* Script View - Collapsible voiceover list */}
      {!isCinematicMode && (
        <Collapsible open={isScriptViewOpen} onOpenChange={setIsScriptViewOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between h-8 text-xs text-muted-foreground hover:text-foreground"
            >
              <span className="flex items-center gap-1.5">
                <IconFileText className="size-3.5" />
                Script View
                <span className="text-[10px] text-muted-foreground/60">
                  ({sortedScenes.length} scenes)
                </span>
              </span>
              {isScriptViewOpen ? (
                <IconChevronUp className="size-3" />
              ) : (
                <IconChevronDown className="size-3" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col gap-1 py-2 px-1 bg-secondary/10 rounded-md max-h-[400px] overflow-y-auto">
              {sortedScenes.map((scene) => (
                <ScriptViewRow
                  key={scene.id}
                  scene={scene}
                  playingVoiceoverId={playingVoiceoverId}
                  setPlayingVoiceoverId={setPlayingVoiceoverId}
                  onSave={handleSaveVoiceoverText}
                  selectedLanguage={selectedLanguage}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Objects Gallery — ref_to_video only */}
      {isRefToVideoMode &&
        (() => {
          const seen = new Map<string, RefObject>();
          for (const scene of sortedScenes) {
            for (const obj of scene.objects ?? []) {
              if (!seen.has(obj.name)) {
                seen.set(obj.name, obj);
              } else {
                const existing = seen.get(obj.name);
                const existingUrl = resolveAssetImageUrl(
                  existing,
                  assetImageMap
                );
                const candidateUrl = resolveAssetImageUrl(obj, assetImageMap);

                if (!existingUrl && candidateUrl) {
                  seen.set(obj.name, obj);
                }
              }
            }
          }
          const uniqueObjects = [...seen.values()].sort(
            (a, b) => a.order - b.order
          );
          if (uniqueObjects.length === 0) return null;
          return (
            <Collapsible
              open={isObjectsViewOpen}
              onOpenChange={setIsObjectsViewOpen}
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between h-8 text-xs text-muted-foreground hover:text-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    <IconUsers className="size-3.5" />
                    Objects
                    <span className="text-[10px] text-muted-foreground/60">
                      ({uniqueObjects.length})
                    </span>
                  </span>
                  {isObjectsViewOpen ? (
                    <IconChevronUp className="size-3" />
                  ) : (
                    <IconChevronDown className="size-3" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div
                  className="grid gap-2 py-2"
                  style={{
                    gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth}px, 1fr))`,
                  }}
                >
                  {uniqueObjects.map((obj) => {
                    const imageUrl = resolveAssetImageUrl(obj, assetImageMap);
                    const isProcessing =
                      obj.status === 'processing' || obj.status === 'pending';
                    const isFailed = obj.status === 'failed';
                    const isSelected = selectedObjectName === obj.name;
                    return (
                      <div
                        key={obj.id}
                        className={`p-2 bg-secondary/30 rounded-md flex flex-col gap-1.5 cursor-pointer transition-all ${isFailed ? 'border border-destructive/40' : ''} ${isSelected ? 'ring-2 ring-blue-400 bg-blue-500/10' : 'hover:bg-secondary/50'}`}
                        onClick={() =>
                          setSelectedObjectName(isSelected ? null : obj.name)
                        }
                      >
                        <div className="relative aspect-square rounded overflow-hidden bg-secondary/50">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={obj.name}
                              className="absolute inset-0 w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
                              <span className="text-2xl font-bold uppercase">
                                {obj.name.charAt(0)}
                              </span>
                            </div>
                          )}
                          {isProcessing && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <IconLoader2 className="size-5 animate-spin text-white" />
                            </div>
                          )}
                          {obj.image_edit_status === 'outpainting' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <IconLoader2 className="size-5 animate-spin text-purple-400" />
                            </div>
                          )}
                          {obj.image_edit_status === 'enhancing' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <IconLoader2 className="size-5 animate-spin text-green-400" />
                            </div>
                          )}
                          {obj.image_edit_status === 'editing' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <IconLoader2 className="size-5 animate-spin text-amber-400" />
                            </div>
                          )}
                          {obj.image_edit_status === 'processing' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <IconLoader2 className="size-5 animate-spin text-cyan-400" />
                            </div>
                          )}
                          {obj.image_edit_status === 'failed' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <IconAlertTriangle className="size-5 text-red-400" />
                            </div>
                          )}
                        </div>
                        <span className="text-xs font-medium truncate">
                          {obj.name}
                        </span>
                        {obj.description && (
                          <span className="text-[11px] text-muted-foreground line-clamp-2">
                            {obj.description}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Action buttons for the selected object */}
                {selectedObjectName && (
                  <div className="flex flex-col gap-2 px-1 pb-2">
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isEnhancingObject}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEnhanceObject(selectedObjectName);
                        }}
                        className="h-8 text-xs flex-1"
                      >
                        {isEnhancingObject ? (
                          <IconLoader2 className="size-3.5 animate-spin mr-1" />
                        ) : (
                          <IconSparkles className="size-3.5 mr-1" />
                        )}
                        Enhance
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResetObject(selectedObjectName);
                        }}
                        className="h-8 text-xs flex-1"
                      >
                        <IconArrowBackUp className="size-3.5 mr-1" />
                        Reset
                      </Button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Textarea
                        value={objectEditPrompt}
                        onChange={(e) => setObjectEditPrompt(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder={`Edit "${selectedObjectName}"...`}
                        className="text-xs min-h-[48px] resize-none flex-1"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        isCustomEditingObject || !objectEditPrompt.trim()
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCustomEditObject(
                          selectedObjectName,
                          objectEditPrompt
                        );
                      }}
                      className="h-8 text-xs"
                    >
                      {isCustomEditingObject ? (
                        <IconLoader2 className="size-3.5 animate-spin mr-1" />
                      ) : (
                        <IconSparkles className="size-3.5 mr-1" />
                      )}
                      Custom Edit
                    </Button>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        })()}
    </div>
  );
}
