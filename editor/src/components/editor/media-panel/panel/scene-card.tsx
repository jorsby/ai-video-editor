'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import {
  IconPhoto,
  IconMicrophone,
  IconEye,
  IconChevronDown,
  IconPlayerPlay,
  IconPlayerPause,
  IconLoader2,
  IconVideo,
  IconAlertTriangle,
  IconMaximize,
  IconTarget,
  IconSwitchHorizontal,
  IconVolume,
} from '@tabler/icons-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { StatusBadge } from './status-badge';
import {
  resolveAssetImageUrl,
  type AssetImageMap,
} from '@/hooks/use-asset-image-resolver';
import { useStudioStore } from '@/stores/studio-store';
import {
  findCompatibleTrack,
  addSceneToTimeline,
} from '@/lib/scene-timeline-utils';
import type {
  Scene,
  FirstFrame,
  Voiceover,
  RefObject,
  Background,
} from '@/lib/supabase/workflow-service';

export function parseMultiShotPrompt(
  prompt: string | null | undefined
): string[] | null {
  if (!prompt || !prompt.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(prompt);
    if (
      Array.isArray(parsed) &&
      parsed.every((s: unknown) => typeof s === 'string')
    ) {
      return parsed;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

function formatPromptPreview(
  prompt: string | null | undefined,
  multiPrompt?: string[] | null
): string {
  if (multiPrompt && multiPrompt.length > 0) {
    return `[${multiPrompt.length}-shot] ${multiPrompt[0]}`;
  }
  if (!prompt) return '';
  const shots = parseMultiShotPrompt(prompt);
  if (shots) {
    return `[${shots.length}-shot] ${shots[0]}`;
  }
  return prompt;
}

function formatVoiceoverDuration(
  seconds: number | null | undefined
): string | null {
  if (
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return null;
  }

  return `${seconds.toFixed(1)}s`;
}

interface SceneBackgroundOption {
  name: string;
  url: string;
  final_url: string;
  series_asset_variant_id?: string | null;
}

export type ScenePromptSource =
  | 'prompt_contract'
  | 'multi_prompt'
  | 'prompt'
  | 'none';

export interface ScenePromptDebugSnapshot {
  prompt_source?: ScenePromptSource | null;
  compile_status?: Scene['compile_status'] | null;
  resolved_asset_refs?: Scene['resolved_asset_refs'] | null;
  reference_images?: Scene['reference_images'] | null;
  logged_at?: string | null;
}

interface SceneCardProps {
  scene: Scene;
  showVoiceover?: boolean;
  showVisual?: boolean;
  onClick?: () => void;
  compact?: boolean;
  isSelected?: boolean;
  onSelectionChange?: (selected: boolean) => void;
  playingVoiceoverId?: string | null;
  setPlayingVoiceoverId?: (id: string | null) => void;
  onReadScene?: (sceneId: string, newVoiceoverText: string) => Promise<void>;
  onTranslateScene?: (sceneId: string, sourceText: string) => Promise<void>;
  onReadSceneAllLanguages?: (
    sceneId: string,
    currentText: string
  ) => Promise<void>;
  onGenerateSceneVideo?: (
    sceneId: string,
    newVisualPrompt: string
  ) => Promise<void>;
  onSaveVisualPrompt?: (sceneId: string, newPrompt: string) => Promise<void>;
  onSaveVoiceoverText?: (sceneId: string, newText: string) => Promise<void>;
  promptLabel?: string;
  promptOverride?: string | null;
  selectedLanguage?: import('@/lib/constants/languages').LanguageCode;
  isRefMode?: boolean;
  isTarget?: boolean;
  onSetTarget?: (sceneId: string) => void;
  aspectRatio?: string;
  onAddVideoToTimeline?: (sceneId: string) => Promise<void>;
  onAddVoiceoverToTimeline?: (sceneId: string) => Promise<void>;
  availableBackgrounds?: Map<number, SceneBackgroundOption>;
  assetImageMap?: AssetImageMap;
  onChangeBackground?: (
    sceneId: string,
    newGridPosition: number
  ) => Promise<void>;
  isDialogueMode?: boolean;
  onUpdateShotDurations?: (
    sceneId: string,
    durations: Array<{ duration: string }>
  ) => void;
  showPromptContractDebug?: boolean;
  promptDebugSnapshot?: ScenePromptDebugSnapshot | null;
}

interface SceneThumbnailProps {
  imageUrl: string | null;
  videoUrl?: string | null;
  sceneOrder: number;
  firstFrame: FirstFrame | null;
  background: Background | null;
  videoStatus: string | null;
  hasVideo: boolean;
  onAddToCanvas?: () => void;
  onPreviewImage?: () => void;
  aspectRatio?: string;
  availableBackgrounds?: Map<number, SceneBackgroundOption>;
  onChangeBackground?: (gridPosition: number) => void;
}

const ASPECT_RATIO_CLASSES: Record<string, string> = {
  '9:16': 'aspect-[9/16]',
  '16:9': 'aspect-[16/9]',
  '1:1': 'aspect-square',
};

function SceneThumbnail({
  imageUrl,
  videoUrl,
  sceneOrder,
  firstFrame,
  background,
  videoStatus,
  hasVideo,
  onAddToCanvas,
  onPreviewImage,
  aspectRatio,
  availableBackgrounds,
  onChangeBackground,
}: SceneThumbnailProps) {
  const editStatus =
    firstFrame?.image_edit_status ?? background?.image_edit_status ?? null;
  const isOutpainting = editStatus === 'outpainting';
  const isEnhancing = editStatus === 'enhancing';
  const isCustomEditing = editStatus === 'editing';
  const isProcessingEdit = editStatus === 'processing';
  const isEditFailed = editStatus === 'failed';
  const isGeneratingVideo = videoStatus === 'processing';

  const firstFrameBadgeStatus = firstFrame
    ? isEditFailed
      ? 'failed'
      : isOutpainting || isEnhancing || isCustomEditing || isProcessingEdit
        ? 'processing'
        : firstFrame.status
    : null;

  const thumbRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasVideo && onAddToCanvas) {
      onAddToCanvas();
    } else if (imageUrl && onPreviewImage) {
      onPreviewImage();
    }
  };

  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPreviewImage) {
      onPreviewImage();
    }
  };

  return (
    <div
      ref={thumbRef}
      className={`group/thumb relative ${aspectRatio ? ASPECT_RATIO_CLASSES[aspectRatio] || 'aspect-square' : 'aspect-square'} rounded overflow-hidden bg-background/50 ${imageUrl ? 'cursor-pointer' : ''} ${hasVideo ? 'hover:ring-2 hover:ring-primary/50' : ''}`}
      onClick={handleClick}
    >
      {hasVideo && videoUrl && isVisible ? (
        <video
          src={videoUrl}
          autoPlay
          loop
          muted
          playsInline
          poster={imageUrl || undefined}
          className="absolute inset-0 w-full h-full object-contain"
        />
      ) : imageUrl ? (
        <Image
          src={imageUrl}
          alt={`Scene ${sceneOrder + 1}`}
          fill
          className="object-contain"
          unoptimized
        />
      ) : firstFrame?.status === 'processing' ? (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1">
          <IconLoader2 size={20} className="text-blue-400 animate-spin" />
          <span className="text-[10px] text-blue-300 font-medium">
            Splitting...
          </span>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <IconPhoto size={16} className="text-muted-foreground/50" />
        </div>
      )}
      {isOutpainting && (
        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
          <IconLoader2 size={20} className="text-purple-400 animate-spin" />
          <span className="text-[10px] text-purple-300 font-medium">
            Outpainting...
          </span>
        </div>
      )}
      {isEnhancing && (
        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
          <IconLoader2 size={20} className="text-green-400 animate-spin" />
          <span className="text-[10px] text-green-300 font-medium">
            Enhancing...
          </span>
        </div>
      )}
      {isCustomEditing && (
        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
          <IconLoader2 size={20} className="text-amber-400 animate-spin" />
          <span className="text-[10px] text-amber-300 font-medium">
            Editing...
          </span>
        </div>
      )}
      {isProcessingEdit && (
        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
          <IconLoader2 size={20} className="text-cyan-400 animate-spin" />
          <span className="text-[10px] text-cyan-300 font-medium">
            Generating Frame...
          </span>
        </div>
      )}
      {isEditFailed && (
        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
          <IconAlertTriangle size={20} className="text-red-400" />
          <span className="text-[10px] text-red-300 font-medium">
            Edit Failed
          </span>
        </div>
      )}
      {isGeneratingVideo && (
        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
          <IconLoader2 size={20} className="text-cyan-400 animate-spin" />
          <span className="text-[10px] text-cyan-300 font-medium">
            Generating Video...
          </span>
        </div>
      )}
      {(imageUrl || (hasVideo && videoUrl)) && (
        <button
          type="button"
          onClick={handlePreviewClick}
          className="absolute bottom-1 right-1 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-black/80"
          title={hasVideo ? 'Preview video' : 'Preview image'}
        >
          <IconMaximize size={12} />
        </button>
      )}
      {availableBackgrounds && onChangeBackground && background && (
        <BackgroundPicker
          currentGridPosition={background.grid_position}
          availableBackgrounds={availableBackgrounds}
          onSelect={onChangeBackground}
        />
      )}
      <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/60 rounded text-[10px] font-medium text-white">
        {sceneOrder + 1}
      </div>
      {(firstFrame || hasVideo) && (
        <div className="absolute top-1 right-1 flex items-center gap-1">
          {hasVideo && (
            <div className="px-1.5 py-0.5 bg-cyan-500/80 rounded text-[10px] font-medium text-white flex items-center gap-0.5">
              <IconVideo size={10} />
            </div>
          )}
          {firstFrame && firstFrameBadgeStatus && (
            <StatusBadge status={firstFrameBadgeStatus} size="sm" />
          )}
        </div>
      )}
    </div>
  );
}

interface VoiceoverPlayButtonProps {
  voiceover: Voiceover;
  isPlaying: boolean;
  onToggle: () => void;
}

export function VoiceoverPlayButton({
  voiceover,
  isPlaying,
  onToggle,
}: VoiceoverPlayButtonProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying && voiceover.audio_url) {
      audio.play().catch(console.error);
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [isPlaying, voiceover.audio_url]);

  const handleEnded = () => {
    onToggle();
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/20 hover:bg-blue-500/30 transition-colors"
    >
      {isPlaying ? (
        <IconPlayerPause size={12} className="text-blue-400" />
      ) : (
        <IconPlayerPlay size={12} className="text-blue-400" />
      )}
      {voiceover.audio_url && (
        <audio
          ref={audioRef}
          src={voiceover.audio_url}
          onEnded={handleEnded}
          preload="none"
        />
      )}
    </button>
  );
}

interface ExpandedContentProps {
  voiceover: Voiceover | null;
  displayVoiceover: string | null | undefined;
  displayVisualPrompt: string | null | undefined;
  showVoiceover?: boolean;
  showVisual?: boolean;
  playingVoiceoverId?: string | null;
  setPlayingVoiceoverId?: (id: string | null) => void;
  sceneId: string;
  onReadScene?: (sceneId: string, newVoiceoverText: string) => Promise<void>;
  onTranslateScene?: (sceneId: string, sourceText: string) => Promise<void>;
  onReadSceneAllLanguages?: (
    sceneId: string,
    currentText: string
  ) => Promise<void>;
  onGenerateSceneVideo?: (
    sceneId: string,
    newVisualPrompt: string
  ) => Promise<void>;
  onSaveVisualPrompt?: (sceneId: string, newPrompt: string) => Promise<void>;
  onSaveVoiceoverText?: (sceneId: string, newText: string) => Promise<void>;
  promptLabel?: string;
  hasVideo?: boolean;
  onAddVideoToTimeline?: (sceneId: string) => Promise<void>;
  onAddVoiceoverToTimeline?: (sceneId: string) => Promise<void>;
  isDialogueMode?: boolean;
}

function ExpandedContent({
  voiceover,
  displayVoiceover,
  displayVisualPrompt,
  playingVoiceoverId,
  setPlayingVoiceoverId,
  sceneId,
  onReadScene,
  onTranslateScene,
  onReadSceneAllLanguages,
  onGenerateSceneVideo,
  onSaveVisualPrompt,
  onSaveVoiceoverText,
  promptLabel,
  hasVideo,
  onAddVideoToTimeline,
  onAddVoiceoverToTimeline,
  isDialogueMode: isDialogueModeExpanded,
  showVoiceover = true,
  showVisual = true,
}: ExpandedContentProps) {
  const isPlaying = voiceover ? playingVoiceoverId === voiceover.id : false;
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isEditingVoiceover, setIsEditingVoiceover] = useState(false);
  const [editedVoiceover, setEditedVoiceover] = useState('');
  const [isSavingVoiceover, setIsSavingVoiceover] = useState(false);
  const [isReadingTts, setIsReadingTts] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isReadingAllTts, setIsReadingAllTts] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);

  const handleSaveVoiceover = async () => {
    const trimmed = editedVoiceover.trim();
    setIsEditingVoiceover(false);

    if (trimmed === (displayVoiceover || '').trim()) return;
    if (!onSaveVoiceoverText) return;

    setIsSavingVoiceover(true);
    try {
      await onSaveVoiceoverText(sceneId, trimmed);
    } catch (err) {
      console.error('Failed to save voiceover:', err);
    } finally {
      setIsSavingVoiceover(false);
    }
  };

  const handleSavePrompt = async () => {
    const trimmed = editedPrompt.trim();
    setIsEditingPrompt(false);

    if (trimmed === (displayVisualPrompt || '').trim()) return;
    if (!onSaveVisualPrompt) return;

    setIsSaving(true);
    try {
      await onSaveVisualPrompt(sceneId, trimmed);
    } catch (err) {
      console.error('Failed to save visual prompt:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTogglePlay = () => {
    if (!voiceover || !setPlayingVoiceoverId) return;
    setPlayingVoiceoverId(isPlaying ? null : voiceover.id);
  };

  const renderVoiceoverStatus = () => {
    if (!voiceover) return null;

    if (voiceover.status === 'processing') {
      return (
        <span className="flex items-center gap-1 text-[9px] text-blue-400">
          <IconLoader2 size={10} className="animate-spin" />
          Generating...
        </span>
      );
    }

    if (voiceover.status === 'success' && voiceover.audio_url) {
      return (
        <VoiceoverPlayButton
          voiceover={voiceover}
          isPlaying={isPlaying}
          onToggle={handleTogglePlay}
        />
      );
    }

    if (voiceover.status === 'pending' || voiceover.status === 'failed') {
      return <StatusBadge status={voiceover.status} size="sm" />;
    }

    return null;
  };

  const voiceoverDurationLabel = formatVoiceoverDuration(voiceover?.duration);

  return (
    <div className="mt-2 flex flex-col gap-2">
      {showVoiceover && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <IconMicrophone size={12} className="text-blue-400" />
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
              {isDialogueModeExpanded ? 'Dialogue' : 'Voiceover'}
            </span>
            {renderVoiceoverStatus()}
            {voiceoverDurationLabel && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-300">
                {voiceoverDurationLabel}
              </span>
            )}
            {isSavingVoiceover && (
              <IconLoader2 size={10} className="animate-spin text-blue-400" />
            )}
          </div>
          {isEditingVoiceover ? (
            <div
              className="pl-5 flex flex-col gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <Textarea
                autoFocus
                value={editedVoiceover}
                onChange={(e) => setEditedVoiceover(e.target.value)}
                onBlur={() => {
                  // Delay to allow button clicks to register before blur saves
                  setTimeout(() => {
                    if (!isReadingTts && !isTranslating && !isReadingAllTts)
                      handleSaveVoiceover();
                  }, 150);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsEditingVoiceover(false);
                  }
                }}
                className="text-[11px] min-h-[40px] resize-none p-1.5 bg-background/50 border-blue-400/30 focus-visible:border-blue-400/50"
                placeholder="Voiceover text..."
              />
              {(onReadScene || onTranslateScene || onReadSceneAllLanguages) && (
                <div className="flex justify-end gap-1">
                  {onTranslateScene && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2"
                      disabled={
                        isReadingTts || isTranslating || isReadingAllTts
                      }
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setIsTranslating(true);
                        onTranslateScene(sceneId, editedVoiceover).finally(
                          () => {
                            setIsTranslating(false);
                          }
                        );
                      }}
                    >
                      {isTranslating ? (
                        <IconLoader2 size={10} className="animate-spin mr-1" />
                      ) : (
                        <IconSwitchHorizontal size={10} className="mr-1" />
                      )}
                      Translate
                    </Button>
                  )}
                  {onReadScene && (
                    <Button
                      size="sm"
                      variant="default"
                      className="h-6 text-[10px] px-2"
                      disabled={
                        isReadingTts || isTranslating || isReadingAllTts
                      }
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setIsReadingTts(true);
                        onReadScene(sceneId, editedVoiceover).finally(() => {
                          setIsReadingTts(false);
                          setIsEditingVoiceover(false);
                        });
                      }}
                    >
                      {isReadingTts ? (
                        <IconLoader2 size={10} className="animate-spin mr-1" />
                      ) : (
                        <IconMicrophone size={10} className="mr-1" />
                      )}
                      Read
                    </Button>
                  )}
                  {onReadSceneAllLanguages && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-6 text-[10px] px-2"
                      disabled={
                        isReadingTts || isTranslating || isReadingAllTts
                      }
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setIsReadingAllTts(true);
                        onReadSceneAllLanguages(
                          sceneId,
                          editedVoiceover
                        ).finally(() => {
                          setIsReadingAllTts(false);
                          setIsEditingVoiceover(false);
                        });
                      }}
                    >
                      {isReadingAllTts ? (
                        <IconLoader2 size={10} className="animate-spin mr-1" />
                      ) : (
                        <IconVolume size={10} className="mr-1" />
                      )}
                      Read ALL
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p
              className={`text-[11px] text-foreground/80 leading-relaxed pl-5 ${onSaveVoiceoverText ? 'cursor-pointer hover:text-foreground hover:bg-secondary/30 rounded transition-colors' : ''}`}
              onClick={(e) => {
                if (!onSaveVoiceoverText) return;
                e.stopPropagation();
                setEditedVoiceover(displayVoiceover || '');
                setIsEditingVoiceover(true);
              }}
              title={onSaveVoiceoverText ? 'Click to edit' : undefined}
            >
              {displayVoiceover || (
                <span className="italic text-muted-foreground">
                  {isDialogueModeExpanded ? 'No dialogue' : 'No voiceover'}
                </span>
              )}
            </p>
          )}
        </div>
      )}
      {showVisual && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <IconEye size={12} className="text-purple-400" />
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
              {promptLabel ?? 'Visual'}
            </span>
            {isSaving && (
              <IconLoader2 size={10} className="animate-spin text-purple-400" />
            )}
          </div>
          {isEditingPrompt ? (
            <div
              className="pl-5 flex flex-col gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <Textarea
                autoFocus
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                onBlur={() => {
                  setTimeout(() => {
                    if (!isGeneratingVideo) handleSavePrompt();
                  }, 150);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsEditingPrompt(false);
                  }
                }}
                className="text-[11px] min-h-[40px] resize-none p-1.5 bg-background/50 border-purple-400/30 focus-visible:border-purple-400/50"
                placeholder="Visual prompt..."
              />
              {onGenerateSceneVideo && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-6 text-[10px] px-2"
                    disabled={isGeneratingVideo}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setIsGeneratingVideo(true);
                      onGenerateSceneVideo(sceneId, editedPrompt).finally(
                        () => {
                          setIsGeneratingVideo(false);
                          setIsEditingPrompt(false);
                        }
                      );
                    }}
                  >
                    {isGeneratingVideo ? (
                      <IconLoader2 size={10} className="animate-spin mr-1" />
                    ) : (
                      <IconVideo size={10} className="mr-1" />
                    )}
                    Generate Video
                  </Button>
                </div>
              )}
            </div>
          ) : parseMultiShotPrompt(displayVisualPrompt) ? (
            <div
              className={`pl-5 flex flex-col gap-1 ${onSaveVisualPrompt ? 'cursor-pointer hover:bg-secondary/30 rounded transition-colors' : ''}`}
              onClick={(e) => {
                if (!onSaveVisualPrompt) return;
                e.stopPropagation();
                setEditedPrompt(displayVisualPrompt || '');
                setIsEditingPrompt(true);
              }}
              title={onSaveVisualPrompt ? 'Click to edit' : undefined}
            >
              <span className="text-[9px] text-cyan-500 font-medium">
                {parseMultiShotPrompt(displayVisualPrompt)!.length}-shot
              </span>
              {parseMultiShotPrompt(displayVisualPrompt)!.map((shot, i) => (
                <p
                  key={i}
                  className="text-[11px] text-foreground/60 leading-relaxed"
                >
                  <span className="text-muted-foreground font-medium">
                    {i + 1}.{' '}
                  </span>
                  {shot}
                </p>
              ))}
            </div>
          ) : (
            <p
              className={`text-[11px] text-foreground/60 leading-relaxed pl-5 ${onSaveVisualPrompt ? 'cursor-pointer hover:text-foreground/80 hover:bg-secondary/30 rounded transition-colors' : ''}`}
              onClick={(e) => {
                if (!onSaveVisualPrompt) return;
                e.stopPropagation();
                setEditedPrompt(displayVisualPrompt || '');
                setIsEditingPrompt(true);
              }}
              title={onSaveVisualPrompt ? 'Click to edit' : undefined}
            >
              {displayVisualPrompt || (
                <span className="italic text-muted-foreground">
                  No visual prompt
                </span>
              )}
            </p>
          )}
        </div>
      )}
      {/* Timeline actions */}
      {(hasVideo ||
        (voiceover?.status === 'success' && voiceover?.audio_url)) && (
        <div className="flex items-center gap-1.5 pt-1 border-t border-border/20">
          <span className="text-[9px] text-muted-foreground uppercase tracking-wide flex-shrink-0">
            Timeline
          </span>
          {hasVideo && onAddVideoToTimeline && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] px-2"
              onClick={(e) => {
                e.stopPropagation();
                onAddVideoToTimeline(sceneId);
              }}
              title="Add video only to timeline"
            >
              <IconVideo size={10} className="mr-1" />
              Video
            </Button>
          )}
          {showVoiceover &&
            !isDialogueModeExpanded &&
            voiceover?.status === 'success' &&
            voiceover?.audio_url &&
            onAddVoiceoverToTimeline && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px] px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddVoiceoverToTimeline(sceneId);
                }}
                title="Add voiceover only to timeline"
              >
                <IconMicrophone size={10} className="mr-1" />
                Voiceover
              </Button>
            )}
        </div>
      )}
      <div className="flex justify-center">
        <IconChevronDown
          size={12}
          className="text-muted-foreground rotate-180"
        />
      </div>
    </div>
  );
}

function ObjectsRow({
  objects,
  assetImageMap,
}: {
  objects: RefObject[];
  assetImageMap: AssetImageMap;
}) {
  const sorted = [...objects].sort((a, b) => a.scene_order - b.scene_order);
  const [previewObj, setPreviewObj] = useState<RefObject | null>(null);
  const previewSrc = previewObj
    ? resolveAssetImageUrl(previewObj, assetImageMap)
    : null;

  return (
    <>
      <div className="mt-1.5 flex items-start gap-2 overflow-x-auto">
        {sorted.map((obj) => {
          const imgSrc = resolveAssetImageUrl(obj, assetImageMap);
          const initial = obj.name?.charAt(0)?.toUpperCase() ?? '?';
          const needsPrompt = !obj.series_asset_variant_id;
          const hasPrompt = Boolean(obj.generation_prompt?.trim());

          return (
            <div
              key={obj.id}
              className="flex flex-col items-center gap-0.5 flex-shrink-0"
            >
              <div
                className={`relative w-7 h-7 rounded-full overflow-hidden bg-background/50 border cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all ${
                  obj.status === 'failed'
                    ? 'border-red-500/60'
                    : 'border-border/40'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewObj(obj);
                }}
                title={`${obj.name} — ${needsPrompt ? (hasPrompt ? 'prompt ready' : 'prompt missing') : 'series asset mapped'} — click to enlarge`}
              >
                {imgSrc ? (
                  <Image
                    src={imgSrc}
                    alt={obj.name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                    {initial}
                  </div>
                )}
                <div
                  className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full border border-black/20 ${
                    needsPrompt
                      ? hasPrompt
                        ? 'bg-emerald-400'
                        : 'bg-amber-400'
                      : 'bg-cyan-400'
                  }`}
                />
                {obj.status === 'processing' && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <IconLoader2
                      size={12}
                      className="text-blue-400 animate-spin"
                    />
                  </div>
                )}
                {obj.image_edit_status === 'outpainting' && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <IconLoader2
                      size={12}
                      className="text-purple-400 animate-spin"
                    />
                  </div>
                )}
                {obj.image_edit_status === 'enhancing' && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <IconLoader2
                      size={12}
                      className="text-green-400 animate-spin"
                    />
                  </div>
                )}
                {obj.image_edit_status === 'editing' && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <IconLoader2
                      size={12}
                      className="text-amber-400 animate-spin"
                    />
                  </div>
                )}
                {obj.image_edit_status === 'processing' && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <IconLoader2
                      size={12}
                      className="text-cyan-400 animate-spin"
                    />
                  </div>
                )}
                {obj.image_edit_status === 'failed' && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <IconAlertTriangle size={12} className="text-red-400" />
                  </div>
                )}
              </div>
              <span className="text-[9px] text-muted-foreground truncate max-w-[40px]">
                {obj.name}
              </span>
            </div>
          );
        })}
      </div>

      {/* Expandable asset preview dialog */}
      <Dialog
        open={!!previewObj}
        onOpenChange={(open) => !open && setPreviewObj(null)}
      >
        <DialogContent
          className="max-w-md p-4 bg-black/90 border-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogTitle className="text-sm font-medium text-white">
            {previewObj?.name}
          </DialogTitle>
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={previewObj?.name ?? 'Asset preview'}
              className="w-full h-auto max-h-[70vh] object-contain rounded"
            />
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              No image available
            </div>
          )}
          {previewObj?.description && (
            <p className="text-xs text-muted-foreground mt-2">
              {previewObj.description}
            </p>
          )}
          <div className="mt-2 space-y-1 text-xs">
            <div>
              <span className="text-cyan-300">Generation prompt:</span>{' '}
              <span className="text-muted-foreground">
                {previewObj?.generation_prompt?.trim() || 'No prompt saved'}
              </span>
            </div>
            {previewObj?.feedback && (
              <div className="text-amber-300">
                Feedback: {previewObj.feedback}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BackgroundPicker({
  currentGridPosition,
  availableBackgrounds,
  onSelect,
}: {
  currentGridPosition: number;
  availableBackgrounds: Map<number, SceneBackgroundOption>;
  onSelect: (gridPosition: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const entries = [...availableBackgrounds.entries()].sort(([a], [b]) => a - b);

  if (entries.length <= 1) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-1 left-1 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-black/80 z-10"
          title="Change background"
        >
          <IconSwitchHorizontal size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto max-w-[280px] p-2"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
          Choose Background
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {entries.map(([pos, bg]) => {
            const isCurrent = pos === currentGridPosition;
            return (
              <button
                key={pos}
                type="button"
                disabled={isCurrent}
                onClick={() => {
                  onSelect(pos);
                  setOpen(false);
                }}
                className={`flex flex-col items-center gap-1 p-1 rounded transition-colors ${
                  isCurrent
                    ? 'ring-2 ring-primary bg-primary/10 opacity-60 cursor-default'
                    : 'hover:bg-secondary/50 cursor-pointer'
                }`}
              >
                <div className="relative w-16 h-16 rounded overflow-hidden bg-secondary/50">
                  <img
                    src={bg.final_url || bg.url}
                    alt={bg.name}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                </div>
                <span className="text-[9px] text-muted-foreground truncate max-w-[64px]">
                  {bg.name}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeCompileStatus(value: unknown): 'ready' | 'blocked' | null {
  if (value === 'ready' || value === 'blocked') {
    return value;
  }
  return null;
}

function normalizePromptSource(value: unknown): ScenePromptSource | null {
  if (
    value === 'prompt_contract' ||
    value === 'multi_prompt' ||
    value === 'prompt' ||
    value === 'none'
  ) {
    return value;
  }
  return null;
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatLogTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

interface PromptContractDebugPanelProps {
  promptJson: unknown;
  validatedRuntime: unknown;
  compiledPrompt: string | null;
  compileStatus: 'ready' | 'blocked' | null;
  promptSource: ScenePromptSource | null;
  resolvedAssetRefs: unknown[] | null;
  referenceImages: unknown[] | null;
  latestLogAt: string | null;
  hasData: boolean;
  legacyPrompt: string | null;
  promptContractActive: boolean;
}

function PromptContractDebugPanel({
  promptJson,
  validatedRuntime,
  compiledPrompt,
  compileStatus,
  promptSource,
  resolvedAssetRefs,
  referenceImages,
  latestLogAt,
  hasData,
  legacyPrompt,
  promptContractActive,
}: PromptContractDebugPanelProps) {
  const formattedLogAt = formatLogTimestamp(latestLogAt);
  const promptJsonRecord = toRecord(promptJson);
  const validatedRuntimeRecord = toRecord(validatedRuntime);

  const sceneIntentRecord = toRecord(promptJsonRecord?.desired_scene_intent);
  const canonicalPromptText = toNonEmptyString(
    promptJsonRecord?.canonical_prompt_text
  );
  const desiredAssetRefs = toRecordArray(promptJsonRecord?.desired_asset_refs);

  const validatedReuse = toRecordArray(validatedRuntimeRecord?.validated_reuse);
  const validatedMissingAssets = toRecordArray(
    validatedRuntimeRecord?.validated_missing_assets
  );
  const blockingIssues = toRecordArray(validatedRuntimeRecord?.blocking_issues);

  const resolvedAssetRefItems = toRecordArray(resolvedAssetRefs);
  const referenceImageItems = toRecordArray(referenceImages);

  const hasExecutionResolution = resolvedAssetRefItems.length > 0;
  const resolvedCount = hasExecutionResolution
    ? resolvedAssetRefItems.filter((item) => item.resolution === 'resolved')
        .length
    : validatedReuse.length;
  const missingCount = hasExecutionResolution
    ? resolvedAssetRefItems.filter((item) => item.resolution === 'missing')
        .length
    : validatedMissingAssets.length;
  const blockingCount = blockingIssues.length;

  const sceneIntentSummary = [
    {
      label: 'Narrative beat',
      value: toNonEmptyString(sceneIntentRecord?.narrative_beat),
    },
    {
      label: 'Visual goal',
      value: toNonEmptyString(sceneIntentRecord?.visual_goal),
    },
    {
      label: 'Emotional tone',
      value: toNonEmptyString(sceneIntentRecord?.emotional_tone),
    },
    {
      label: 'Camera intent',
      value: toNonEmptyString(sceneIntentRecord?.camera_intent),
    },
  ];

  return (
    <details
      className="mt-2 rounded border border-amber-500/25 bg-amber-500/5 px-2 py-1.5"
      onClick={(event) => event.stopPropagation()}
    >
      <summary className="cursor-pointer text-[10px] font-medium text-amber-300 tracking-wide uppercase">
        Debug Inspector · Prompt Contract
      </summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[9px] px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-200 border-amber-500/30">
            Source: {promptSource ?? 'n/a'}
          </span>
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded border ${
              compileStatus === 'ready'
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : compileStatus === 'blocked'
                  ? 'bg-red-500/10 text-red-300 border-red-500/30'
                  : 'bg-muted/30 text-muted-foreground border-border/40'
            }`}
          >
            Compile: {compileStatus ?? 'n/a'}
          </span>
          {formattedLogAt && (
            <span className="text-[9px] text-muted-foreground">
              Latest generation log: {formattedLogAt}
            </span>
          )}
        </div>

        {!hasData ? (
          <p className="text-[10px] text-muted-foreground">
            No prompt-contract debug data found on scene state or logs.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="rounded border border-border/40 bg-background/40 p-2 space-y-1.5">
              <div className="text-[10px] font-medium text-foreground/85 uppercase tracking-wide">
                Plan summary
              </div>
              {sceneIntentSummary.map((item) => (
                <div
                  key={item.label}
                  className="text-[10px] text-foreground/80"
                >
                  <span className="text-muted-foreground">{item.label}:</span>{' '}
                  {item.value ?? (
                    <span className="text-muted-foreground/80">n/a</span>
                  )}
                </div>
              ))}
              <div className="text-[10px] text-foreground/80">
                <span className="text-muted-foreground">
                  Desired assets ({desiredAssetRefs.length}):
                </span>{' '}
                {desiredAssetRefs.length === 0 ? (
                  <span className="text-muted-foreground/80">none</span>
                ) : (
                  desiredAssetRefs
                    .slice(0, 4)
                    .map((item) => {
                      const slot = toNonEmptyString(item.slot) ?? 'slot?';
                      const role = toNonEmptyString(item.role) ?? 'unknown';
                      const slug =
                        toNonEmptyString(item.desired_asset_slug) ?? 'slug?';
                      return `${slot} (${role}) -> ${slug}`;
                    })
                    .join(' · ')
                )}
              </div>
              {canonicalPromptText && (
                <div className="text-[10px] text-foreground/80 line-clamp-3">
                  <span className="text-muted-foreground">Canonical text:</span>{' '}
                  {canonicalPromptText}
                </div>
              )}
            </div>

            <div className="rounded border border-border/40 bg-background/40 p-2 space-y-1.5">
              <div className="text-[10px] font-medium text-foreground/85 uppercase tracking-wide">
                Validation summary
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                  Resolved: {resolvedCount}
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">
                  Missing: {missingCount}
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-300">
                  Blocking: {blockingCount}
                </span>
              </div>
              {missingCount > 0 && (
                <div className="text-[10px] text-foreground/80">
                  <span className="text-muted-foreground">Missing slots:</span>{' '}
                  {validatedMissingAssets.length > 0
                    ? validatedMissingAssets
                        .slice(0, 5)
                        .map(
                          (item) =>
                            toNonEmptyString(item.slot) ??
                            toNonEmptyString(item.desired_asset_slug) ??
                            'unknown'
                        )
                        .join(', ')
                    : resolvedAssetRefItems
                        .filter((item) => item.resolution === 'missing')
                        .slice(0, 5)
                        .map(
                          (item) =>
                            toNonEmptyString(item.slot) ??
                            toNonEmptyString(item.desired_asset_slug) ??
                            'unknown'
                        )
                        .join(', ')}
                </div>
              )}
              {blockingCount > 0 && (
                <div className="text-[10px] text-red-300/90">
                  {blockingIssues
                    .slice(0, 3)
                    .map(
                      (issue) =>
                        toNonEmptyString(issue.message) ??
                        toNonEmptyString(issue.code) ??
                        'blocking issue'
                    )
                    .join(' · ')}
                </div>
              )}
            </div>

            <div className="rounded border border-border/40 bg-background/40 p-2 space-y-1.5">
              <div className="text-[10px] font-medium text-foreground/85 uppercase tracking-wide">
                Execution summary
              </div>
              <pre className="max-h-28 overflow-auto rounded border border-border/40 bg-background/50 p-2 text-[10px] text-foreground/80 whitespace-pre-wrap break-all">
                {compiledPrompt ?? 'null'}
              </pre>
              <div className="text-[10px] text-foreground/80">
                <span className="text-muted-foreground">
                  Reference images ({referenceImageItems.length}):
                </span>{' '}
                {referenceImageItems.length === 0
                  ? 'none'
                  : referenceImageItems
                      .slice(0, 4)
                      .map((item) => {
                        const slot = toNonEmptyString(item.slot) ?? 'slot?';
                        const slug =
                          toNonEmptyString(item.asset_slug) ?? 'slug?';
                        const hasUrl = Boolean(
                          toNonEmptyString(item.image_url)
                        );
                        return `${slot} (${slug})${hasUrl ? '' : ' - no url'}`;
                      })
                      .join(' · ')}
              </div>
              {promptContractActive && legacyPrompt && (
                <div className="text-[10px] rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-200">
                  Legacy `scene.prompt` detected; it is treated as debug-only
                  while prompt contract execution is active.
                </div>
              )}
            </div>

            <details className="rounded border border-border/40 bg-background/30 px-2 py-1.5">
              <summary className="cursor-pointer text-[10px] font-medium text-foreground/80">
                Raw JSON
              </summary>
              <div className="mt-2 space-y-2">
                <div>
                  <div className="text-[10px] font-medium text-foreground/85 mb-1">
                    prompt_json
                  </div>
                  <pre className="max-h-32 overflow-auto rounded border border-border/40 bg-background/50 p-2 text-[10px] text-foreground/75 whitespace-pre-wrap break-all">
                    {promptJson ? toPrettyJson(promptJson) : 'null'}
                  </pre>
                </div>
                <div>
                  <div className="text-[10px] font-medium text-foreground/85 mb-1">
                    validated_runtime
                  </div>
                  <pre className="max-h-32 overflow-auto rounded border border-border/40 bg-background/50 p-2 text-[10px] text-foreground/75 whitespace-pre-wrap break-all">
                    {validatedRuntime ? toPrettyJson(validatedRuntime) : 'null'}
                  </pre>
                </div>
                <div>
                  <div className="text-[10px] font-medium text-foreground/85 mb-1">
                    resolved_asset_refs
                  </div>
                  <pre className="max-h-32 overflow-auto rounded border border-border/40 bg-background/50 p-2 text-[10px] text-foreground/75 whitespace-pre-wrap break-all">
                    {resolvedAssetRefs
                      ? toPrettyJson(resolvedAssetRefs)
                      : 'null'}
                  </pre>
                </div>
                <div>
                  <div className="text-[10px] font-medium text-foreground/85 mb-1">
                    reference_images
                  </div>
                  <pre className="max-h-32 overflow-auto rounded border border-border/40 bg-background/50 p-2 text-[10px] text-foreground/75 whitespace-pre-wrap break-all">
                    {referenceImages ? toPrettyJson(referenceImages) : 'null'}
                  </pre>
                </div>
              </div>
            </details>
          </div>
        )}
      </div>
    </details>
  );
}

export function SceneCard({
  scene,
  showVoiceover = true,
  showVisual = true,
  isSelected,
  onSelectionChange,
  playingVoiceoverId,
  setPlayingVoiceoverId,
  onReadScene,
  onTranslateScene,
  onReadSceneAllLanguages,
  onGenerateSceneVideo,
  onSaveVisualPrompt,
  onSaveVoiceoverText,
  promptLabel,
  promptOverride,
  selectedLanguage = 'en',
  isRefMode,
  isTarget,
  onSetTarget,
  aspectRatio,
  onAddVideoToTimeline,
  onAddVoiceoverToTimeline,
  availableBackgrounds,
  assetImageMap = {},
  onChangeBackground,
  isDialogueMode,
  onUpdateShotDurations,
  showPromptContractDebug = false,
  promptDebugSnapshot = null,
}: SceneCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { studio } = useStudioStore();
  const firstFrame = scene.first_frames?.[0] ?? null;
  const background = scene.backgrounds?.[0] ?? null;
  const voiceover =
    scene.voiceovers?.find((v) => v.language === selectedLanguage) ?? null;
  const imageUrl = firstFrame
    ? (firstFrame.final_url ??
      firstFrame.url ??
      firstFrame.out_padded_url ??
      null)
    : resolveAssetImageUrl(background, assetImageMap);
  const displayVoiceover = voiceover?.text;
  // For ref_to_video scenes, prefer explicit override (first-frame prompt), then multi_prompt, then scene/first-frame prompt.
  const displayVisualPrompt =
    promptOverride ??
    (scene.multi_prompt && scene.multi_prompt.length > 0
      ? JSON.stringify(scene.multi_prompt)
      : (firstFrame?.visual_prompt ?? scene.prompt));
  const generationMetaRecord = toRecord(scene.generation_meta);
  const promptContractRecord = toRecord(generationMetaRecord?.prompt_contract);
  const promptJsonDebug =
    scene.prompt_json ?? promptContractRecord?.prompt_json;
  const validatedRuntimeDebug =
    scene.validated_runtime ?? promptContractRecord?.validated_runtime;
  const compiledPromptDebug =
    scene.compiled_prompt ??
    (typeof promptContractRecord?.compiled_prompt === 'string'
      ? promptContractRecord.compiled_prompt
      : null);
  const compileStatusDebug =
    scene.compile_status ??
    normalizeCompileStatus(promptContractRecord?.compile_status) ??
    promptDebugSnapshot?.compile_status ??
    normalizeCompileStatus(
      generationMetaRecord?.prompt_contract_compile_status
    );
  const promptSourceDebug =
    promptDebugSnapshot?.prompt_source ??
    normalizePromptSource(generationMetaRecord?.prompt_source);
  const resolvedAssetRefsDebug =
    scene.resolved_asset_refs ??
    (Array.isArray(promptContractRecord?.resolved_asset_refs)
      ? promptContractRecord.resolved_asset_refs
      : null) ??
    promptDebugSnapshot?.resolved_asset_refs ??
    (Array.isArray(generationMetaRecord?.prompt_contract_resolved_asset_refs)
      ? generationMetaRecord.prompt_contract_resolved_asset_refs
      : null);
  const referenceImagesDebug =
    scene.reference_images ??
    (Array.isArray(promptContractRecord?.reference_images)
      ? promptContractRecord.reference_images
      : null) ??
    promptDebugSnapshot?.reference_images ??
    (Array.isArray(generationMetaRecord?.prompt_contract_reference_images)
      ? generationMetaRecord.prompt_contract_reference_images
      : null);
  const hasPromptContractDebugData =
    promptJsonDebug !== undefined ||
    validatedRuntimeDebug !== undefined ||
    compiledPromptDebug !== null ||
    compileStatusDebug !== null ||
    promptSourceDebug !== null ||
    resolvedAssetRefsDebug !== null ||
    referenceImagesDebug !== null;
  const compiledPromptForDisplay = toNonEmptyString(compiledPromptDebug);
  const legacyScenePrompt = toNonEmptyString(scene.prompt);
  const promptContractActive =
    promptSourceDebug === 'prompt_contract' || compileStatusDebug === 'ready';
  const shouldPreferCompiledPrompt = promptContractActive;
  const hasMultiShotPrompt =
    !shouldPreferCompiledPrompt &&
    Boolean(scene.multi_prompt && scene.multi_prompt.length > 1);
  const multiShotPrompts = hasMultiShotPrompt ? (scene.multi_prompt ?? []) : [];
  const multiShotCount = multiShotPrompts.length;
  const primaryVideoPrompt = shouldPreferCompiledPrompt
    ? compiledPromptForDisplay
    : (toNonEmptyString(scene.multi_prompt?.[0]) ?? legacyScenePrompt);
  const primaryVideoPromptFallback = shouldPreferCompiledPrompt
    ? 'Execution prompt not available yet'
    : 'No prompt';
  const primaryVideoPromptPreview = primaryVideoPrompt
    ? `${primaryVideoPrompt.slice(0, 50)}${primaryVideoPrompt.length > 50 ? '...' : ''}`
    : null;
  const promptPreviewForMediaFallback = shouldPreferCompiledPrompt
    ? (compiledPromptForDisplay ?? primaryVideoPromptFallback)
    : formatPromptPreview(scene.prompt, scene.multi_prompt);

  const handleAddToCanvas = async () => {
    if (!studio || !scene.video_url) return;
    try {
      // Calculate where the next clip should start (after all existing clips)
      const lastClipEnd = studio.clips.reduce((max, c) => {
        const end =
          c.display.to > 0 ? c.display.to : c.display.from + c.duration;
        return end > max ? end : max;
      }, 0);

      // Estimate clip duration for overlap check (will be refined by addSceneToTimeline)
      const estimatedEnd = lastClipEnd + 10; // conservative estimate
      const existingVideoTrack = findCompatibleTrack(
        studio,
        'Video',
        lastClipEnd,
        estimatedEnd
      );
      const existingAudioTrack = findCompatibleTrack(
        studio,
        'Audio',
        lastClipEnd,
        estimatedEnd
      );

      await addSceneToTimeline(
        studio,
        {
          videoUrl: scene.video_url,
          voiceover:
            voiceover?.status === 'success' && voiceover?.audio_url
              ? { audioUrl: voiceover.audio_url }
              : null,
        },
        {
          startTime: lastClipEnd,
          videoTrackId: existingVideoTrack?.id,
          audioTrackId: existingAudioTrack?.id,
        }
      );
    } catch (error) {
      console.error('Failed to add scene media to canvas:', error);
    }
  };

  const hasVideo = scene.video_status === 'success' && !!scene.video_url;

  const totalSceneObjects = scene.objects?.length ?? 0;
  const mappedSceneObjects = (scene.objects ?? []).filter(
    (object) => !!object.series_asset_variant_id
  ).length;
  const totalSceneBackgrounds = scene.backgrounds?.length ?? 0;
  const mappedSceneBackgrounds = (scene.backgrounds ?? []).filter(
    (background) => !!background.series_asset_variant_id
  ).length;
  const missingAssetLinksCount =
    totalSceneObjects -
    mappedSceneObjects +
    (totalSceneBackgrounds - mappedSceneBackgrounds);

  const missingObjectNames = Array.from(
    new Set(
      (scene.objects ?? [])
        .filter((object) => !object.series_asset_variant_id)
        .map((object) => object.name)
        .filter((name): name is string => typeof name === 'string' && !!name)
    )
  );

  const missingBackgroundNames = Array.from(
    new Set(
      (scene.backgrounds ?? [])
        .filter((background) => !background.series_asset_variant_id)
        .map((background) => background.name)
        .filter((name): name is string => typeof name === 'string' && !!name)
    )
  );

  const backgroundPromptPreview = background?.generation_prompt?.trim()
    ? `${background.generation_prompt.slice(0, 80)}${background.generation_prompt.length > 80 ? '…' : ''}`
    : null;

  const voiceoverPreview = displayVoiceover
    ? displayVoiceover.slice(0, 35) +
      (displayVoiceover.length > 35 ? '...' : '')
    : null;

  const collapsedVoiceoverDurationLabel = formatVoiceoverDuration(
    voiceover?.duration
  );

  const hasVideoPrompt = shouldPreferCompiledPrompt
    ? Boolean(primaryVideoPrompt)
    : Boolean(
        primaryVideoPrompt ||
          (scene.multi_prompt ?? []).some((prompt) => prompt.trim().length > 0)
      );

  const hasVoiceoverPrompt = Boolean(voiceover?.text?.trim());

  const requiredObjectsForPrompt = (scene.objects ?? []).filter(
    (obj) => !obj.series_asset_variant_id
  );
  const missingObjectPromptCount = requiredObjectsForPrompt.filter(
    (obj) => !obj.generation_prompt?.trim()
  ).length;

  const requiredBackgroundsForPrompt = (scene.backgrounds ?? []).filter(
    (bg) => !bg.series_asset_variant_id
  );
  const missingBackgroundPromptCount = requiredBackgroundsForPrompt.filter(
    (bg) => !bg.generation_prompt?.trim()
  ).length;

  const missingAssetPromptCount =
    missingObjectPromptCount + missingBackgroundPromptCount;

  const feedbackItems = [
    scene.feedback ? `Scene: ${scene.feedback}` : null,
    voiceover?.feedback ? `Voiceover: ${voiceover.feedback}` : null,
    ...(scene.objects ?? [])
      .filter((obj) => !!obj.feedback)
      .slice(0, 2)
      .map((obj) => `Object (${obj.name}): ${obj.feedback}`),
    ...(scene.backgrounds ?? [])
      .filter((bg) => !!bg.feedback)
      .slice(0, 1)
      .map((bg) => `Background (${bg.name}): ${bg.feedback}`),
  ].filter((item): item is string => Boolean(item));

  const showSelection = onSelectionChange !== undefined;
  const isPlaying = voiceover ? playingVoiceoverId === voiceover.id : false;

  const handleTogglePlay = () => {
    if (!voiceover || !setPlayingVoiceoverId) return;
    setPlayingVoiceoverId(isPlaying ? null : voiceover.id);
  };

  const renderCollapsedVoiceoverStatus = () => {
    if (!voiceover) return null;

    if (voiceover.status === 'processing') {
      return (
        <span className="flex items-center gap-1 text-[9px] text-blue-400 flex-shrink-0">
          <IconLoader2 size={10} className="animate-spin" />
          Generating...
        </span>
      );
    }

    if (voiceover.status === 'success' && voiceover.audio_url) {
      return (
        <VoiceoverPlayButton
          voiceover={voiceover}
          isPlaying={isPlaying}
          onToggle={handleTogglePlay}
        />
      );
    }

    return null;
  };

  return (
    <div
      className={`p-2 bg-secondary/30 rounded-md cursor-pointer hover:bg-secondary/50 transition-all ${
        isTarget
          ? 'ring-2 ring-amber-500 ring-offset-1 ring-offset-background'
          : isSelected
            ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
            : ''
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex justify-between items-center mb-1">
        {showSelection && (
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => onSelectionChange(checked === true)}
              className="data-[state=checked]:bg-primary"
            />
          </div>
        )}
        {isRefMode && onSetTarget && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSetTarget(scene.id);
            }}
            className={`p-0.5 rounded transition-colors ${isTarget ? 'bg-amber-500/20' : 'hover:bg-secondary/80'}`}
            title={isTarget ? 'Target scene' : 'Set as target'}
          >
            <IconTarget
              size={14}
              className={isTarget ? 'text-amber-500' : 'text-muted-foreground'}
            />
          </button>
        )}
      </div>

      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded border ${hasVideoPrompt ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}
          title={hasVideoPrompt ? 'Video prompt ready' : 'Video prompt missing'}
        >
          Prompt {hasVideoPrompt ? '●' : '○'}
        </span>
        {showVoiceover && (
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded border ${hasVoiceoverPrompt ? 'bg-blue-500/10 text-blue-300 border-blue-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}
            title={
              hasVoiceoverPrompt
                ? 'Voiceover text ready'
                : 'Voiceover text missing'
            }
          >
            Voice {hasVoiceoverPrompt ? '●' : '○'}
          </span>
        )}
        {(requiredObjectsForPrompt.length > 0 ||
          requiredBackgroundsForPrompt.length > 0) && (
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded border ${missingAssetPromptCount === 0 ? 'bg-violet-500/10 text-violet-300 border-violet-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}
            title={
              missingAssetPromptCount === 0
                ? 'All asset prompts ready'
                : `${missingAssetPromptCount} asset prompt(s) missing`
            }
          >
            Assets{' '}
            {missingAssetPromptCount === 0
              ? '●'
              : `○ ${missingAssetPromptCount}`}
          </span>
        )}
      </div>

      {feedbackItems.length > 0 && (
        <div className="mb-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300 space-y-0.5">
          {feedbackItems.slice(0, 2).map((feedback) => (
            <p key={feedback} className="line-clamp-1">
              {feedback}
            </p>
          ))}
          {feedbackItems.length > 2 && (
            <p className="text-[9px] text-amber-200/80">
              +{feedbackItems.length - 2} more feedback item(s)
            </p>
          )}
        </div>
      )}

      {firstFrame || imageUrl ? (
        <SceneThumbnail
          imageUrl={imageUrl}
          videoUrl={scene.video_url}
          sceneOrder={scene.order}
          firstFrame={firstFrame}
          background={background}
          videoStatus={scene.video_status}
          hasVideo={hasVideo}
          onAddToCanvas={hasVideo ? handleAddToCanvas : undefined}
          onPreviewImage={() => setPreviewOpen(true)}
          aspectRatio={aspectRatio}
          availableBackgrounds={availableBackgrounds}
          onChangeBackground={
            onChangeBackground
              ? (pos) => onChangeBackground(scene.id, pos)
              : undefined
          }
        />
      ) : (
        /* Ref-to-video scene: no first_frame — show background or placeholder */
        <div
          className={`group/thumb relative ${aspectRatio ? ASPECT_RATIO_CLASSES[aspectRatio] || 'aspect-square' : 'aspect-square'} rounded overflow-hidden ${imageUrl ? '' : 'bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-border/30'} ${hasVideo ? 'cursor-pointer hover:ring-2 hover:ring-primary/50' : ''}`}
          onClick={hasVideo ? handleAddToCanvas : undefined}
        >
          {imageUrl ? (
            <>
              {hasVideo && scene.video_url ? (
                <video
                  src={scene.video_url}
                  autoPlay
                  loop
                  muted
                  playsInline
                  poster={imageUrl || undefined}
                  className="absolute inset-0 w-full h-full object-contain"
                />
              ) : (
                <Image
                  src={imageUrl}
                  alt={`Scene ${scene.order + 1}`}
                  fill
                  className="object-contain"
                  unoptimized
                />
              )}
              <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/60 rounded text-[10px] font-medium text-white">
                {scene.order + 1}
              </div>
              {hasVideo && (
                <div className="absolute top-1 right-1">
                  <div className="px-1.5 py-0.5 bg-cyan-500/80 rounded text-[10px] font-medium text-white flex items-center gap-0.5">
                    <IconVideo size={10} />
                  </div>
                </div>
              )}
              {scene.video_status === 'processing' && !scene.video_url && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
                  <IconLoader2
                    size={20}
                    className="text-cyan-400 animate-spin"
                  />
                  <span className="text-[10px] text-cyan-300 font-medium">
                    Generating Video...
                  </span>
                </div>
              )}
              {background?.image_edit_status === 'outpainting' && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
                  <IconLoader2
                    size={20}
                    className="text-purple-400 animate-spin"
                  />
                  <span className="text-[10px] text-purple-300 font-medium">
                    Outpainting...
                  </span>
                </div>
              )}
              {background?.image_edit_status === 'enhancing' && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
                  <IconLoader2
                    size={20}
                    className="text-green-400 animate-spin"
                  />
                  <span className="text-[10px] text-green-300 font-medium">
                    Enhancing...
                  </span>
                </div>
              )}
              {background?.image_edit_status === 'editing' && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
                  <IconLoader2
                    size={20}
                    className="text-amber-400 animate-spin"
                  />
                  <span className="text-[10px] text-amber-300 font-medium">
                    Editing...
                  </span>
                </div>
              )}
              {background?.image_edit_status === 'processing' && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
                  <IconLoader2
                    size={20}
                    className="text-cyan-400 animate-spin"
                  />
                  <span className="text-[10px] text-cyan-300 font-medium">
                    Processing...
                  </span>
                </div>
              )}
              {background?.image_edit_status === 'failed' && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
                  <IconAlertTriangle size={20} className="text-red-400" />
                  <span className="text-[10px] text-red-300 font-medium">
                    Edit Failed
                  </span>
                </div>
              )}
              {(imageUrl || hasVideo) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewOpen(true);
                  }}
                  className="absolute bottom-1 right-1 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-black/80"
                  title={hasVideo ? 'Preview video' : 'Preview image'}
                >
                  <IconMaximize size={12} />
                </button>
              )}
              {availableBackgrounds && onChangeBackground && background && (
                <BackgroundPicker
                  currentGridPosition={background.grid_position}
                  availableBackgrounds={availableBackgrounds}
                  onSelect={(pos) => onChangeBackground(scene.id, pos)}
                />
              )}
            </>
          ) : (
            <>
              <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/60 rounded text-[10px] font-medium text-white">
                {scene.order + 1}
              </div>
              {background?.status === 'processing' ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                  <IconLoader2
                    size={20}
                    className="text-blue-400 animate-spin"
                  />
                  <span className="text-[10px] text-blue-300 font-medium">
                    Splitting...
                  </span>
                </div>
              ) : scene.video_status === 'processing' && !scene.video_url ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                  <IconLoader2
                    size={20}
                    className="text-cyan-400 animate-spin"
                  />
                  <span className="text-[10px] text-cyan-300 font-medium">
                    Generating Video...
                  </span>
                </div>
              ) : hasVideo ? (
                <>
                  {scene.video_url ? (
                    <video
                      src={scene.video_url}
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="absolute inset-0 w-full h-full object-contain"
                    />
                  ) : (
                    <div className="absolute top-1 right-1">
                      <div className="px-1.5 py-0.5 bg-cyan-500/80 rounded text-[10px] font-medium text-white flex items-center gap-0.5">
                        <IconVideo size={10} />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center p-2">
                  <p className="text-[10px] text-muted-foreground/70 text-center line-clamp-3">
                    {promptPreviewForMediaFallback || 'Ref scene'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Objects row (ref_to_video characters/items) */}
      {scene.objects?.length > 0 && (
        <ObjectsRow objects={scene.objects} assetImageMap={assetImageMap} />
      )}

      {/* Asset mapping status */}
      {(totalSceneObjects > 0 || totalSceneBackgrounds > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
            Assets {mappedSceneObjects + mappedSceneBackgrounds}/
            {totalSceneObjects + totalSceneBackgrounds}
          </span>
          {missingAssetLinksCount > 0 ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/30">
              Needs {missingAssetLinksCount} new asset
              {missingAssetLinksCount === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              Fully mapped
            </span>
          )}
          {missingAssetPromptCount > 0 ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30">
              {missingAssetPromptCount} prompt missing
            </span>
          ) : (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">
              Prompts ready
            </span>
          )}
        </div>
      )}

      {background ? (
        <div className="mt-1 text-[9px] text-foreground/60">
          <span className="text-violet-300">Background prompt:</span>{' '}
          {backgroundPromptPreview || (
            <span className="text-amber-300/80">No prompt saved</span>
          )}
        </div>
      ) : null}

      {/* Video prompt info (collapsed) */}
      {!expanded && (
        <div className="mt-1.5 space-y-1">
          {/* Shot type + duration badge */}
          <div className="flex items-center gap-1.5">
            <IconVideo size={10} className="text-cyan-400 flex-shrink-0" />
            {hasMultiShotPrompt ? (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                {multiShotCount}-shot
              </span>
            ) : (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                Single shot
              </span>
            )}
            <p className="text-[9px] text-foreground/50 truncate flex-1">
              {primaryVideoPromptPreview || primaryVideoPromptFallback}
            </p>
          </div>
          {shouldPreferCompiledPrompt && legacyScenePrompt && (
            <p className="pl-[17px] text-[9px] text-amber-300/90">
              Showing execution prompt. Legacy `scene.prompt` is debug-only.
            </p>
          )}
          {/* Voiceover line */}
          {showVoiceover && (
            <div className="flex items-center gap-1.5">
              <IconMicrophone
                size={10}
                className="text-blue-400 flex-shrink-0"
              />
              <p className="text-[10px] text-foreground/70 truncate flex-1">
                {voiceoverPreview || (
                  <span className="italic text-muted-foreground">
                    {isDialogueMode ? 'No dialogue' : 'No voiceover'}
                  </span>
                )}
              </p>
              {renderCollapsedVoiceoverStatus()}
              {collapsedVoiceoverDurationLabel && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-300 flex-shrink-0">
                  {collapsedVoiceoverDurationLabel}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {expanded && (
        <>
          {/* Video Prompt (expanded) */}
          <div
            className="mt-2 p-2 rounded border border-cyan-500/20 bg-cyan-500/5 space-y-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-cyan-300 font-medium flex items-center gap-1">
                <IconVideo size={12} />
                Video Prompt
              </span>
              {hasMultiShotPrompt ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/20">
                  {multiShotCount}-shot
                </span>
              ) : (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/20">
                  Single shot
                </span>
              )}
            </div>
            {hasMultiShotPrompt ? (
              <div className="space-y-1">
                {multiShotPrompts.map((shot: string, idx: number) => (
                  <div
                    key={`shot-${scene.id}-${idx}`}
                    className="text-[10px] text-foreground/80 leading-relaxed pl-2 border-l-2 border-purple-500/30"
                  >
                    <span className="text-purple-400 font-medium">
                      Shot {idx + 1}:
                    </span>{' '}
                    {shot}
                  </div>
                ))}
              </div>
            ) : (
              <>
                <p className="text-[10px] text-foreground/80 leading-relaxed">
                  {primaryVideoPrompt || primaryVideoPromptFallback}
                </p>
                {shouldPreferCompiledPrompt && legacyScenePrompt && (
                  <p className="text-[9px] text-amber-300/90">
                    Legacy `scene.prompt` is present but hidden from primary
                    display (debug-only).
                  </p>
                )}
              </>
            )}
            {/* Duration stepper */}
            {onUpdateShotDurations &&
              (() => {
                const sd = (
                  Array.isArray(scene.multi_shots) ? scene.multi_shots : null
                ) as Array<{ duration?: string }> | null;
                const isMulti =
                  scene.multi_prompt && scene.multi_prompt.length > 1;
                const shotCount = isMulti ? scene.multi_prompt!.length : 1;

                // Default: ceil(voiceover) total split across shots
                const voDur = voiceover?.duration
                  ? Math.ceil(Number(voiceover.duration))
                  : null;
                const defaultPerShot = voDur
                  ? Math.max(3, Math.min(15, Math.round(voDur / shotCount)))
                  : 5;

                const getDur = (idx: number) =>
                  Number(sd?.[idx]?.duration ?? String(defaultPerShot));

                const setDur = (idx: number, delta: number) => {
                  const shots = Array.from({ length: shotCount }, (_, i) => ({
                    duration: String(
                      Math.max(
                        3,
                        Math.min(15, getDur(i) + (i === idx ? delta : 0))
                      )
                    ),
                  }));
                  onUpdateShotDurations(scene.id, shots);
                };

                const totalDur = Array.from({ length: shotCount }, (_, i) =>
                  getDur(i)
                ).reduce((a, b) => a + b, 0);

                return (
                  <div className="pt-1 border-t border-cyan-500/10 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">
                        Duration
                      </span>
                      {isMulti && (
                        <span className="text-[9px] text-muted-foreground">
                          {totalDur}s total
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {Array.from({ length: shotCount }, (_, idx) => (
                        <div
                          key={`dur-${scene.id}-${idx}`}
                          className="inline-flex items-center gap-1 rounded bg-muted/30 border border-border/40 px-1 py-0.5"
                        >
                          {isMulti && (
                            <span className="text-[8px] text-purple-400">
                              S{idx + 1}
                            </span>
                          )}
                          <button
                            type="button"
                            className="w-4 h-4 rounded bg-muted/60 hover:bg-muted text-[10px] text-foreground/70 hover:text-foreground flex items-center justify-center disabled:opacity-30"
                            disabled={getDur(idx) <= 3}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDur(idx, -1);
                            }}
                          >
                            −
                          </button>
                          <span className="text-[10px] text-foreground/85 font-mono min-w-[24px] text-center">
                            {getDur(idx)}s
                          </span>
                          <button
                            type="button"
                            className="w-4 h-4 rounded bg-muted/60 hover:bg-muted text-[10px] text-foreground/70 hover:text-foreground flex items-center justify-center disabled:opacity-30"
                            disabled={getDur(idx) >= 15}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDur(idx, 1);
                            }}
                          >
                            +
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            {/* Elements summary */}
            {scene.objects && scene.objects.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1 border-t border-cyan-500/10">
                {scene.objects.map(
                  (obj: { name?: string; id?: string }, idx: number) => (
                    <span
                      key={obj.id || idx}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20"
                    >
                      @E{idx + 1} {obj.name}
                    </span>
                  )
                )}
              </div>
            )}

            {(missingObjectNames.length > 0 ||
              missingBackgroundNames.length > 0) && (
              <div className="space-y-1 pt-1 border-t border-destructive/20 text-[9px] text-destructive/90">
                {missingObjectNames.length > 0 && (
                  <div>
                    New object asset needed: {missingObjectNames.join(', ')}
                  </div>
                )}
                {missingBackgroundNames.length > 0 && (
                  <div>
                    New background asset needed:{' '}
                    {missingBackgroundNames.join(', ')}
                  </div>
                )}
              </div>
            )}

            {(requiredObjectsForPrompt.length > 0 ||
              requiredBackgroundsForPrompt.length > 0) && (
              <div className="space-y-1 pt-1 border-t border-cyan-500/10">
                <div className="text-[9px] text-cyan-300 uppercase tracking-wide">
                  Asset Prompts
                </div>
                {requiredObjectsForPrompt.slice(0, 3).map((obj) => (
                  <div
                    key={`obj-prompt-${obj.id}`}
                    className="text-[9px] text-foreground/75"
                  >
                    <span className="text-amber-300">{obj.name}:</span>{' '}
                    {obj.generation_prompt?.trim() ? (
                      <span className="line-clamp-1">
                        {obj.generation_prompt}
                      </span>
                    ) : (
                      <span className="text-amber-300/80">No prompt saved</span>
                    )}
                  </div>
                ))}
                {requiredBackgroundsForPrompt.slice(0, 2).map((bg) => (
                  <div
                    key={`bg-prompt-${bg.id}`}
                    className="text-[9px] text-foreground/75"
                  >
                    <span className="text-violet-300">{bg.name}:</span>{' '}
                    {bg.generation_prompt?.trim() ? (
                      <span className="line-clamp-1">
                        {bg.generation_prompt}
                      </span>
                    ) : (
                      <span className="text-amber-300/80">No prompt saved</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <ExpandedContent
            voiceover={voiceover}
            displayVoiceover={displayVoiceover}
            displayVisualPrompt={displayVisualPrompt}
            showVoiceover={showVoiceover}
            showVisual={showVisual}
            playingVoiceoverId={playingVoiceoverId}
            setPlayingVoiceoverId={setPlayingVoiceoverId}
            sceneId={scene.id}
            onReadScene={onReadScene}
            onTranslateScene={onTranslateScene}
            onReadSceneAllLanguages={onReadSceneAllLanguages}
            onGenerateSceneVideo={onGenerateSceneVideo}
            onSaveVisualPrompt={onSaveVisualPrompt}
            onSaveVoiceoverText={onSaveVoiceoverText}
            promptLabel={promptLabel}
            hasVideo={!!hasVideo}
            onAddVideoToTimeline={onAddVideoToTimeline}
            onAddVoiceoverToTimeline={onAddVoiceoverToTimeline}
            isDialogueMode={isDialogueMode}
          />
          {showPromptContractDebug && (
            <PromptContractDebugPanel
              promptJson={promptJsonDebug}
              validatedRuntime={validatedRuntimeDebug}
              compiledPrompt={compiledPromptDebug}
              compileStatus={compileStatusDebug ?? null}
              promptSource={promptSourceDebug}
              resolvedAssetRefs={resolvedAssetRefsDebug}
              referenceImages={referenceImagesDebug}
              latestLogAt={promptDebugSnapshot?.logged_at ?? null}
              hasData={hasPromptContractDebugData}
              legacyPrompt={legacyScenePrompt}
              promptContractActive={promptContractActive}
            />
          )}
        </>
      )}

      <SceneErrors
        firstFrame={firstFrame}
        background={background}
        scene={scene}
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="max-w-[90vw] max-h-[90vh] p-2 sm:p-4 bg-black/90 border-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogTitle className="sr-only">
            Scene {scene.order + 1} Preview
          </DialogTitle>
          {hasVideo && scene.video_url ? (
            <video
              src={scene.video_url}
              controls
              autoPlay
              className="w-full max-h-[80vh] object-contain rounded"
            />
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={`Scene ${scene.order + 1}`}
              className="w-full h-auto max-h-[80vh] object-contain rounded"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SceneErrors({
  firstFrame,
  background,
  scene,
}: {
  firstFrame: FirstFrame | null;
  background: Background | null;
  scene: Scene;
}) {
  if (
    !firstFrame?.error_message &&
    !scene?.video_error_message &&
    !firstFrame?.image_edit_error_message &&
    !background?.image_edit_error_message
  ) {
    return null;
  }
  return (
    <>
      {firstFrame?.error_message && (
        <div className="mt-1.5 p-1 bg-destructive/10 rounded text-[9px] text-destructive line-clamp-1">
          {firstFrame.error_message}
        </div>
      )}
      {firstFrame?.image_edit_error_message && (
        <div className="mt-1.5 p-1 bg-destructive/10 rounded text-[9px] text-destructive line-clamp-1">
          Edit: {firstFrame.image_edit_error_message}
        </div>
      )}
      {background?.image_edit_error_message && (
        <div className="mt-1.5 p-1 bg-destructive/10 rounded text-[9px] text-destructive line-clamp-1">
          Edit: {background.image_edit_error_message}
        </div>
      )}
      {scene.video_error_message && (
        <div className="mt-1.5 p-1 bg-destructive/10 rounded text-[9px] text-destructive line-clamp-1">
          Video: {scene.video_error_message}
        </div>
      )}
    </>
  );
}
