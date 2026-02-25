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

interface SceneCardProps {
  scene: Scene;
  onClick?: () => void;
  compact?: boolean;
  isSelected?: boolean;
  onSelectionChange?: (selected: boolean) => void;
  playingVoiceoverId?: string | null;
  setPlayingVoiceoverId?: (id: string | null) => void;
  onReadScene?: (sceneId: string, newVoiceoverText: string) => Promise<void>;
  onGenerateSceneVideo?: (
    sceneId: string,
    newVisualPrompt: string
  ) => Promise<void>;
  onSaveVisualPrompt?: (sceneId: string, newPrompt: string) => Promise<void>;
  onSaveVoiceoverText?: (sceneId: string, newText: string) => Promise<void>;
  selectedLanguage?: import('@/lib/constants/languages').LanguageCode;
  isRefMode?: boolean;
  isTarget?: boolean;
  onSetTarget?: (sceneId: string) => void;
  aspectRatio?: string;
  onAddVideoToTimeline?: (sceneId: string) => Promise<void>;
  onAddVoiceoverToTimeline?: (sceneId: string) => Promise<void>;
  availableBackgrounds?: Map<
    number,
    { name: string; url: string; final_url: string }
  >;
  onChangeBackground?: (
    sceneId: string,
    newGridPosition: number
  ) => Promise<void>;
}

interface SceneThumbnailProps {
  imageUrl: string | null;
  sceneOrder: number;
  firstFrame: FirstFrame | null;
  background: Background | null;
  videoStatus: string | null;
  hasVideo: boolean;
  onAddToCanvas?: () => void;
  onPreviewImage?: () => void;
  aspectRatio?: string;
  availableBackgrounds?: Map<
    number,
    { name: string; url: string; final_url: string }
  >;
  onChangeBackground?: (gridPosition: number) => void;
}

const ASPECT_RATIO_CLASSES: Record<string, string> = {
  '9:16': 'aspect-[9/16]',
  '16:9': 'aspect-[16/9]',
  '1:1': 'aspect-square',
};

function SceneThumbnail({
  imageUrl,
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
  const isEditFailed = editStatus === 'failed';
  const isGeneratingVideo = videoStatus === 'processing';

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
    if (imageUrl && onPreviewImage) {
      onPreviewImage();
    }
  };

  return (
    <div
      className={`group/thumb relative ${aspectRatio ? ASPECT_RATIO_CLASSES[aspectRatio] || 'aspect-square' : 'aspect-square'} rounded overflow-hidden bg-background/50 ${imageUrl ? 'cursor-pointer' : ''} ${hasVideo ? 'hover:ring-2 hover:ring-primary/50' : ''}`}
      onClick={handleClick}
    >
      {imageUrl ? (
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
      {imageUrl && (
        <button
          type="button"
          onClick={handlePreviewClick}
          className="absolute bottom-1 right-1 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-black/80"
          title="Preview image"
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
          {firstFrame && <StatusBadge status={firstFrame.status} size="sm" />}
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
  playingVoiceoverId?: string | null;
  setPlayingVoiceoverId?: (id: string | null) => void;
  sceneId: string;
  onReadScene?: (sceneId: string, newVoiceoverText: string) => Promise<void>;
  onGenerateSceneVideo?: (
    sceneId: string,
    newVisualPrompt: string
  ) => Promise<void>;
  onSaveVisualPrompt?: (sceneId: string, newPrompt: string) => Promise<void>;
  onSaveVoiceoverText?: (sceneId: string, newText: string) => Promise<void>;
  hasVideo?: boolean;
  onAddVideoToTimeline?: (sceneId: string) => Promise<void>;
  onAddVoiceoverToTimeline?: (sceneId: string) => Promise<void>;
}

function ExpandedContent({
  voiceover,
  displayVoiceover,
  displayVisualPrompt,
  playingVoiceoverId,
  setPlayingVoiceoverId,
  sceneId,
  onReadScene,
  onGenerateSceneVideo,
  onSaveVisualPrompt,
  onSaveVoiceoverText,
  hasVideo,
  onAddVideoToTimeline,
  onAddVoiceoverToTimeline,
}: ExpandedContentProps) {
  const isPlaying = voiceover ? playingVoiceoverId === voiceover.id : false;
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isEditingVoiceover, setIsEditingVoiceover] = useState(false);
  const [editedVoiceover, setEditedVoiceover] = useState('');
  const [isSavingVoiceover, setIsSavingVoiceover] = useState(false);
  const [isReadingTts, setIsReadingTts] = useState(false);
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

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <IconMicrophone size={12} className="text-blue-400" />
          <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
            Voiceover
          </span>
          {renderVoiceoverStatus()}
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
                  if (!isReadingTts) handleSaveVoiceover();
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
            {onReadScene && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="default"
                  className="h-6 text-[10px] px-2"
                  disabled={isReadingTts}
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
              <span className="italic text-muted-foreground">No voiceover</span>
            )}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <IconEye size={12} className="text-purple-400" />
          <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
            Visual
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
                    onGenerateSceneVideo(sceneId, editedPrompt).finally(() => {
                      setIsGeneratingVideo(false);
                      setIsEditingPrompt(false);
                    });
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
          {voiceover?.status === 'success' &&
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

function ObjectsRow({ objects }: { objects: RefObject[] }) {
  const sorted = [...objects].sort((a, b) => a.scene_order - b.scene_order);

  return (
    <div className="mt-1.5 flex items-start gap-2 overflow-x-auto">
      {sorted.map((obj) => {
        const imgSrc = obj.final_url ?? obj.url;
        const initial = obj.name?.charAt(0)?.toUpperCase() ?? '?';

        return (
          <div
            key={obj.id}
            className="flex flex-col items-center gap-0.5 flex-shrink-0"
          >
            <div
              className={`relative w-7 h-7 rounded-full overflow-hidden bg-background/50 border ${
                obj.status === 'failed'
                  ? 'border-red-500/60'
                  : 'border-border/40'
              }`}
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
              {obj.status === 'processing' && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <IconLoader2
                    size={12}
                    className="text-blue-400 animate-spin"
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
  );
}

function BackgroundPicker({
  currentGridPosition,
  availableBackgrounds,
  onSelect,
}: {
  currentGridPosition: number;
  availableBackgrounds: Map<
    number,
    { name: string; url: string; final_url: string }
  >;
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

export function SceneCard({
  scene,
  isSelected,
  onSelectionChange,
  playingVoiceoverId,
  setPlayingVoiceoverId,
  onReadScene,
  onGenerateSceneVideo,
  onSaveVisualPrompt,
  onSaveVoiceoverText,
  selectedLanguage = 'en',
  isRefMode,
  isTarget,
  onSetTarget,
  aspectRatio,
  onAddVideoToTimeline,
  onAddVoiceoverToTimeline,
  availableBackgrounds,
  onChangeBackground,
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
    : (background?.final_url ?? background?.url ?? null);
  const displayVoiceover = voiceover?.text;
  // For ref_to_video scenes, prefer multi_prompt (as JSON string for display), then scene.prompt
  const displayVisualPrompt =
    scene.multi_prompt && scene.multi_prompt.length > 0
      ? JSON.stringify(scene.multi_prompt)
      : (firstFrame?.visual_prompt ?? scene.prompt);

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

  const voiceoverPreview = displayVoiceover
    ? displayVoiceover.slice(0, 35) +
      (displayVoiceover.length > 35 ? '...' : '')
    : null;

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
      {firstFrame || imageUrl ? (
        <SceneThumbnail
          imageUrl={imageUrl}
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
              <Image
                src={imageUrl}
                alt={`Scene ${scene.order + 1}`}
                fill
                className="object-contain"
                unoptimized
              />
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
              {scene.video_status === 'processing' && (
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
              {background?.image_edit_status === 'failed' && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1">
                  <IconAlertTriangle size={20} className="text-red-400" />
                  <span className="text-[10px] text-red-300 font-medium">
                    Edit Failed
                  </span>
                </div>
              )}
              {imageUrl && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewOpen(true);
                  }}
                  className="absolute bottom-1 right-1 p-0.5 rounded bg-black/60 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-black/80"
                  title="Preview image"
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
              ) : scene.video_status === 'processing' ? (
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
                <div className="absolute top-1 right-1">
                  <div className="px-1.5 py-0.5 bg-cyan-500/80 rounded text-[10px] font-medium text-white flex items-center gap-0.5">
                    <IconVideo size={10} />
                  </div>
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center p-2">
                  <p className="text-[10px] text-muted-foreground/70 text-center line-clamp-3">
                    {formatPromptPreview(scene.prompt, scene.multi_prompt) ||
                      'Ref scene'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Objects row (ref_to_video characters/items) */}
      {scene.objects?.length > 0 && <ObjectsRow objects={scene.objects} />}

      {!expanded && (
        <div className="mt-2 flex items-center gap-1.5">
          <IconMicrophone size={10} className="text-blue-400 flex-shrink-0" />
          <p className="text-[10px] text-foreground/70 truncate flex-1">
            {voiceoverPreview || (
              <span className="italic text-muted-foreground">No voiceover</span>
            )}
          </p>
          {renderCollapsedVoiceoverStatus()}
          <IconChevronDown
            size={12}
            className="text-muted-foreground flex-shrink-0"
          />
        </div>
      )}

      {expanded && (
        <ExpandedContent
          voiceover={voiceover}
          displayVoiceover={displayVoiceover}
          displayVisualPrompt={displayVisualPrompt}
          playingVoiceoverId={playingVoiceoverId}
          setPlayingVoiceoverId={setPlayingVoiceoverId}
          sceneId={scene.id}
          onReadScene={onReadScene}
          onGenerateSceneVideo={onGenerateSceneVideo}
          onSaveVisualPrompt={onSaveVisualPrompt}
          onSaveVoiceoverText={onSaveVoiceoverText}
          hasVideo={!!hasVideo}
          onAddVideoToTimeline={onAddVideoToTimeline}
          onAddVoiceoverToTimeline={onAddVoiceoverToTimeline}
        />
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
          {imageUrl && (
            <img
              src={imageUrl}
              alt={`Scene ${scene.order + 1}`}
              className="w-full h-auto max-h-[80vh] object-contain rounded"
            />
          )}
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
