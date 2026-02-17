'use client';

import { useEffect, useState } from 'react';
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
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { SceneCard, VoiceoverPlayButton } from './scene-card';
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
import { useStudioStore } from '@/stores/studio-store';
import { createClient } from '@/lib/supabase/client';
import {
  addSceneToTimeline,
  addVoiceoverToTimeline,
  findCompatibleTrack,
} from '@/lib/scene-timeline-utils';
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

const VIDEO_MODELS = {
  'wan2.6': { label: 'Wan 2.6', resolutions: ['720p', '1080p'] as const },
  'bytedance1.5pro': {
    label: 'ByteDance 1.5 Pro',
    resolutions: ['480p', '720p', '1080p'] as const,
  },
  grok: {
    label: 'Grok',
    resolutions: ['720p', '480p'] as const,
  },
} as const;

type VideoModelKey = keyof typeof VIDEO_MODELS;

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
  selectedLanguage: 'en' | 'tr' | 'ar';
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

  const { confirm } = useDeleteConfirmation();
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(
    new Set()
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOutpainting, setIsOutpainting] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isCustomEditing, setIsCustomEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [isRefMode, setIsRefMode] = useState(false);
  const [targetSceneId, setTargetSceneId] = useState<string | null>(null);
  const [refPrompt, setRefPrompt] = useState('');
  const [isRefGenerating, setIsRefGenerating] = useState(false);
  const [outpaintModel, setOutpaintModel] =
    useState<keyof typeof OUTPAINT_MODELS>('kling');
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoModel, setVideoModel] =
    useState<VideoModelKey>('bytedance1.5pro');
  const [videoResolution, setVideoResolution] = useState<
    '480p' | '720p' | '1080p'
  >('720p');
  const [isGeneratingSfx, setIsGeneratingSfx] = useState(false);
  const [isAddingToTimeline, setIsAddingToTimeline] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'tr' | 'ar'>(
    'en'
  );
  const [voiceConfig, setVoiceConfig] = useState({
    en: { voice: 'NFG5qt843uXKj4pFvR7C' },
    tr: { voice: '75SIZa3vvET95PHhf1yD' },
    ar: { voice: 'IES4nrmZdUBHByLBde0P' },
  });
  const [ttsModel, setTtsModel] = useState<TTSModelKey>('turbo-v2.5');
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const [videoVolume, setVideoVolume] = useState(5);
  const [playingVoiceoverId, setPlayingVoiceoverId] = useState<string | null>(
    null
  );
  const [isScriptViewOpen, setIsScriptViewOpen] = useState(false);
  const [isObjectsViewOpen, setIsObjectsViewOpen] = useState(true);
  const [isAudioOpen, setIsAudioOpen] = useState(true);
  const [isVisualOpen, setIsVisualOpen] = useState(false);
  const [isVideoOpen, setIsVideoOpen] = useState(false);
  const [cardMinWidth, setCardMinWidth] = useState(180);
  const { studio } = useStudioStore();

  // Refresh data when refreshTrigger changes (new storyboard generated)
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      refresh();
    }
  }, [refreshTrigger, refresh]);

  // Auto-correct resolution when model changes
  useEffect(() => {
    const allowed = VIDEO_MODELS[videoModel].resolutions as readonly string[];
    if (!allowed.includes(videoResolution)) {
      setVideoResolution(allowed[0] as '480p' | '720p' | '1080p');
    }
  }, [videoModel, videoResolution]);

  const scenes =
    storyboard && 'scenes' in storyboard
      ? (storyboard as StoryboardWithScenes).scenes
      : [];

  const sortedScenes = scenes.sort((a, b) => a.order - b.order);

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
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke('generate-tts', {
        body: {
          scene_ids: Array.from(selectedSceneIds),
          voice: voiceConfig[selectedLanguage].voice,
          model: ttsModel,
          language: selectedLanguage,
          speed: ttsSpeed,
        },
      });

      if (error) throw error;

      toast.success(
        `Voiceover generation started for ${data.summary.queued} scene(s)`
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

  const handleOutpaintImages = async () => {
    if (selectedSceneIds.size === 0) return;

    setIsOutpainting(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke('edit-image', {
        body: { scene_ids: Array.from(selectedSceneIds), model: outpaintModel },
      });

      if (error) throw error;

      if (data.summary.queued > 0) {
        toast.success(
          `Image outpaint started for ${data.summary.queued} scene(s)`
        );
      }
      if (data.summary.skipped > 0) {
        toast.warning(
          `${data.summary.skipped} scene(s) skipped (already processing)`
        );
      }
      if (data.summary.failed > 0) {
        toast.error(
          `${data.summary.failed} scene(s) failed to submit for outpainting`
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
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke('edit-image', {
        body: {
          scene_ids: Array.from(selectedSceneIds),
          model: outpaintModel,
          action: 'enhance',
        },
      });

      if (error) throw error;

      if (data.summary.queued > 0) {
        toast.success(
          `Image enhance started for ${data.summary.queued} scene(s)`
        );
      }
      if (data.summary.skipped > 0) {
        toast.warning(
          `${data.summary.skipped} scene(s) skipped (already processing or no final image)`
        );
      }
      if (data.summary.failed > 0) {
        toast.error(
          `${data.summary.failed} scene(s) failed to submit for enhancing`
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
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke('edit-image', {
        body: {
          scene_ids: Array.from(selectedSceneIds),
          model: outpaintModel,
          action: 'custom_edit',
          prompt: editPrompt.trim(),
        },
      });

      if (error) throw error;

      if (data.summary.queued > 0) {
        toast.success(
          `Custom edit started for ${data.summary.queued} scene(s)`
        );
      }
      if (data.summary.skipped > 0) {
        toast.warning(
          `${data.summary.skipped} scene(s) skipped (already processing or no final image)`
        );
      }
      if (data.summary.failed > 0) {
        toast.error(
          `${data.summary.failed} scene(s) failed to submit for editing`
        );
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
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke('edit-image', {
        body: {
          scene_ids: Array.from(selectedSceneIds),
          model: outpaintModel,
          action: 'ref_to_image',
          prompt: refPrompt.trim(),
          target_scene_id: targetSceneId,
        },
      });

      if (error) throw error;

      if (data.success) {
        toast.success(
          `Reference-to-image started (${data.reference_count} references)`
        );
      } else {
        toast.error(data.error || 'Failed to start ref-to-image');
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
      const supabase = createClient();
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
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke('edit-image', {
        body: {
          scene_ids: Array.from(selectedSceneIds),
          model: outpaintModel,
          action: 'enhance',
          source: 'background',
        },
      });

      if (error) throw error;

      if (data.summary.queued > 0) {
        toast.success(
          `Background enhance started for ${data.summary.queued} scene(s)`
        );
      }
      if (data.summary.skipped > 0) {
        toast.warning(
          `${data.summary.skipped} scene(s) skipped (already processing or no final image)`
        );
      }
      if (data.summary.failed > 0) {
        toast.error(
          `${data.summary.failed} scene(s) failed to submit for enhancing`
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
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke('edit-image', {
        body: {
          scene_ids: Array.from(selectedSceneIds),
          model: outpaintModel,
          action: 'custom_edit',
          prompt: editPrompt.trim(),
          source: 'background',
        },
      });

      if (error) throw error;

      if (data.summary.queued > 0) {
        toast.success(
          `Custom edit started for ${data.summary.queued} background(s)`
        );
      }
      if (data.summary.skipped > 0) {
        toast.warning(
          `${data.summary.skipped} scene(s) skipped (already processing or no final image)`
        );
      }
      if (data.summary.failed > 0) {
        toast.error(
          `${data.summary.failed} scene(s) failed to submit for editing`
        );
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
      const supabase = createClient();
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

  const handleGenerateVideo = async () => {
    if (selectedSceneIds.size === 0) return;

    // Check for scenes without voiceover audio
    const scenesWithoutVoiceover = sortedScenes
      .filter((s) => selectedSceneIds.has(s.id))
      .filter((s) => {
        const maxDuration = Math.max(
          ...(s.voiceovers || []).map((v) => v.duration ?? 0),
          0
        );
        return maxDuration === 0;
      });

    let fallbackDuration: number | undefined;

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

    setIsGeneratingVideo(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke(
        'generate-video',
        {
          body: {
            scene_ids: Array.from(selectedSceneIds),
            resolution: videoResolution,
            model:
              storyboard?.mode === 'ref_to_video'
                ? storyboard.model
                : videoModel,
            aspect_ratio:
              storyboard && 'aspect_ratio' in storyboard
                ? storyboard.aspect_ratio
                : '16:9',
            ...(fallbackDuration && { fallback_duration: fallbackDuration }),
            ...(storyboard?.mode === 'ref_to_video' && {
              storyboard_id: storyboard.id,
            }),
          },
        }
      );

      if (error) throw error;

      toast.success(
        `Video generation started for ${data.summary.queued} scene(s)`
      );
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
      const supabase = createClient();

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
      const supabase = createClient();
      const { data, error } = await supabase.functions.invoke('generate-sfx', {
        body: { scene_ids: Array.from(selectedSceneIds) },
      });

      if (error) throw error;

      toast.success(
        `SFX generation started for ${data.summary.queued} scene(s)`
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

  const handleSaveVoiceoverText = async (sceneId: string, newText: string) => {
    const scene = sortedScenes.find((s) => s.id === sceneId);
    const voiceover = scene?.voiceovers?.find(
      (v) => v.language === selectedLanguage
    );
    if (!voiceover) return;
    const supabase = createClient();
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
    const supabase = createClient();
    const { error } = await supabase
      .from('first_frames')
      .update({ visual_prompt: newPrompt })
      .eq('scene_id', sceneId);

    if (error) {
      console.error('Failed to save visual prompt:', error);
      toast.error('Failed to save visual prompt');
      throw error;
    }
  };

  const handleReadScene = async (sceneId: string, newVoiceoverText: string) => {
    const supabase = createClient();
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

    const { error: ttsError } = await supabase.functions.invoke(
      'generate-tts',
      {
        body: {
          scene_ids: [sceneId],
          voice: voiceConfig[selectedLanguage].voice,
          model: ttsModel,
          language: selectedLanguage,
          speed: ttsSpeed,
        },
      }
    );

    if (ttsError) {
      console.error('TTS generation failed:', ttsError);
      toast.error('Failed to start voiceover generation');
    } else {
      toast.success('Voiceover generation started');
    }

    refresh();
  };

  const handleGenerateSceneVideo = async (
    sceneId: string,
    newVisualPrompt: string
  ) => {
    const supabase = createClient();
    const scene = sortedScenes.find((s) => s.id === sceneId);
    const isRef = storyboard?.mode === 'ref_to_video';

    // For i2v mode, require a final image
    if (!isRef) {
      const finalUrl = scene?.first_frames?.[0]?.final_url;
      if (!finalUrl) {
        toast.error('Cannot generate video — outpaint the image first.');
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
      // For ref mode, update the scene prompt
      const { error: promptError } = await supabase
        .from('scenes')
        .update({ prompt: newVisualPrompt })
        .eq('id', sceneId);

      if (promptError) {
        toast.error('Failed to update scene prompt');
        throw promptError;
      }
    }

    // Reset video fields on scenes
    const { error: resetError } = await supabase
      .from('scenes')
      .update({
        video_status: null,
        video_url: null,
        video_request_id: null,
        video_error_message: null,
      })
      .eq('id', sceneId);

    if (resetError) {
      toast.error('Failed to reset video status');
      throw resetError;
    }

    const { error: videoError } = await supabase.functions.invoke(
      'generate-video',
      {
        body: {
          scene_ids: [sceneId],
          resolution: videoResolution,
          model: isRef ? storyboard?.model : videoModel,
          aspect_ratio:
            storyboard && 'aspect_ratio' in storyboard
              ? storyboard.aspect_ratio
              : '16:9',
          ...(isRef && { storyboard_id: storyboard?.id }),
        },
      }
    );

    if (videoError) {
      console.error('Video generation failed:', videoError);
      toast.error('Failed to start video generation');
    } else {
      toast.success('Video generation started');
    }

    refresh();
  };

  const handleAddAllToTimeline = async () => {
    if (!studio || selectedScenesWithVideo.length === 0) return;

    setIsAddingToTimeline(true);
    try {
      // Compute initial start time from existing clips
      let runningEnd = studio.clips.reduce((max, c) => {
        const end =
          c.display.to > 0 ? c.display.to : c.display.from + c.duration;
        return end > max ? end : max;
      }, 0);

      // Try to reuse existing tracks if they don't have overlapping clips
      const estimatedEnd = runningEnd + 10;
      let videoTrackId: string | undefined = findCompatibleTrack(
        studio,
        'Video',
        runningEnd,
        estimatedEnd
      )?.id;
      let audioTrackId: string | undefined = findCompatibleTrack(
        studio,
        'Audio',
        runningEnd,
        estimatedEnd
      )?.id;

      // Sort selected scenes by order and add sequentially
      const scenesToAdd = [...selectedScenesWithVideo].sort(
        (a, b) => a.order - b.order
      );

      for (const scene of scenesToAdd) {
        const voiceover = scene.voiceovers?.find(
          (v) => v.language === selectedLanguage
        );

        const result = await addSceneToTimeline(
          studio,
          {
            videoUrl: scene.video_url!,
            voiceover:
              voiceover?.status === 'success' && voiceover?.audio_url
                ? { audioUrl: voiceover.audio_url }
                : null,
          },
          {
            startTime: runningEnd,
            videoTrackId,
            audioTrackId,
            videoVolume: videoVolume / 100,
          }
        );

        runningEnd = result.endTime;
        videoTrackId = result.videoTrackId;
        audioTrackId = result.audioTrackId;
      }

      toast.success(`Added ${scenesToAdd.length} scene(s) to timeline`);
      clearSelection();
    } catch (err) {
      console.error('Failed to add scenes to timeline:', err);
      toast.error('Failed to add scenes to timeline');
    } finally {
      setIsAddingToTimeline(false);
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
        { audioUrl: voiceover.audio_url },
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

  const isRefToVideoMode = storyboard?.mode === 'ref_to_video';

  // Ref grid image review: show when both grids are generated (plan_status = grid_ready)
  if (
    isRefToVideoMode &&
    storyboard?.plan_status === 'grid_ready' &&
    sortedScenes.length === 0 &&
    storyboard?.plan
  ) {
    const objectsGrid = gridImages.find((g) => g.type === 'objects');
    const bgGrid = gridImages.find((g) => g.type === 'backgrounds');
    if (objectsGrid && bgGrid) {
      return (
        <RefGridImageReview
          objectsGrid={objectsGrid}
          bgGrid={bgGrid}
          storyboard={storyboard as Storyboard}
          onApproveComplete={() => refresh()}
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

  return (
    <div className="flex flex-col gap-3">
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
            <Button
              size="sm"
              variant="outline"
              disabled={
                selectedScenesWithVideo.length === 0 || isAddingToTimeline
              }
              onClick={handleAddAllToTimeline}
              className="h-8 text-xs w-full"
              title={
                selectedScenesWithVideo.length === 0
                  ? 'Select scenes with generated videos'
                  : `Add ${selectedScenesWithVideo.length} scene(s) video + voiceover to timeline`
              }
            >
              {isAddingToTimeline ? (
                <IconLoader2 className="size-3.5 animate-spin mr-1" />
              ) : (
                <IconPlayerTrackNext className="size-3.5 mr-1" />
              )}
              Add to Timeline
            </Button>
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
          </div>
        )}

        {/* Audio Section */}
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
              {/* Language tabs */}
              <div className="flex items-center rounded-md border border-border/50 overflow-hidden w-fit">
                {(['en', 'tr', 'ar'] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setSelectedLanguage(lang)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      selectedLanguage === lang
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-secondary/50 text-muted-foreground'
                    }`}
                  >
                    {lang.toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Voice select */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Voice
                </span>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={voiceConfig[selectedLanguage].voice}
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
                      {(Object.keys(TTS_MODELS) as TTSModelKey[]).map((key) => (
                        <SelectItem key={key} value={key}>
                          <span>{TTS_MODELS[key].label}</span>
                          <span className="ml-1 text-muted-foreground">
                            {TTS_MODELS[key].description}
                          </span>
                        </SelectItem>
                      ))}
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

        {/* Visual Section */}
        <Collapsible open={isVisualOpen} onOpenChange={setIsVisualOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="w-full flex items-center justify-between px-2 py-2 bg-secondary/20 rounded-md hover:bg-secondary/30 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <IconSparkles className="size-3.5 text-purple-400" />
                <span className="text-xs font-medium">Visual</span>
              </span>
              {isVisualOpen ? (
                <IconChevronUp className="size-3 text-muted-foreground" />
              ) : (
                <IconChevronDown className="size-3 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-2 py-2 flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Edit Model
                </span>
                <Select
                  value={outpaintModel}
                  onValueChange={(v) =>
                    setOutpaintModel(v as keyof typeof OUTPAINT_MODELS)
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(
                        OUTPAINT_MODELS
                      ) as (keyof typeof OUTPAINT_MODELS)[]
                    ).map((key) => (
                      <SelectItem key={key} value={key}>
                        {OUTPAINT_MODELS[key].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                {!isRefToVideoMode && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedSceneIds.size === 0 || isOutpainting}
                    onClick={handleOutpaintImages}
                    className="h-9 text-xs flex-1"
                  >
                    {isOutpainting ? (
                      <IconLoader2 className="size-3.5 animate-spin mr-1" />
                    ) : (
                      <IconSparkles className="size-3.5 mr-1" />
                    )}
                    Outpaint
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selectedSceneIds.size === 0 || isEnhancing}
                  onClick={
                    isRefToVideoMode
                      ? handleEnhanceBackgroundImages
                      : handleEnhanceImages
                  }
                  className="h-9 text-xs flex-1"
                >
                  {isEnhancing ? (
                    <IconLoader2 className="size-3.5 animate-spin mr-1" />
                  ) : (
                    <IconSparkles className="size-3.5 mr-1" />
                  )}
                  Enhance
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selectedSceneIds.size === 0}
                  onClick={
                    isRefToVideoMode
                      ? handleResetBackgroundImages
                      : handleResetImages
                  }
                  className="h-9 text-xs flex-1"
                >
                  <IconArrowBackUp className="size-3.5 mr-1" />
                  Reset
                </Button>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Custom Edit
                </span>
                <Textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  placeholder="Describe how to edit the image..."
                  className="text-xs min-h-[60px] resize-none"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    selectedSceneIds.size === 0 ||
                    isCustomEditing ||
                    !editPrompt.trim()
                  }
                  onClick={
                    isRefToVideoMode
                      ? handleCustomEditBackgrounds
                      : handleCustomEdit
                  }
                  className="h-9 text-xs"
                >
                  {isCustomEditing ? (
                    <IconLoader2 className="size-3.5 animate-spin mr-1" />
                  ) : (
                    <IconSparkles className="size-3.5 mr-1" />
                  )}
                  Edit
                </Button>
              </div>
              {!isRefToVideoMode && (
                <div className="flex flex-col gap-1.5 pt-1 border-t border-border/30">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Ref to Image
                    </span>
                    <Button
                      size="sm"
                      variant={isRefMode ? 'default' : 'ghost'}
                      onClick={() => {
                        setIsRefMode(!isRefMode);
                        if (isRefMode) {
                          setTargetSceneId(null);
                        }
                      }}
                      className="h-6 text-[10px] px-2"
                    >
                      <IconFocusCentered className="size-3 mr-1" />
                      {isRefMode ? 'Exit Ref Mode' : 'Enter Ref Mode'}
                    </Button>
                  </div>
                  {isRefMode && (
                    <>
                      <p className="text-[10px] text-muted-foreground">
                        Select reference scenes with checkboxes, then click the
                        target icon on the scene to replace.
                      </p>
                      {targetSceneId && (
                        <p className="text-[10px] text-amber-400">
                          Target: Scene{' '}
                          {sortedScenes.findIndex(
                            (s) => s.id === targetSceneId
                          ) + 1}
                        </p>
                      )}
                      <Textarea
                        value={refPrompt}
                        onChange={(e) => setRefPrompt(e.target.value)}
                        placeholder="Describe what to generate using the reference images..."
                        className="text-xs min-h-[60px] resize-none"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          selectedSceneIds.size === 0 ||
                          !targetSceneId ||
                          !refPrompt.trim() ||
                          isRefGenerating
                        }
                        onClick={handleRefToImage}
                        className="h-9 text-xs"
                      >
                        {isRefGenerating ? (
                          <IconLoader2 className="size-3.5 animate-spin mr-1" />
                        ) : (
                          <IconFocusCentered className="size-3.5 mr-1" />
                        )}
                        Generate with References
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Video Section */}
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
              {/* Video model + Resolution (hidden for ref_to_video — model comes from storyboard) */}
              {isRefToVideoMode ? (
                <div className="text-xs text-muted-foreground px-1">
                  Model:{' '}
                  <span className="font-medium text-foreground">
                    {storyboard?.model ?? 'N/A'}
                  </span>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <div className="flex flex-col gap-1 flex-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Model
                    </span>
                    <Select
                      value={videoModel}
                      onValueChange={(value: string) =>
                        setVideoModel(value as VideoModelKey)
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(VIDEO_MODELS) as VideoModelKey[]).map(
                          (key) => (
                            <SelectItem key={key} value={key}>
                              {VIDEO_MODELS[key].label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1 w-[80px]">
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
                        {VIDEO_MODELS[videoModel].resolutions.map((res) => (
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
                  onClick={handleGenerateVideo}
                  className="h-9 text-xs flex-1"
                >
                  {isGeneratingVideo ? (
                    <IconLoader2 className="size-3.5 animate-spin mr-1" />
                  ) : (
                    <IconVideo className="size-3.5 mr-1" />
                  )}
                  Generate Video
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
            </div>
          </CollapsibleContent>
        </Collapsible>
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

      {/* Objects Gallery — ref_to_video only */}
      {isRefToVideoMode &&
        (() => {
          const seen = new Map<string, RefObject>();
          for (const scene of sortedScenes) {
            for (const obj of scene.objects ?? []) {
              if (!seen.has(obj.name)) {
                seen.set(obj.name, obj);
              } else if (
                !seen.get(obj.name)!.final_url &&
                !seen.get(obj.name)!.url &&
                (obj.final_url || obj.url)
              ) {
                seen.set(obj.name, obj);
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
                    const imageUrl = obj.final_url ?? obj.url;
                    const isProcessing =
                      obj.status === 'processing' || obj.status === 'pending';
                    const isFailed = obj.status === 'failed';
                    return (
                      <div
                        key={obj.id}
                        className={`p-2 bg-secondary/30 rounded-md flex flex-col gap-1.5 ${isFailed ? 'border border-destructive/40' : ''}`}
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
              </CollapsibleContent>
            </Collapsible>
          );
        })()}

      {/* Card size slider */}
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

      {/* Scene Cards - responsive grid */}
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth}px, 1fr))`,
        }}
      >
        {sortedScenes.map((scene) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            compact
            isSelected={selectedSceneIds.has(scene.id)}
            onSelectionChange={(selected) => toggleScene(scene.id, selected)}
            playingVoiceoverId={playingVoiceoverId}
            setPlayingVoiceoverId={setPlayingVoiceoverId}
            onReadScene={handleReadScene}
            onGenerateSceneVideo={handleGenerateSceneVideo}
            onSaveVisualPrompt={handleSaveVisualPrompt}
            onSaveVoiceoverText={handleSaveVoiceoverText}
            selectedLanguage={selectedLanguage}
            isRefMode={isRefMode}
            isTarget={targetSceneId === scene.id}
            onSetTarget={(id) =>
              setTargetSceneId(targetSceneId === id ? null : id)
            }
            aspectRatio={storyboard?.aspect_ratio}
            onAddVideoToTimeline={handleAddVideoToTimeline}
            onAddVoiceoverToTimeline={handleAddVoiceoverToTimeline}
          />
        ))}
      </div>
    </div>
  );
}
