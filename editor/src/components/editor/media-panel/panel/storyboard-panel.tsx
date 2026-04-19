'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useProjectId } from '@/contexts/project-context';
import { createClient } from '@/lib/supabase/client';
import {
  loadTimeline,
  reconstructProjectJSON,
  saveTimeline,
} from '@/lib/supabase/timeline-service';
import {
  pauseAutoSave,
  resumeAutoSave,
  waitForSave,
} from '@/hooks/use-auto-save';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useStudioStore } from '@/stores/studio-store';
import { useProjectStore } from '@/stores/project-store';
import {
  type SceneForTimeline,
  type SceneTimelineSettings,
  calculateSceneTiming,
  buildSceneClips,
} from '@/lib/timeline/scene-to-timeline';
import {
  IconChevronDown,
  IconChevronUp,
  IconFilter,
  IconMovie,
  IconPhoto,
  IconVolume,
  IconVideo,
  IconMapPin,
  IconUser,
  IconBox,
  IconLoader2,
  IconPlayerPlay,
  IconPlayerPause,
  IconEye,
  IconX,
  IconSparkles,
  IconRefresh,
  IconSend,
  IconFileText,
  IconPencil,
  IconDeviceFloppy,
  IconTrash,
  IconArrowsExchange2,
} from '@tabler/icons-react';
import { useChapterFocusStore } from '@/stores/chapter-focus-store';
import { useSceneFocusStore } from '@/stores/scene-focus-store';
import { useTimelineStore } from '@/stores/timeline-store';
import { syncSceneToTimeline } from '@/lib/timeline/sync-scene-to-timeline';
import { appendSceneToTimeline } from '@/lib/timeline/append-scene-to-timeline';
import { usePanelCollapseStore } from '@/stores/panel-collapse-store';
import { useVideoSelectorStore } from '@/stores/video-selector-store';
import { useDeleteConfirmation } from '@/contexts/delete-confirmation-context';
import { CopyButton } from '../shared/copy-button';
import { CopyIdBadge } from '../shared/copy-id-badge';
import { ExpandableText } from '../shared/expandable-text';
import {
  type SceneData,
  type VariantInfo,
  type VariantImageMap,
  statusColor,
  slugToLabel,
  deriveSceneStatus,
  formatDuration,
  callGenerateApi,
} from '../shared/scene-types';
import { ProjectMusicSection } from './project-music-section';
import { DeleteVideoDialog } from './storyboard/delete-video-dialog';
import { SceneShotsInspector } from '../fields';
import type { SceneSP } from '@/lib/api/structured-prompt-schemas';
import { VideoAssetsSection, AssetGallery } from './storyboard/gallery';

// ── Types ──────────────────────────────────────────────────────────────────────

type VideoOption = { id: string; name: string };

interface ChapterData {
  id: string;
  order: number;
  title: string | null;
  synopsis: string | null;
  status: string | null;
  audio_content: string | null;
  visual_outline: string | null;
  asset_variant_map: {
    characters?: string[];
    locations?: string[];
    props?: string[];
  } | null;
  scenes: SceneData[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Derive chapter display status from its scenes */
function deriveChapterStatus(chapter: ChapterData): string {
  if (chapter.scenes.length === 0) return 'draft';
  const statuses = chapter.scenes.map(deriveSceneStatus);
  if (statuses.some((s) => s === 'generating')) return 'generating';
  if (statuses.every((s) => s === 'done')) return 'done';
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'done' || s === 'partial')) return 'partial';
  return 'draft';
}

// ── Image Lightbox ─────────────────────────────────────────────────────────────

function ImageLightbox({
  url,
  label,
  onClose,
}: {
  url: string;
  label: string;
  onClose: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={() => {}}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 size-7 rounded-full bg-black/60 border border-white/20 flex items-center justify-center hover:bg-black/80 transition-colors"
        >
          <IconX className="size-4 text-white" />
        </button>
        <img
          src={url}
          alt={label}
          className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl"
        />
        <span className="text-sm text-white/80 font-medium">{label}</span>
      </div>
    </div>
  );
}

// ── Variant Avatar ─────────────────────────────────────────────────────────────

function VariantAvatar({
  slug,
  imageMap,
  size = 'sm',
}: {
  slug: string;
  imageMap: VariantImageMap;
  size?: 'sm' | 'md';
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const info = imageMap.get(slug);
  const url = info?.image_url;
  const px = size === 'md' ? 'size-7' : 'size-4';

  if (!url) {
    return (
      <div
        className={`${px} rounded-full bg-muted/40 border border-border/30 flex items-center justify-center shrink-0`}
        title={slugToLabel(slug)}
      >
        <span className="text-[6px] text-muted-foreground">?</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setLightboxOpen(true);
        }}
        className={`${px} rounded-full overflow-hidden border border-border/40 shrink-0 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all`}
        title={`Click to expand: ${slugToLabel(slug)}`}
      >
        <img
          src={url}
          alt={slugToLabel(slug)}
          className="w-full h-full object-cover"
        />
      </button>
      {lightboxOpen && (
        <ImageLightbox
          url={url}
          label={slugToLabel(slug)}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}

// ── Mini Audio Player ──────────────────────────────────────────────────────────

function MiniAudioPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play();
    }
    setPlaying(!playing);
  }, [playing]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTimeUpdate = () => {
      if (el.duration) {
        setProgress(el.currentTime / el.duration);
        setCurrentTime(el.currentTime);
      }
    };
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };
    const onLoadedMetadata = () => {
      if (el.duration && Number.isFinite(el.duration)) {
        setAudioDuration(el.duration);
      }
    };

    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('ended', onEnded);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, []);

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {/* biome-ignore lint/a11y/useMediaCaption: internal tool audio */}
      <audio ref={audioRef} src={url} preload="metadata" />
      <button
        type="button"
        onClick={toggle}
        className="size-5 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center hover:bg-blue-500/30 transition-colors shrink-0"
        title={playing ? 'Pause' : 'Play audio'}
      >
        {playing ? (
          <IconPlayerPause className="size-2.5 text-blue-400" />
        ) : (
          <IconPlayerPlay className="size-2.5 text-blue-400 ml-px" />
        )}
      </button>
      {/* Progress bar */}
      <div className="flex-1 h-1 bg-muted/30 rounded-full overflow-hidden min-w-[40px]">
        <div
          className="h-full bg-blue-400/60 rounded-full transition-all duration-200"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      {/* Duration */}
      {audioDuration !== null && (
        <span className="text-[9px] font-mono text-muted-foreground shrink-0">
          {playing ? fmtTime(currentTime) : fmtTime(audioDuration)}
        </span>
      )}
    </div>
  );
}

// ── Video Thumbnail ────────────────────────────────────────────────────────────

function VideoThumbnail({
  url,
  duration,
}: {
  url: string;
  duration?: number | null;
}) {
  const [showPlayer, setShowPlayer] = useState(false);
  const thumbRef = useRef<HTMLVideoElement | null>(null);
  const [thumbReady, setThumbReady] = useState(false);
  const [isVertical, setIsVertical] = useState(false);

  if (showPlayer) {
    return (
      <div
        className={`relative rounded-lg overflow-hidden border border-border/30 bg-black ${isVertical ? 'flex justify-center' : ''}`}
      >
        {/* biome-ignore lint/a11y/useMediaCaption: internal tool video */}
        <video
          src={url}
          controls
          autoPlay
          className={
            isVertical
              ? 'h-[400px] max-w-full object-contain rounded-lg'
              : 'w-full max-h-[400px] object-contain rounded-lg'
          }
          onEnded={() => setShowPlayer(false)}
        />
        <button
          type="button"
          onClick={() => setShowPlayer(false)}
          className="absolute top-2 right-2 size-6 rounded-full bg-black/70 border border-white/20 flex items-center justify-center hover:bg-black/90 transition-colors z-10"
          title="Close"
        >
          <IconX className="size-3 text-white" />
        </button>
      </div>
    );
  }

  // Vertical: compact portrait card, Horizontal: full-width landscape
  const thumbClasses = isVertical
    ? 'relative w-28 rounded-lg overflow-hidden border border-border/30 bg-black hover:border-primary/40 transition-all group cursor-pointer'
    : 'relative w-full rounded-lg overflow-hidden border border-border/30 bg-black hover:border-primary/40 transition-all group cursor-pointer';

  const thumbAspect = isVertical ? '9/16' : '16/9';

  return (
    <button
      type="button"
      onClick={() => setShowPlayer(true)}
      className={thumbClasses}
      style={{ aspectRatio: thumbAspect }}
      title="Click to play"
    >
      {/* Video element to extract poster frame + detect orientation */}
      {/* biome-ignore lint/a11y/useMediaCaption: thumbnail extraction */}
      <video
        ref={thumbRef}
        src={url}
        preload="metadata"
        muted
        playsInline
        className={`absolute inset-0 w-full h-full object-cover transition-opacity ${thumbReady ? 'opacity-100' : 'opacity-0'}`}
        onLoadedMetadata={(e) => {
          const vid = e.currentTarget;
          if (vid.videoHeight > vid.videoWidth) {
            setIsVertical(true);
          }
          vid.currentTime = 0.1;
        }}
        onSeeked={() => setThumbReady(true)}
      />

      {/* Fallback gradient when poster not ready */}
      {!thumbReady && (
        <div className="absolute inset-0 bg-gradient-to-br from-muted/40 to-muted/20" />
      )}

      {/* Play overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/20 transition-colors">
        <div
          className={`rounded-full bg-white/20 backdrop-blur-sm border border-white/20 flex items-center justify-center group-hover:bg-white/30 group-hover:scale-110 transition-all shadow-lg ${isVertical ? 'size-8' : 'size-10'}`}
        >
          <IconPlayerPlay
            className={`text-white ml-0.5 ${isVertical ? 'size-4' : 'size-5'}`}
          />
        </div>
      </div>

      {/* Bottom info bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 flex items-center justify-between">
        <Badge
          variant="outline"
          className="text-[8px] bg-black/40 border-white/20 text-white/90 backdrop-blur-sm"
        >
          <IconVideo className="size-2 mr-0.5" />
          {isVertical ? '9:16' : '16:9'}
        </Badge>
        {duration != null && duration > 0 && (
          <span className="text-[9px] font-mono text-white/80">
            {formatDuration(duration)}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Prompt Highlighter ─────────────────────────────────────────────────────────

// ── Generate Button ────────────────────────────────────────────────────────────

function GenerateButton({
  label,
  genStatus,
  hasResult,
  onClick,
  size = 'sm',
  disabled = false,
  disabledReason,
}: {
  label: string;
  genStatus: string;
  hasResult: boolean;
  onClick: () => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  disabledReason?: string;
}) {
  // Blocked — show disabled state with reason
  if (disabled && !hasResult && genStatus !== 'generating') {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground/50 border border-border/20 cursor-not-allowed"
        title={disabledReason ?? `Cannot generate ${label}`}
      >
        <IconSparkles className="size-2.5 opacity-40" />
        {size === 'md' && label}
      </span>
    );
  }

  if (genStatus === 'generating') {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 animate-pulse font-medium hover:bg-yellow-500/25 transition-colors cursor-pointer"
        title={`Generating ${label}… click to retry if stuck`}
      >
        <IconLoader2 className="size-3 animate-spin" />
        Generating {label}...
      </button>
    );
  }

  // Already has result — show regenerate option
  if (hasResult) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground border border-border/30 hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
        title={`Regenerate ${label}`}
      >
        <IconRefresh className="size-2.5" />
        {size === 'md' && label}
      </button>
    );
  }

  // Failed — show retry
  if (genStatus === 'failed') {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer"
        title={`Retry ${label}`}
      >
        <IconRefresh className="size-2.5" />
        {size === 'md' && `Retry ${label}`}
      </button>
    );
  }

  // Idle — show generate
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors cursor-pointer"
      title={`Generate ${label}`}
    >
      <IconSparkles className="size-2.5" />
      {size === 'md' && label}
    </button>
  );
}

// ── Generation Status Indicator ─────────────────────────────────────────────────

function GenerationStatus({
  label,
  icon,
  genStatus,
  hasResult,
}: {
  label: string;
  icon: React.ReactNode;
  genStatus: string;
  hasResult: boolean;
}) {
  if (genStatus === 'generating') {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-yellow-400 animate-pulse bg-yellow-500/10 px-1.5 py-0.5 rounded border border-yellow-500/20"
        title={`${label}: Generating...`}
      >
        {icon}
        <IconLoader2 className="size-2.5 inline animate-spin" />
        <span className="text-[8px] font-medium">Generating</span>
      </span>
    );
  }
  if (genStatus === 'failed') {
    return (
      <span className="text-red-400" title={`${label}: Failed`}>
        {icon}
        <span className="text-[8px]">✗</span>
      </span>
    );
  }
  // done or idle — show green if result exists
  return (
    <span className={hasResult ? 'text-green-400' : 'opacity-30'} title={label}>
      {icon}
      {label}
    </span>
  );
}

// ── Scene Variant Tile (retry image from scene expand) ─────────────────────────

function SceneVariantTile({
  slug,
  imageMap,
}: {
  slug: string;
  imageMap: VariantImageMap;
}) {
  const info = imageMap.get(slug);
  const url = info?.image_url;
  const variantId = info?.id;
  const isGenerating = info?.image_gen_status === 'generating';
  const [isRetrying, setIsRetrying] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const label = slugToLabel(slug);
  const { confirm } = useDeleteConfirmation();

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!variantId || isRetrying) return;
    const ok = await confirm({
      title: `Regenerate ${label}?`,
      description: `This will replace the current image with a new one. Continue?`,
      confirmLabel: 'Regenerate',
    });
    if (!ok) return;
    setIsRetrying(true);
    try {
      const res = await fetch(`/api/v2/variants/${variantId}/generate-image`, {
        method: 'POST',
      });
      if (res.ok) {
        toast.success(`Image regenerating: ${label}`);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to retry image');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!variantId || isCancelling) return;
    const ok = await confirm({
      title: `Cancel generation of ${label}?`,
      description:
        'Heads up: credits for this request are already spent — the upstream provider has no cancel API. Cancelling only stops us from saving the result when it arrives. Continue?',
      confirmLabel: 'Cancel generation',
    });
    if (!ok) return;
    setIsCancelling(true);
    try {
      const res = await fetch(
        `/api/v2/variants/${variantId}/cancel-generation`,
        { method: 'POST' }
      );
      if (res.ok) {
        toast.success(`Cancelled: ${label}`);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to cancel');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1 group">
      <div className="relative">
        {url ? (
          <img
            src={url}
            alt={label}
            className="size-12 rounded-md object-cover border border-border/30"
          />
        ) : (
          <div className="size-12 rounded-md bg-muted/40 border border-border/30 flex items-center justify-center">
            {isGenerating ? (
              <IconLoader2 className="size-3.5 text-yellow-400 animate-spin" />
            ) : (
              <span className="text-[8px] text-muted-foreground">?</span>
            )}
          </div>
        )}
        {isGenerating && url && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-md pointer-events-none"
            title={`Generating ${label}…`}
          >
            <IconLoader2 className="size-3.5 text-yellow-300 animate-spin" />
          </div>
        )}
        {/* Corner action (hover-only, small hit area): cancel while generating, else regenerate */}
        {variantId &&
          (isGenerating ? (
            <button
              type="button"
              onClick={(e) => void handleCancel(e)}
              disabled={isCancelling}
              className="absolute -top-1 -right-1 size-4 inline-flex items-center justify-center rounded-full bg-background border border-red-500/40 shadow-sm text-red-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity disabled:cursor-not-allowed"
              title={`Cancel generation of ${label} (credits are already spent)`}
            >
              {isCancelling ? (
                <IconLoader2 className="size-2.5 animate-spin" />
              ) : (
                <IconX className="size-2.5" />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => void handleRetry(e)}
              disabled={isRetrying}
              className="absolute -top-1 -right-1 size-4 inline-flex items-center justify-center rounded-full bg-background border border-border shadow-sm text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity disabled:cursor-not-allowed"
              title={`Regenerate ${label}`}
            >
              {isRetrying ? (
                <IconLoader2 className="size-2.5 animate-spin" />
              ) : (
                <IconRefresh className="size-2.5" />
              )}
            </button>
          ))}
      </div>
      <span className="text-[8px] text-muted-foreground truncate max-w-[52px] text-center">
        {label}
      </span>
    </div>
  );
}

// ── Scene Card ─────────────────────────────────────────────────────────────────

function SceneCard({
  scene,
  index,
  imageMap,
  isSelected,
  onToggleSelected,
  onDelete,
  isFocused,
}: {
  scene: SceneData;
  index: number;
  imageMap: VariantImageMap;
  isSelected: boolean;
  onToggleSelected: () => void;
  onDelete: () => void;
  isFocused?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [localTtsStatus, setLocalTtsStatus] = useState<string | null>(null);
  const [localVideoStatus, setLocalVideoStatus] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAppending, setIsAppending] = useState(false);
  const { confirm } = useDeleteConfirmation();
  const { studio } = useStudioStore();
  const { canvasSize } = useProjectStore();

  // Reset local overrides when DB status arrives via Realtime
  useEffect(() => {
    if (
      scene.tts_status === 'generating' ||
      scene.tts_status === 'done' ||
      scene.tts_status === 'failed'
    ) {
      setLocalTtsStatus(null);
    }
  }, [scene.tts_status]);

  useEffect(() => {
    if (
      scene.video_status === 'generating' ||
      scene.video_status === 'done' ||
      scene.video_status === 'failed'
    ) {
      setLocalVideoStatus(null);
    }
  }, [scene.video_status]);

  // Auto-expand and scroll into view when focused from timeline
  useEffect(() => {
    if (!isFocused) return;
    setIsExpanded(true);
    // Small delay so the DOM has time to expand before scrolling
    const timer = setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      useSceneFocusStore.getState().clearSceneFocus();
    }, 150);
    return () => clearTimeout(timer);
  }, [isFocused]);

  // Check if this scene has clips in the timeline
  const isInTimeline = useTimelineStore((state) =>
    Object.values(state.clips).some(
      (clip) => (clip.metadata?.sceneId as string) === scene.id
    )
  );

  const effectiveTtsStatus = localTtsStatus ?? scene.tts_status;
  const effectiveVideoStatus = localVideoStatus ?? scene.video_status;

  const hasAudio = !!scene.audio_url;
  const hasVideo = !!scene.video_url;
  const hasPrompt = !!scene.prompt;
  const isNarrative = !!scene.audio_text;
  const needsTtsFirst = isNarrative && !hasAudio;
  const charCount = scene.character_variant_slugs?.length ?? 0;
  const hasLocation = !!scene.location_variant_slug;
  const propCount = scene.prop_variant_slugs?.length ?? 0;

  // Collect all slugs for this scene
  const allSlugs: string[] = [];
  if (scene.location_variant_slug) allSlugs.push(scene.location_variant_slug);
  if (scene.character_variant_slugs)
    allSlugs.push(...scene.character_variant_slugs);
  if (scene.prop_variant_slugs) allSlugs.push(...scene.prop_variant_slugs);

  return (
    <div
      ref={cardRef}
      className={`rounded-md overflow-hidden transition-colors ${isFocused ? 'ring-2 ring-primary animate-pulse' : ''} ${isSelected ? 'border-2 border-primary/60 bg-primary/5' : 'border border-border/40 bg-card/50'}`}
    >
      {/* Scene header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border/30">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelected}
          onClick={(event) => event.stopPropagation()}
          className="size-3.5 shrink-0 rounded border-border/60 bg-background accent-primary"
          aria-label={`Select scene ${index + 1}`}
        />

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-1 flex items-center gap-2 min-w-0 hover:bg-muted/40 transition-colors text-left rounded-sm px-1 py-0.5"
        >
          {isExpanded ? (
            <IconChevronUp className="size-3 text-muted-foreground shrink-0" />
          ) : (
            <IconChevronDown className="size-3 text-muted-foreground shrink-0" />
          )}
          <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0">
            S{index + 1}
          </span>
          <CopyIdBadge id={scene.id} />
          <span className="text-xs font-medium truncate flex-1">
            {scene.title || `Scene ${index + 1}`}
          </span>

          {/* Mini variant avatars in header */}
          <div className="flex -space-x-1 shrink-0">
            {allSlugs.slice(0, 4).map((slug) => (
              <VariantAvatar key={slug} slug={slug} imageMap={imageMap} />
            ))}
            {allSlugs.length > 4 && (
              <span className="size-4 rounded-full bg-muted/60 border border-border/40 flex items-center justify-center text-[7px] text-muted-foreground shrink-0">
                +{allSlugs.length - 4}
              </span>
            )}
          </div>

          <Badge
            variant="outline"
            className={`text-[9px] ${statusColor(deriveSceneStatus({ ...scene, tts_status: effectiveTtsStatus, video_status: effectiveVideoStatus }))}`}
          >
            {deriveSceneStatus({
              ...scene,
              tts_status: effectiveTtsStatus,
              video_status: effectiveVideoStatus,
            })}
          </Badge>
          {(scene.audio_duration || scene.video_duration) && (
            <span className="text-[10px] text-muted-foreground">
              {formatDuration(
                scene.audio_duration ?? scene.video_duration ?? 0
              )}
            </span>
          )}
        </button>
      </div>

      {/* Scene summary (always visible) */}
      <div className="px-3 py-2 space-y-2">
        {/* Narration — click to expand, with copy */}
        {scene.audio_text && (
          <ExpandableText
            text={scene.audio_text}
            label="Voiceover"
            italic
            clampLines={2}
          />
        )}

        {/* Media row — audio player + video thumbnail */}
        {(hasAudio || hasVideo) && (
          <div className="flex flex-col gap-1.5">
            {hasAudio && <MiniAudioPlayer url={scene.audio_url!} />}
            {hasVideo && (
              <VideoThumbnail
                url={scene.video_url!}
                duration={scene.video_duration}
              />
            )}
          </div>
        )}

        {/* Asset refs with avatars */}
        <div className="flex flex-wrap gap-1">
          {hasLocation && (
            <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <VariantAvatar
                slug={scene.location_variant_slug!}
                imageMap={imageMap}
              />
              <IconMapPin className="size-2.5" />
              {slugToLabel(scene.location_variant_slug!)}
            </span>
          )}
          {scene.character_variant_slugs?.map((slug) => (
            <span
              key={slug}
              className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20"
            >
              <VariantAvatar slug={slug} imageMap={imageMap} />
              <IconUser className="size-2.5" />
              {slugToLabel(slug)}
            </span>
          ))}
          {scene.prop_variant_slugs?.map((slug) => (
            <span
              key={slug}
              className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20"
            >
              <VariantAvatar slug={slug} imageMap={imageMap} />
              <IconBox className="size-2.5" />
              {slugToLabel(slug)}
            </span>
          ))}
        </div>

        {/* Status indicators */}
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          <span
            className={hasPrompt ? 'text-green-400' : 'opacity-30'}
            title="Visual prompt"
          >
            <IconPhoto className="size-3 inline mr-0.5" />
            Prompt
          </span>
          <GenerationStatus
            label="Audio"
            icon={<IconVolume className="size-3 inline mr-0.5" />}
            genStatus={effectiveTtsStatus}
            hasResult={hasAudio}
          />
          <GenerationStatus
            label="Video"
            icon={<IconVideo className="size-3 inline mr-0.5" />}
            genStatus={effectiveVideoStatus}
            hasResult={hasVideo}
          />
          {scene.audio_text && (
            <GenerateButton
              label="TTS"
              genStatus={effectiveTtsStatus}
              hasResult={hasAudio}
              size="md"
              onClick={() => {
                setLocalTtsStatus('generating');
                void (async () => {
                  const result = await callGenerateApi(
                    `/api/v2/scenes/${scene.id}/generate-tts`
                  );
                  if (result.ok) {
                    toast.success(`TTS generation started for S${index + 1}`);
                  } else {
                    setLocalTtsStatus(null);
                    toast.error(
                      result.error ?? 'Failed to start TTS generation'
                    );
                  }
                })();
              }}
            />
          )}
          {hasPrompt && (
            <GenerateButton
              label="Video"
              genStatus={effectiveVideoStatus}
              hasResult={hasVideo}
              size="md"
              disabled={needsTtsFirst}
              disabledReason="Generate voice-over first"
              onClick={() => {
                setLocalVideoStatus('generating');
                void (async () => {
                  const result = await callGenerateApi(
                    `/api/v2/scenes/${scene.id}/generate-video`
                  );
                  if (result.ok) {
                    toast.success(`Video generation started for S${index + 1}`);
                  } else {
                    setLocalVideoStatus(null);
                    toast.error(
                      result.error ?? 'Failed to start Video generation'
                    );
                  }
                })();
              }}
            />
          )}
          {hasPrompt && effectiveVideoStatus === 'failed' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLocalVideoStatus('generating');
                void (async () => {
                  const result = await callGenerateApi(
                    `/api/v2/scenes/${scene.id}/generate-video`,
                    { provider: 'fal' }
                  );
                  if (result.ok) {
                    toast.success(`fal.ai retry started for S${index + 1}`);
                  } else {
                    setLocalVideoStatus(null);
                    toast.error(result.error ?? 'fal.ai retry failed');
                  }
                })();
              }}
              className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-colors cursor-pointer"
              title="Retry with fal.ai (max 10s)"
            >
              <IconRefresh className="size-2.5" />
              fal.ai
            </button>
          )}
          <span className="ml-auto opacity-50 whitespace-nowrap">
            {charCount}ch {hasLocation ? '1loc' : '0loc'} {propCount}pr
          </span>
        </div>
      </div>

      {/* Expanded: Per-shot typed editor (always in edit mode) */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/20">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Visual Prompt
            </p>
            {hasPrompt && scene.prompt ? (
              <CopyButton text={scene.prompt} />
            ) : null}
          </div>
          <SceneShotsInspector
            sceneId={scene.id}
            initialValue={
              Array.isArray(scene.structured_prompt)
                ? (scene.structured_prompt as SceneSP)
                : null
            }
            slugContext={{
              locationSlug: scene.location_variant_slug,
              characterSlugs: scene.character_variant_slugs ?? [],
              propSlugs: scene.prop_variant_slugs ?? [],
              imageMap,
            }}
            onSaved={(next) => {
              scene.structured_prompt = next;
              scene.prompt = next
                .map((s) =>
                  [s.shot_type, s.camera_movement, s.action, s.lighting, s.mood]
                    .filter(Boolean)
                    .join(', ')
                )
                .join('\n');
            }}
            compact
          />
        </div>
      )}

      {/* Expanded: Scene variant assets with retry */}
      {isExpanded && allSlugs.length > 0 && (
        <div className="px-3 pb-3 pt-1 border-t border-border/20">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
            Scene Assets
          </p>
          <div className="flex flex-wrap gap-2">
            {allSlugs.map((slug) => (
              <SceneVariantTile key={slug} slug={slug} imageMap={imageMap} />
            ))}
          </div>
        </div>
      )}

      {/* Expanded: Add to Timeline (scene not yet in timeline) */}
      {isExpanded && !isInTimeline && (hasAudio || hasVideo) && (
        <div className="px-3 pb-2 pt-1 border-t border-border/20 flex items-center justify-end">
          <button
            type="button"
            disabled={isAppending || !studio}
            onClick={async (e) => {
              e.stopPropagation();
              if (!studio) return;
              setIsAppending(true);
              try {
                const result = await appendSceneToTimeline({
                  scene: {
                    id: scene.id,
                    order: scene.order,
                    title: scene.title,
                    audio_url: scene.audio_url,
                    video_url: scene.video_url,
                    audio_text: scene.audio_text,
                    audio_duration: scene.audio_duration,
                    video_duration: scene.video_duration,
                  },
                  studio,
                  canvasWidth: canvasSize.width,
                  canvasHeight: canvasSize.height,
                });
                toast.success(
                  `Added ${result.added} clip${result.added !== 1 ? 's' : ''} to timeline`
                );
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Add failed');
              } finally {
                setIsAppending(false);
              }
            }}
            className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isAppending ? (
              <IconLoader2 className="size-2.5 animate-spin" />
            ) : (
              <IconSend className="size-2.5" />
            )}
            {isAppending ? 'Adding...' : 'Add to Timeline'}
          </button>
        </div>
      )}

      {/* Expanded: Sync to Timeline + In Timeline badge */}
      {isExpanded && isInTimeline && (hasAudio || hasVideo) && (
        <div className="px-3 pb-2 pt-1 border-t border-border/20 flex items-center justify-between">
          <span className="text-[9px] text-primary/70 font-medium">
            In Timeline
          </span>
          <button
            type="button"
            disabled={isSyncing || !studio}
            onClick={async (e) => {
              e.stopPropagation();
              if (!studio) return;
              setIsSyncing(true);
              try {
                const result = await syncSceneToTimeline({
                  sceneId: scene.id,
                  scene: {
                    id: scene.id,
                    order: scene.order,
                    title: scene.title,
                    audio_url: scene.audio_url,
                    video_url: scene.video_url,
                    audio_text: scene.audio_text,
                    audio_duration: scene.audio_duration,
                    video_duration: scene.video_duration,
                  },
                  studio,
                  matchVideoToAudio: true,
                  canvasWidth: canvasSize.width,
                  canvasHeight: canvasSize.height,
                });
                toast.success(
                  `Synced ${result.replaced} clip${result.replaced !== 1 ? 's' : ''} to timeline`
                );
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Sync failed');
              } finally {
                setIsSyncing(false);
              }
            }}
            className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSyncing ? (
              <IconLoader2 className="size-2.5 animate-spin" />
            ) : (
              <IconArrowsExchange2 className="size-2.5" />
            )}
            {isSyncing ? 'Syncing...' : 'Sync to Timeline'}
          </button>
        </div>
      )}

      {/* Expanded: Delete scene */}
      {isExpanded && (
        <div className="px-3 pb-2 pt-1 border-t border-border/20 flex justify-end">
          <button
            type="button"
            disabled={isDeleting}
            onClick={async (e) => {
              e.stopPropagation();
              const ok = await confirm({
                title: 'Delete Scene',
                description: `Delete scene "${scene.title || `S${index + 1}`}"? This cannot be undone.`,
              });
              if (!ok) return;
              setIsDeleting(true);
              try {
                const res = await fetch(`/api/v2/scenes/${scene.id}`, {
                  method: 'DELETE',
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  toast.error(data.error ?? 'Failed to delete scene');
                } else {
                  toast.success(`Scene S${index + 1} deleted`);
                  onDelete();
                }
              } catch {
                toast.error('Failed to delete scene');
              } finally {
                setIsDeleting(false);
              }
            }}
            className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isDeleting ? (
              <IconLoader2 className="size-2.5 animate-spin" />
            ) : (
              <IconTrash className="size-2.5" />
            )}
            {isDeleting ? 'Deleting...' : 'Delete Scene'}
          </button>
        </div>
      )}
    </div>
  );
}

// GalleryCard, VideoAssetsSection, AssetGallery are imported from ./storyboard/gallery

// ── Send to Timeline Modal ──────────────────────────────────────────────────────

type TimelineMediaMode = 'both' | 'video-only' | 'audio-only';

function SendToTimelineModal({
  scenes,
  open,
  onOpenChange,
}: {
  scenes: SceneData[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { studio } = useStudioStore();
  const { canvasSize } = useProjectStore();

  const [mediaMode, setMediaMode] = useState<TimelineMediaMode>('both');
  const [settings, setSettings] = useState<SceneTimelineSettings[]>(() =>
    scenes.map((s) => ({
      sceneId: s.id,
      matchVideoToAudio: !!(s.audio_text || s.audio_url),
    }))
  );
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    setSettings(
      scenes.map((s) => ({
        sceneId: s.id,
        matchVideoToAudio: !!(s.audio_text || s.audio_url),
      }))
    );
  }, [scenes]);

  const updateSetting = (
    sceneId: string,
    patch: Partial<SceneTimelineSettings>
  ) => {
    setSettings((prev) =>
      prev.map((s) => (s.sceneId === sceneId ? { ...s, ...patch } : s))
    );
  };

  // Calculate total duration (estimate from DB values — real durations probed at send time)
  const totalDuration = scenes.reduce((sum, scene) => {
    const s = settings.find((x) => x.sceneId === scene.id);
    if (!s) return sum;
    const timing = calculateSceneTiming(
      scene.audio_duration ?? 0,
      scene.video_duration ?? 0,
      !!scene.audio_text,
      s
    );
    return sum + timing.sceneDuration;
  }, 0);

  const handleSend = async () => {
    if (!studio) {
      toast.error('Editor not ready');
      return;
    }

    setIsSending(true);
    try {
      const results = await buildSceneClips({
        scenes: scenes as SceneForTimeline[],
        settings,
        canvasWidth: canvasSize.width,
        canvasHeight: canvasSize.height,
      });

      // Create tracks based on media mode selection
      const includeVideo = mediaMode !== 'audio-only';
      const includeAudio = mediaMode !== 'video-only';

      const hasAnyVideo = includeVideo && results.some((r) => r.videoClip);
      const hasAnyAudio = includeAudio && results.some((r) => r.audioClip);

      let videoTrackId: string | undefined;
      let audioTrackId: string | undefined;

      if (hasAnyVideo) {
        const track = studio.addTrack({ type: 'Video', name: 'Scene Video' });
        videoTrackId = track.id;
      }
      if (hasAnyAudio) {
        const track = studio.addTrack({ type: 'Audio', name: 'Scene Audio' });
        audioTrackId = track.id;
      }

      for (const result of results) {
        if (result.videoClip && videoTrackId) {
          await studio.addClip(result.videoClip, { trackId: videoTrackId });
        }
        if (result.audioClip && audioTrackId) {
          await studio.addClip(result.audioClip, { trackId: audioTrackId });
        }
      }

      const videoCount = hasAnyVideo
        ? results.filter((r) => r.videoClip).length
        : 0;
      const audioCount = hasAnyAudio
        ? results.filter((r) => r.audioClip).length
        : 0;
      const modeLabel =
        mediaMode === 'video-only'
          ? 'video'
          : mediaMode === 'audio-only'
            ? 'audio'
            : 'video + audio';
      toast.success(
        `Added ${videoCount + audioCount} ${modeLabel} clips to timeline`
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to add clips'
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <DialogTitle className="text-sm font-semibold flex items-center gap-2">
          <IconSend className="size-4" />
          Send to Timeline
          <Badge variant="secondary" className="text-[10px]">
            {scenes.length} scene{scenes.length !== 1 ? 's' : ''}
          </Badge>
        </DialogTitle>

        {/* Media mode selector */}
        <div className="flex items-center gap-1 pb-2 border-b border-border/30">
          {(
            [
              { value: 'both', label: 'Video + Audio' },
              { value: 'video-only', label: 'Video Only' },
              { value: 'audio-only', label: 'Audio Only' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMediaMode(opt.value)}
              className={`flex-1 text-[10px] py-1 px-2 rounded border transition-colors ${
                mediaMode === opt.value
                  ? 'border-primary bg-primary/15 text-primary font-medium'
                  : 'border-border/40 bg-transparent text-muted-foreground hover:bg-muted/20'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Bulk controls */}
        <div className="space-y-2 pb-2 border-b border-border/30">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            All Scenes
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.every((s) => s.matchVideoToAudio)}
              onChange={(e) =>
                setSettings((prev) =>
                  prev.map((s) => ({
                    ...s,
                    matchVideoToAudio: e.target.checked,
                  }))
                )
              }
              className="size-3.5 rounded border-border/60 accent-primary"
            />
            <span className="text-[10px] text-muted-foreground">
              Match video speed to audio (all scenes)
            </span>
          </label>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-3 py-2">
            {scenes.map((scene, i) => {
              const s = settings.find((x) => x.sceneId === scene.id);
              if (!s) return null;

              const timing = calculateSceneTiming(
                scene.audio_duration ?? 0,
                scene.video_duration ?? 0,
                !!scene.audio_text,
                s
              );
              const hasAudio = !!scene.audio_url;
              const hasVideo = !!scene.video_url;

              return (
                <div
                  key={scene.id}
                  className="rounded-md border border-border/40 bg-card/50 p-3 space-y-2.5"
                >
                  {/* Scene header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground">
                        S{i + 1}
                      </span>
                      <span className="text-xs font-medium truncate">
                        {scene.title || `Scene ${i + 1}`}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {timing.sceneDuration.toFixed(1)}s
                    </span>
                  </div>

                  {/* Media info */}
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    {hasAudio && (
                      <span className="flex items-center gap-1">
                        <IconVolume className="size-3" />
                        {(scene.audio_duration ?? 0).toFixed(1)}s
                      </span>
                    )}
                    {hasVideo && (
                      <span className="flex items-center gap-1">
                        <IconVideo className="size-3" />
                        {(scene.video_duration ?? 0).toFixed(1)}s
                      </span>
                    )}
                    {s.matchVideoToAudio && timing.videoPlaybackRate !== 1 && (
                      <span className="font-mono text-primary">
                        {timing.videoPlaybackRate.toFixed(2)}x
                      </span>
                    )}
                  </div>

                  {/* Speed match toggle — any scene with both audio and video */}
                  {hasAudio && hasVideo && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={s.matchVideoToAudio}
                        onChange={(e) =>
                          updateSetting(scene.id, {
                            matchVideoToAudio: e.target.checked,
                          })
                        }
                        className="size-3.5 rounded border-border/60 accent-primary"
                      />
                      <span className="text-[10px] text-muted-foreground">
                        Match video to audio
                        {s.matchVideoToAudio &&
                          timing.videoPlaybackRate !== 1 && (
                            <span className="ml-1 font-mono text-primary">
                              ({timing.videoPlaybackRate.toFixed(2)}x)
                            </span>
                          )}
                      </span>
                    </label>
                  )}

                  {/* Warnings */}
                  {!hasVideo && !hasAudio && (
                    <p className="text-[9px] text-amber-400">
                      No media — scene will be skipped
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-border/40">
          <div className="text-[11px] text-muted-foreground">
            Total:{' '}
            <span className="font-mono font-medium text-foreground">
              {totalDuration.toFixed(1)}s
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onOpenChange(false)}
              disabled={isSending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={handleSend}
              disabled={
                isSending || scenes.every((s) => !s.video_url && !s.audio_url)
              }
            >
              {isSending ? (
                <IconLoader2 className="size-3 animate-spin" />
              ) : (
                <IconSend className="size-3" />
              )}
              Add to Timeline
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Full Script Section ────────────────────────────────────────────────────────

function FullScriptSection({ chapters }: { chapters: ChapterData[] }) {
  const [isOpen, setIsOpen] = useState(false);

  // Gather all voiceover text grouped by chapter
  const scriptChapters = chapters
    .map((ch) => ({
      order: ch.order,
      title: ch.title,
      lines: ch.scenes
        .filter((s) => s.audio_text)
        .map((s) => s.audio_text as string),
    }))
    .filter((ch) => ch.lines.length > 0);

  if (scriptChapters.length === 0) return null;

  const totalLines = scriptChapters.reduce(
    (sum, ch) => sum + ch.lines.length,
    0
  );
  const fullText = scriptChapters
    .map(
      (ch) => `CH${ch.order}: ${ch.title ?? 'Untitled'}\n${ch.lines.join('\n')}`
    )
    .join('\n\n');

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2 py-2 rounded-md border border-border/30 bg-muted/20 hover:bg-muted/40 transition-colors mb-1"
        >
          <IconFileText className="size-4 text-primary/70 shrink-0" />
          <span className="text-xs font-medium flex-1 text-left">
            Full Script
          </span>
          <span className="text-[10px] text-muted-foreground">
            {totalLines} lines
          </span>
          {isOpen ? (
            <IconChevronUp className="size-3.5 text-muted-foreground" />
          ) : (
            <IconChevronDown className="size-3.5 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mb-2 rounded-md border border-border/20 bg-background/50 overflow-hidden">
          {/* Copy all button */}
          <div className="flex items-center justify-end px-2.5 py-1.5 border-b border-border/20">
            <CopyButton text={fullText} />
          </div>
          {/* Script content */}
          <div className="px-3 py-2 space-y-3 max-h-[400px] overflow-y-auto">
            {scriptChapters.map((ch) => (
              <div key={ch.order}>
                <h4 className="text-[11px] font-semibold text-foreground/80 mb-1">
                  CH{ch.order}: {ch.title ?? 'Untitled'}
                </h4>
                <div className="space-y-1">
                  {ch.lines.map((line, i) => (
                    <p
                      key={`${ch.order}-${i}`}
                      className="text-[11px] text-muted-foreground leading-relaxed"
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Chapter Accordion ──────────────────────────────────────────────────────────

function ChapterAccordion({
  chapter,
  imageMap,
  isChapterSelected,
  onToggleChapterSelected,
  forceOpen,
  onSceneDeleted,
  focusedSceneId,
}: {
  chapter: ChapterData;
  imageMap: VariantImageMap;
  isChapterSelected: boolean;
  onToggleChapterSelected: () => void;
  forceOpen?: boolean | null;
  onSceneDeleted: (sceneId: string) => void;
  focusedSceneId?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (forceOpen !== null && forceOpen !== undefined) {
      setIsOpen(forceOpen);
    }
  }, [forceOpen]);

  // Auto-open chapter when a scene inside it is focused
  useEffect(() => {
    if (focusedSceneId && chapter.scenes.some((s) => s.id === focusedSceneId)) {
      setIsOpen(true);
    }
  }, [focusedSceneId, chapter.scenes]);
  const [showAssets, setShowAssets] = useState(false);
  const [selectedScenes, setSelectedScenes] = useState<Set<string>>(new Set());
  const [ttsBatchProgress, setTtsBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [videoBatchProgress, setVideoBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [timelineModalOpen, setTimelineModalOpen] = useState(false);
  const sceneCount = chapter.scenes.length;
  const doneCount = chapter.scenes.filter(
    (s) => !!s.audio_url && !!s.video_url
  ).length;
  const hasAnyVideo = chapter.scenes.some((s) => !!s.video_url);
  const hasAnyAudio = chapter.scenes.some((s) => !!s.audio_url);
  const totalDuration = chapter.scenes.reduce(
    (sum, s) => sum + (s.audio_duration ?? s.video_duration ?? 0),
    0
  );

  // Collect unique slugs per role across all scenes
  const locationSlugs = [
    ...new Set(
      chapter.scenes
        .map((s) => s.location_variant_slug)
        .filter(Boolean) as string[]
    ),
  ];
  const characterSlugs = [
    ...new Set(chapter.scenes.flatMap((s) => s.character_variant_slugs ?? [])),
  ];
  const propSlugs = [
    ...new Set(chapter.scenes.flatMap((s) => s.prop_variant_slugs ?? [])),
  ];
  const totalAssets =
    locationSlugs.length + characterSlugs.length + propSlugs.length;
  const allSelected =
    sceneCount > 0 &&
    chapter.scenes.every((scene) => selectedScenes.has(scene.id));
  const selectedSceneList = chapter.scenes.filter((scene) =>
    selectedScenes.has(scene.id)
  );
  const selectedTtsCount = selectedSceneList.filter(
    (scene) =>
      !!scene.audio_text &&
      !scene.audio_url &&
      scene.tts_status !== 'generating'
  ).length;
  const selectedVideoCount = selectedSceneList.filter((scene) => {
    if (!scene.prompt || scene.video_url || scene.video_status === 'generating')
      return false;
    // Don't count narrative scenes that need TTS first
    if (scene.audio_text && !scene.audio_url) return false;
    return true;
  }).length;
  const failedVideoScenes = chapter.scenes.filter(
    (scene) =>
      scene.video_status === 'failed' && !scene.video_url && !!scene.prompt
  );
  const failedVideoCount = failedVideoScenes.length;
  const failedTtsScenes = chapter.scenes.filter(
    (scene) =>
      scene.tts_status === 'failed' && !scene.audio_url && !!scene.audio_text
  );
  const failedTtsCount = failedTtsScenes.length;
  const [retryBatchProgress, setRetryBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [retryTtsBatchProgress, setRetryTtsBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const isBatchRunning =
    ttsBatchProgress !== null ||
    videoBatchProgress !== null ||
    retryBatchProgress !== null ||
    retryTtsBatchProgress !== null;

  const { focusedChapterId, setFocus, clearFocus } = useChapterFocusStore();
  const isThisChapterFocused = focusedChapterId === chapter.id;

  const handleFilterAssets = () => {
    if (isThisChapterFocused) {
      clearFocus();
      return;
    }
    // Collect all variant slugs used in this chapter's scenes
    const allSlugs = [...locationSlugs, ...characterSlugs, ...propSlugs];
    if (allSlugs.length > 0) {
      setFocus(chapter.id, allSlugs);
    }
  };

  useEffect(() => {
    setSelectedScenes((prev) => {
      const currentIds = new Set(chapter.scenes.map((scene) => scene.id));
      const next = new Set<string>();
      for (const sceneId of prev) {
        if (currentIds.has(sceneId)) {
          next.add(sceneId);
        }
      }
      return next;
    });
  }, [chapter.scenes]);

  const toggleSceneSelection = (sceneId: string) => {
    setSelectedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(sceneId)) {
        next.delete(sceneId);
      } else {
        next.add(sceneId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedScenes(new Set());
      return;
    }

    setSelectedScenes(new Set(chapter.scenes.map((scene) => scene.id)));
  };

  const runBatchTts = async () => {
    const targets = chapter.scenes.filter(
      (scene) =>
        selectedScenes.has(scene.id) &&
        !!scene.audio_text &&
        !scene.audio_url &&
        scene.tts_status !== 'generating'
    );
    if (targets.length < 1) return;

    setTtsBatchProgress({ done: 0, total: targets.length });
    const failures: string[] = [];
    try {
      for (const [index, scene] of targets.entries()) {
        const result = await callGenerateApi(
          `/api/v2/scenes/${scene.id}/generate-tts`
        );
        if (!result.ok) failures.push(result.error ?? 'unknown error');
        setTtsBatchProgress({ done: index + 1, total: targets.length });
      }
    } finally {
      setTtsBatchProgress(null);
    }
    if (failures.length > 0) {
      toast.error(
        `TTS failed for ${failures.length}/${targets.length} scenes: ${failures[0]}`
      );
    } else {
      toast.success(`TTS started for ${targets.length} scenes`);
    }
  };

  const runBatchVideo = async () => {
    const targets = chapter.scenes.filter((scene) => {
      if (
        !selectedScenes.has(scene.id) ||
        !scene.prompt ||
        scene.video_url ||
        scene.video_status === 'generating'
      )
        return false;
      // Skip narrative scenes that still need TTS
      const isNarrative = !!scene.audio_text;
      if (isNarrative && !scene.audio_url) return false;
      return true;
    });
    if (targets.length < 1) return;

    setVideoBatchProgress({ done: 0, total: targets.length });
    const failures: string[] = [];
    try {
      for (const [index, scene] of targets.entries()) {
        const result = await callGenerateApi(
          `/api/v2/scenes/${scene.id}/generate-video`
        );
        if (!result.ok) failures.push(result.error ?? 'unknown error');
        setVideoBatchProgress({ done: index + 1, total: targets.length });
      }
    } finally {
      setVideoBatchProgress(null);
    }
    if (failures.length > 0) {
      toast.error(
        `Video failed for ${failures.length}/${targets.length} scenes: ${failures[0]}`
      );
    } else {
      toast.success(`Video started for ${targets.length} scenes`);
    }
  };

  const runRetryFailedVideos = async () => {
    if (failedVideoScenes.length < 1) return;

    setRetryBatchProgress({ done: 0, total: failedVideoScenes.length });
    const failures: string[] = [];
    try {
      for (const [index, scene] of failedVideoScenes.entries()) {
        const result = await callGenerateApi(
          `/api/v2/scenes/${scene.id}/generate-video`
        );
        if (!result.ok) failures.push(result.error ?? 'unknown error');
        setRetryBatchProgress({
          done: index + 1,
          total: failedVideoScenes.length,
        });
      }
    } finally {
      setRetryBatchProgress(null);
    }
    if (failures.length > 0) {
      toast.error(
        `Retry failed for ${failures.length}/${failedVideoScenes.length} scenes: ${failures[0]}`
      );
    } else {
      toast.success(`Retry started for ${failedVideoScenes.length} scenes`);
    }
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={isChapterSelected}
            onChange={onToggleChapterSelected}
            className="ml-1 size-3 rounded border-border accent-primary shrink-0 cursor-pointer"
            title={`Select CH${chapter.order} for timeline`}
          />
          {totalAssets > 0 && (
            <button
              type="button"
              onClick={handleFilterAssets}
              className={`shrink-0 p-0.5 rounded transition-colors ${
                isThisChapterFocused
                  ? 'text-primary bg-primary/15'
                  : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30'
              }`}
              title={
                isThisChapterFocused
                  ? 'Clear asset filter'
                  : `Filter assets to CH${chapter.order}`
              }
            >
              <IconFilter className="size-3" />
            </button>
          )}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex-1 flex items-center gap-2 px-2 py-2.5 hover:bg-muted/30 transition-colors rounded-md text-left"
            >
              {isOpen ? (
                <IconChevronUp className="size-3.5 text-muted-foreground shrink-0" />
              ) : (
                <IconChevronDown className="size-3.5 text-muted-foreground shrink-0" />
              )}

              <span className="text-[10px] font-mono text-muted-foreground w-8 shrink-0">
                CH{chapter.order}
              </span>
              <CopyIdBadge id={chapter.id} />

              <span className="text-xs font-medium truncate flex-1">
                {chapter.title?.replace(/^(EP|CH)\d+\s*[-—]\s*/, '') ||
                  `Chapter ${chapter.order}`}
              </span>

              {/* Scene progress */}
              <span className="text-[10px] text-muted-foreground shrink-0">
                {doneCount}/{sceneCount}
              </span>

              <Badge
                variant="outline"
                className={`text-[9px] shrink-0 ${statusColor(deriveChapterStatus(chapter))}`}
              >
                {deriveChapterStatus(chapter)}
              </Badge>
            </button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent>
          <div className="pl-4 pr-1 pb-3 space-y-2">
            {/* Chapter summary bar */}
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground px-2 py-1.5 bg-muted/15 rounded">
              <span>{sceneCount} scenes</span>
              {totalDuration > 0 && (
                <span>{formatDuration(totalDuration)}</span>
              )}
              <span className={hasAnyAudio ? 'text-green-400' : 'opacity-30'}>
                <IconVolume className="size-3 inline" /> Audio
              </span>
              <span className={hasAnyVideo ? 'text-green-400' : 'opacity-30'}>
                <IconVideo className="size-3 inline" /> Video
              </span>
              {(() => {
                const genVideo = chapter.scenes.filter(
                  (s) => s.video_status === 'generating'
                ).length;
                const genTts = chapter.scenes.filter(
                  (s) => s.tts_status === 'generating'
                ).length;
                if (genVideo === 0 && genTts === 0) return null;
                const parts: string[] = [];
                if (genVideo > 0)
                  parts.push(`${genVideo} video${genVideo > 1 ? 's' : ''}`);
                if (genTts > 0) parts.push(`${genTts} TTS`);
                return (
                  <span className="inline-flex items-center gap-1 text-yellow-400 font-medium">
                    <IconLoader2 className="size-3 animate-spin" />
                    Generating {parts.join(' + ')}…
                  </span>
                );
              })()}
              <button
                type="button"
                onClick={toggleSelectAll}
                disabled={sceneCount < 1 || isBatchRunning}
                className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground border border-border/30 hover:bg-muted/50 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => {
                    void runBatchTts();
                  }}
                  disabled={selectedTtsCount === 0 || isBatchRunning}
                  className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <IconSparkles className="size-2.5" />
                  Generate TTS ({selectedTtsCount})
                </button>
                {ttsBatchProgress && (
                  <span className="text-[9px] text-yellow-400 mt-0.5">
                    Generating {ttsBatchProgress.done}/{ttsBatchProgress.total}
                    ...
                  </span>
                )}
              </div>
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => {
                    void runBatchVideo();
                  }}
                  disabled={selectedVideoCount === 0 || isBatchRunning}
                  className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <IconSparkles className="size-2.5" />
                  Generate Video ({selectedVideoCount})
                </button>
                {videoBatchProgress && (
                  <span className="text-[9px] text-yellow-400 mt-0.5">
                    Generating {videoBatchProgress.done}/
                    {videoBatchProgress.total}...
                  </span>
                )}
              </div>
              {failedVideoCount > 0 && (
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => {
                      void runRetryFailedVideos();
                    }}
                    disabled={isBatchRunning}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <IconRefresh className="size-2.5" />
                    Retry Failed ({failedVideoCount})
                  </button>
                  {retryBatchProgress && (
                    <span className="text-[9px] text-yellow-400 mt-0.5">
                      Retrying {retryBatchProgress.done}/
                      {retryBatchProgress.total}...
                    </span>
                  )}
                </div>
              )}
              {failedTtsCount > 0 && (
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={async () => {
                      setRetryTtsBatchProgress({
                        done: 0,
                        total: failedTtsScenes.length,
                      });
                      try {
                        for (const [i, scene] of failedTtsScenes.entries()) {
                          await callGenerateApi(
                            `/api/v2/scenes/${scene.id}/generate-tts`
                          );
                          setRetryTtsBatchProgress({
                            done: i + 1,
                            total: failedTtsScenes.length,
                          });
                        }
                      } finally {
                        setRetryTtsBatchProgress(null);
                      }
                    }}
                    disabled={isBatchRunning}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <IconRefresh className="size-2.5" />
                    Retry Failed TTS ({failedTtsCount})
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setRetryTtsBatchProgress({
                        done: 0,
                        total: failedTtsScenes.length,
                      });
                      try {
                        for (const [i, scene] of failedTtsScenes.entries()) {
                          await callGenerateApi(
                            `/api/v2/scenes/${scene.id}/generate-tts`,
                            { provider: 'fal' }
                          );
                          setRetryTtsBatchProgress({
                            done: i + 1,
                            total: failedTtsScenes.length,
                          });
                        }
                      } finally {
                        setRetryTtsBatchProgress(null);
                      }
                    }}
                    disabled={isBatchRunning}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <IconRefresh className="size-2.5" />
                    Retry fal.ai TTS ({failedTtsCount})
                  </button>
                  {retryTtsBatchProgress && (
                    <span className="text-[9px] text-yellow-400 mt-0.5">
                      Retrying TTS {retryTtsBatchProgress.done}/
                      {retryTtsBatchProgress.total}...
                    </span>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setTimelineModalOpen(true)}
                disabled={
                  selectedScenes.size === 0 ||
                  !chapter.scenes.some(
                    (s) =>
                      selectedScenes.has(s.id) && (s.video_url || s.audio_url)
                  ) ||
                  isBatchRunning
                }
                className="inline-flex items-center gap-1 h-6 px-2 rounded border border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Send selected scenes to timeline"
              >
                <IconSend className="size-3" />
                To Timeline
              </button>
              {totalAssets > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAssets(!showAssets)}
                  className={`ml-auto flex items-center gap-0.5 hover:text-foreground transition-colors ${showAssets ? 'text-foreground' : ''}`}
                  title="Toggle asset gallery"
                >
                  <IconEye className="size-3" />
                  <span>{totalAssets} assets</span>
                </button>
              )}
            </div>

            {/* Synopsis */}
            {chapter.synopsis && (
              <p className="text-[10px] text-muted-foreground/70 px-2 line-clamp-2 italic">
                {chapter.synopsis}
              </p>
            )}

            {/* Audio Content (collapsible) */}
            {chapter.audio_content && (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded bg-muted/15 border border-border/20 text-left hover:bg-muted/25 transition-colors"
                  >
                    <IconVolume className="size-3 text-muted-foreground shrink-0" />
                    <span className="text-[9px] font-medium text-muted-foreground flex-1">
                      Audio Content
                    </span>
                    <IconChevronDown className="size-3 text-muted-foreground" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-2 py-1.5 mt-1 rounded bg-muted/10 border border-border/15">
                    <p className="text-[10px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
                      {chapter.audio_content}
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Visual Outline (collapsible) */}
            {chapter.visual_outline && (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center gap-1.5 px-2 py-1 rounded bg-muted/15 border border-border/20 text-left hover:bg-muted/25 transition-colors"
                  >
                    <IconPhoto className="size-3 text-muted-foreground shrink-0" />
                    <span className="text-[9px] font-medium text-muted-foreground flex-1">
                      Visual Outline
                    </span>
                    <IconChevronDown className="size-3 text-muted-foreground" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-2 py-1.5 mt-1 rounded bg-muted/10 border border-border/15">
                    <p className="text-[10px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
                      {chapter.visual_outline}
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Asset Gallery (toggle) */}
            {showAssets && (
              <div className="px-2 py-2 bg-muted/10 rounded-md border border-border/20 space-y-3">
                <AssetGallery
                  slugs={locationSlugs}
                  assetRole="location"
                  imageMap={imageMap}
                />
                <AssetGallery
                  slugs={characterSlugs}
                  assetRole="character"
                  imageMap={imageMap}
                />
                <AssetGallery
                  slugs={propSlugs}
                  assetRole="prop"
                  imageMap={imageMap}
                />
              </div>
            )}

            {/* Scenes */}
            {chapter.scenes.length > 0 ? (
              <div className="space-y-1.5">
                {chapter.scenes.map((scene, i) => (
                  <SceneCard
                    key={scene.id}
                    scene={scene}
                    index={i}
                    imageMap={imageMap}
                    isSelected={selectedScenes.has(scene.id)}
                    onToggleSelected={() => toggleSceneSelection(scene.id)}
                    onDelete={() => onSceneDeleted(scene.id)}
                    isFocused={focusedSceneId === scene.id}
                  />
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground/50 px-2 py-4 text-center">
                No scenes yet
              </p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Send to Timeline modal */}
      <SendToTimelineModal
        scenes={chapter.scenes.filter(
          (s) => selectedScenes.has(s.id) && (s.video_url || s.audio_url)
        )}
        open={timelineModalOpen}
        onOpenChange={setTimelineModalOpen}
      />
    </>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export default function StoryboardPanel() {
  const projectId = useProjectId();
  const [allVideo, setAllVideo] = useState<VideoOption[]>([]);
  const { getVideoId, setVideoId: persistVideoId } = useVideoSelectorStore();
  const [videoId, setVideoIdLocal] = useState<string | null>(null);
  const [chapters, setChapters] = useState<ChapterData[]>([]);
  const [imageMap, setImageMap] = useState<VariantImageMap>(new Map());
  const [videoAssetSlugs, setVideoAssetSlugs] = useState<{
    characters: string[];
    locations: string[];
    props: string[];
  }>({ characters: [], locations: [], props: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);
  const prevVideoIdRef = useRef<string | null>(null);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(
    new Set()
  );
  const [isSendingChapters, setIsSendingChapters] = useState(false);
  const [videoLevelBatch, setVideoLevelBatch] = useState<{
    type:
      | 'retry'
      | 'retry-fal'
      | 'tts'
      | 'retry-tts'
      | 'retry-tts-fal'
      | 'generate-missing'
      | null;
    done: number;
    total: number;
  } | null>(null);
  const { studio } = useStudioStore();
  const { canvasSize } = useProjectStore();
  const { toggleAll, getForceOpen } = usePanelCollapseStore();
  const storyboardForceOpen = getForceOpen('storyboard');
  const { focusedSceneId } = useSceneFocusStore();
  const [chaptersOpen, setChaptersOpen] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Helper to set video both locally and in persistent store
  const setVideoId = useCallback(
    (id: string | null) => {
      setVideoIdLocal(id);
      if (id && projectId) persistVideoId(projectId, id);
    },
    [projectId, persistVideoId]
  );

  const handleDeleteVideo = useCallback(async () => {
    if (!videoId) return;
    const res = await fetch(`/api/v2/videos/${videoId}`, { method: 'DELETE' });
    if (!res.ok) {
      const { error: err } = await res
        .json()
        .catch(() => ({ error: 'Delete failed' }));
      toast.error(err || 'Failed to delete video');
      throw new Error(err || 'Delete failed');
    }
    const idx = allVideo.findIndex((v) => v.id === videoId);
    const remaining = allVideo.filter((v) => v.id !== videoId);
    setAllVideo(remaining);
    const next = remaining[idx] ?? remaining[idx - 1] ?? null;
    if (next) setVideoId(next.id);
    else setVideoIdLocal(null);
    toast.success('Video deleted');
  }, [videoId, allVideo, setVideoId]);

  // Load all video for this project (for the dropdown)
  useEffect(() => {
    if (!projectId) {
      setAllVideo([]);
      return;
    }

    const supabase = createClient('studio');
    supabase
      .from('videos')
      .select('id, name')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        const list: VideoOption[] = (data ?? []).map((s) => ({
          id: s.id,
          name: (s.name as string) || 'Untitled',
        }));
        setAllVideo(list);

        // Restore persisted selection or auto-select first
        const persisted = getVideoId(projectId);
        if (persisted && list.some((s) => s.id === persisted)) {
          setVideoIdLocal(persisted);
        } else if (list.length > 0) {
          setVideoId(list[0].id);
        }
      });
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!projectId || !videoId) {
        setIsLoading(false);
        return;
      }

      // Only show loading spinner on first load — not on Realtime refreshes
      if (!hasLoadedOnce.current) {
        setIsLoading(true);
      }
      setError(null);

      const supabase = createClient('studio');

      try {
        // Fetch chapters for the selected video
        const { data: epRows, error: epError } = await supabase
          .from('chapters')
          .select(
            'id, "order", title, synopsis, status, audio_content, visual_outline, asset_variant_map'
          )
          .eq('video_id', videoId)
          .order('"order"', { ascending: true });

        if (epError) throw new Error(epError.message);

        // Fetch all scenes for these chapters
        const epIds = (epRows ?? []).map((e: { id: string }) => e.id);
        let allScenes: SceneData[] = [];
        if (epIds.length > 0) {
          const { data: sceneRows, error: scError } = await supabase
            .from('scenes')
            .select(
              'id, chapter_id, "order", title, structured_prompt, audio_text, audio_url, audio_duration, video_url, video_duration, status, location_variant_slug, character_variant_slugs, prop_variant_slugs, tts_status, video_status, tts_generation_metadata, video_generation_metadata'
            )
            .in('chapter_id', epIds)
            .order('"order"', { ascending: true });

          if (scError) throw new Error(scError.message);
          // Map structured_prompt → prompt for backward compat with SceneCard rendering
          allScenes = (sceneRows ?? []).map((row: any) => ({
            ...row,
            prompt: row.structured_prompt
              ? (row.structured_prompt as Record<string, unknown>[])
                  .map((s: Record<string, unknown>) =>
                    Object.values(s)
                      .filter((v) => typeof v === 'string' && v.trim())
                      .join(', ')
                  )
                  .join('\n')
              : null,
          })) as unknown as (SceneData & { chapter_id: string })[];
        }

        // Collect all unique variant slugs across scenes
        const slugSet = new Set<string>();
        for (const s of allScenes as (SceneData & { chapter_id: string })[]) {
          if (s.location_variant_slug) slugSet.add(s.location_variant_slug);
          for (const c of s.character_variant_slugs ?? []) slugSet.add(c);
          for (const p of s.prop_variant_slugs ?? []) slugSet.add(p);
        }

        // Fetch variant info: scene-referenced slugs + all video-level asset variants
        const newImageMap = new Map<string, VariantInfo>();
        const variantFields =
          'id, slug, image_url, image_gen_status, structured_prompt, generation_metadata';

        // Fetch all variants for assets belonging to this video (shows assets even without scenes)
        const [vidCharResult, vidLocResult, vidPropResult] = await Promise.all([
          supabase
            .from('character_variants')
            .select(`${variantFields}, characters!inner(video_id)`)
            .eq('characters.video_id', videoId),
          supabase
            .from('location_variants')
            .select(`${variantFields}, locations!inner(video_id)`)
            .eq('locations.video_id', videoId),
          supabase
            .from('prop_variants')
            .select(`${variantFields}, props!inner(video_id)`)
            .eq('props.video_id', videoId),
        ]);

        const vidCharSlugs: string[] = [];
        const vidLocSlugs: string[] = [];
        const vidPropSlugs: string[] = [];

        const addToMap = (v: {
          id: string;
          slug: string;
          image_url: string | null;
          image_gen_status: string | null;
          structured_prompt?: Record<string, unknown> | null;
          generation_metadata?: Record<string, unknown> | null;
        }) => {
          if (!v.slug) return;
          slugSet.add(v.slug);
          newImageMap.set(v.slug, {
            id: v.id,
            image_url: v.image_url,
            image_gen_status: v.image_gen_status ?? 'idle',
            structured_prompt: v.structured_prompt ?? null,
            generation_metadata: v.generation_metadata ?? null,
          });
        };

        for (const v of vidCharResult.data ?? []) {
          addToMap(v);
          if (v.slug) vidCharSlugs.push(v.slug);
        }
        for (const v of vidLocResult.data ?? []) {
          addToMap(v);
          if (v.slug) vidLocSlugs.push(v.slug);
        }
        for (const v of vidPropResult.data ?? []) {
          addToMap(v);
          if (v.slug) vidPropSlugs.push(v.slug);
        }

        // Also fetch any scene-referenced slugs not yet in the map (e.g. project-level assets)
        const missingSlugs = [...slugSet].filter((s) => !newImageMap.has(s));
        if (missingSlugs.length > 0) {
          const [charResult, locResult, propResult] = await Promise.all([
            supabase
              .from('character_variants')
              .select(variantFields)
              .in('slug', missingSlugs),
            supabase
              .from('location_variants')
              .select(variantFields)
              .in('slug', missingSlugs),
            supabase
              .from('prop_variants')
              .select(variantFields)
              .in('slug', missingSlugs),
          ]);

          for (const v of [
            ...(charResult.data ?? []),
            ...(locResult.data ?? []),
            ...(propResult.data ?? []),
          ]) {
            if (v.slug) {
              newImageMap.set(v.slug, {
                id: v.id,
                image_url: v.image_url,
                image_gen_status: v.image_gen_status ?? 'idle',
                structured_prompt:
                  (v as { structured_prompt?: Record<string, unknown> | null })
                    .structured_prompt ?? null,
                generation_metadata:
                  (
                    v as {
                      generation_metadata?: Record<string, unknown> | null;
                    }
                  ).generation_metadata ?? null,
              });
            }
          }
        }

        // Group scenes by chapter
        const scenesByEp = new Map<string, SceneData[]>();
        for (const s of allScenes as (SceneData & { chapter_id: string })[]) {
          const arr = scenesByEp.get(s.chapter_id) ?? [];
          arr.push(s);
          scenesByEp.set(s.chapter_id, arr);
        }

        const parsed: ChapterData[] = (epRows ?? []).map((ep: any) => ({
          id: ep.id,
          order: ep.order,
          title: ep.title,
          synopsis: ep.synopsis,
          status: ep.status,
          audio_content: ep.audio_content,
          visual_outline: ep.visual_outline,
          asset_variant_map: ep.asset_variant_map,
          scenes: scenesByEp.get(ep.id) ?? [],
        }));

        if (!cancelled) {
          setChapters(parsed);
          setImageMap(newImageMap);
          setVideoAssetSlugs({
            characters: vidCharSlugs,
            locations: vidLocSlugs,
            props: vidPropSlugs,
          });
          setIsLoading(false);
          hasLoadedOnce.current = true;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load');
          setIsLoading(false);
        }
      }
    }

    load();

    // ── Realtime: auto-refresh on scene/variant changes ─────────────────
    const supabaseRT = createClient('studio');

    const sceneSub = supabaseRT
      .channel('storyboard-scenes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'studio', table: 'scenes' },
        () => {
          if (!cancelled) load();
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'studio', table: 'scenes' },
        () => {
          if (!cancelled) load();
        }
      )
      .subscribe();

    const variantSub = supabaseRT
      .channel('storyboard-variants')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'studio', table: 'character_variants' },
        () => {
          if (!cancelled) load();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'studio', table: 'location_variants' },
        () => {
          if (!cancelled) load();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'studio', table: 'prop_variants' },
        () => {
          if (!cancelled) load();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabaseRT.removeChannel(sceneSub);
      supabaseRT.removeChannel(variantSub);
    };
  }, [projectId, videoId]);

  // ── Swap timeline when video selection changes ─────────────────────────────
  useEffect(() => {
    // Skip the initial mount — preview-panel handles first load
    if (prevVideoIdRef.current === null) {
      prevVideoIdRef.current = videoId;
      return;
    }
    if (videoId === prevVideoIdRef.current) return;

    const previousVideoId = prevVideoIdRef.current;
    prevVideoIdRef.current = videoId;

    if (!studio || !projectId) return;

    let cancelled = false;

    const swapTimeline = async () => {
      try {
        // Pause auto-save so it doesn't write empty state mid-swap
        pauseAutoSave();
        await waitForSave();

        // 1. Best-effort save current timeline to the PREVIOUS video
        //    Don't abort swap if save fails — user must still switch.
        if (previousVideoId && studio.tracks.length > 0) {
          try {
            await saveTimeline(
              projectId,
              studio.tracks,
              studio.clips,
              previousVideoId
            );
          } catch (saveErr) {
            console.warn(
              'Failed to save previous video timeline (continuing swap):',
              saveErr
            );
          }
        }

        // 2. Clear UI (async — must await)
        await studio.clear();

        if (cancelled || !videoId) {
          resumeAutoSave();
          return;
        }

        // 3. Load the NEW video's timeline from DB
        const savedData = await loadTimeline(projectId, videoId);

        if (cancelled) return;

        if (savedData && savedData.length > 0) {
          const projectJson = reconstructProjectJSON(savedData);
          await studio.loadFromJSON(projectJson as any);
          const trackCount = savedData.length;
          const clipCount = savedData.reduce(
            (sum, t) => sum + (t.clips?.length ?? 0),
            0
          );
          toast.success(
            `Loaded timeline: ${trackCount} track${trackCount !== 1 ? 's' : ''}, ${clipCount} clip${clipCount !== 1 ? 's' : ''}`
          );
        } else {
          toast.info('Empty timeline — add scenes from storyboard');
        }
        // Resume auto-save after swap is complete
        resumeAutoSave();
      } catch (err) {
        resumeAutoSave();
        if (!cancelled) {
          console.error('Failed to swap timeline:', err);
          toast.error('Failed to load timeline');
        }
      }
    };

    swapTimeline();

    return () => {
      cancelled = true;
    };
  }, [videoId, studio, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-xs text-destructive text-center">{error}</p>
      </div>
    );
  }

  if (!videoId || allVideo.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center gap-2">
        <IconMovie className="size-8 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">No video linked yet.</p>
        <p className="text-[10px] text-muted-foreground/50">
          Link a video to this project to see chapters.
        </p>
      </div>
    );
  }

  if (chapters.length === 0 && !isLoading) {
    return (
      <div className="h-full flex flex-col">
        {/* Video selector even when no chapters */}
        <div className="p-3 border-b border-border/20 flex items-center gap-1">
          {allVideo.length > 1 ? (
            <select
              value={videoId ?? ''}
              onChange={(e) => setVideoId(e.target.value || null)}
              className="text-sm font-medium bg-transparent border border-border/40 rounded px-1.5 py-0.5 outline-none focus:border-primary/50 truncate max-w-[200px] cursor-pointer"
            >
              {allVideo.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm font-medium">
              {allVideo.find((s) => s.id === videoId)?.name || 'Storyboard'}
            </p>
          )}
          {videoId && allVideo.length > 0 && (
            <button
              type="button"
              onClick={() => setDeleteDialogOpen(true)}
              className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
              title="Delete video"
            >
              <IconTrash className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-4 text-center gap-2">
          <IconMovie className="size-8 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">No chapters yet.</p>
          <p className="text-[10px] text-muted-foreground/50">
            Create chapters via API to see the storyboard.
          </p>
        </div>
        <DeleteVideoDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          videoName={allVideo.find((v) => v.id === videoId)?.name ?? ''}
          onConfirm={handleDeleteVideo}
        />
      </div>
    );
  }

  // Stats
  const totalScenes = chapters.reduce((s, e) => s + e.scenes.length, 0);
  const doneScenes = chapters.reduce(
    (s, e) =>
      s + e.scenes.filter((sc) => !!sc.audio_url && !!sc.video_url).length,
    0
  );
  const totalDuration = chapters.reduce(
    (s, e) =>
      s +
      e.scenes.reduce(
        (ss, sc) => ss + (sc.audio_duration ?? sc.video_duration ?? 0),
        0
      ),
    0
  );
  const totalVariantImages = [...imageMap.values()].filter(
    (v) => !!v.image_url
  ).length;
  const videoName = allVideo.find((s) => s.id === videoId)?.name;

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-1">
        {/* Header with video selector */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="flex items-center gap-1">
              {allVideo.length > 1 ? (
                <select
                  value={videoId ?? ''}
                  onChange={(e) => setVideoId(e.target.value || null)}
                  className="text-sm font-medium bg-transparent border border-border/40 rounded px-1.5 py-0.5 outline-none focus:border-primary/50 truncate max-w-[200px] cursor-pointer"
                >
                  {allVideo.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <h3 className="text-sm font-semibold">
                  {videoName || 'Storyboard'}
                </h3>
              )}
              {videoId && allVideo.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDeleteDialogOpen(true)}
                  className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                  title="Delete video"
                >
                  <IconTrash className="size-3.5" />
                </button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {chapters.length} chapters · {totalScenes} scenes
              {totalDuration > 0 && ` · ${formatDuration(totalDuration)}`}
              {totalVariantImages > 0 && ` · ${totalVariantImages} images`}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => toggleAll('storyboard')}
              className="h-6 px-1.5 text-xs rounded border bg-background hover:bg-accent text-muted-foreground transition-colors"
              title={
                storyboardForceOpen === true
                  ? 'Collapse all chapters'
                  : 'Expand all chapters'
              }
            >
              {storyboardForceOpen === true ? (
                <IconChevronUp className="size-3.5" />
              ) : (
                <IconChevronDown className="size-3.5" />
              )}
            </button>
            <Badge variant="outline" className="text-[9px]">
              {doneScenes}/{totalScenes} done
            </Badge>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-muted/30 rounded-full overflow-hidden mb-1">
          <div
            className="h-full bg-emerald-500/60 rounded-full transition-all"
            style={{
              width: `${totalScenes > 0 ? (doneScenes / totalScenes) * 100 : 0}%`,
            }}
          />
        </div>

        {/* Chapter selection controls */}
        {chapters.length > 0 && (
          <div className="flex items-center gap-2 py-1.5 px-1 border-b border-border/20 mb-1">
            <button
              type="button"
              onClick={() => {
                const allSelected = chapters.every((ep) =>
                  selectedChapterIds.has(ep.id)
                );
                if (allSelected) {
                  setSelectedChapterIds(new Set());
                } else {
                  setSelectedChapterIds(new Set(chapters.map((ep) => ep.id)));
                }
              }}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <input
                type="checkbox"
                checked={
                  chapters.length > 0 &&
                  chapters.every((ep) => selectedChapterIds.has(ep.id))
                }
                readOnly
                className="size-3 rounded border-border accent-primary cursor-pointer"
              />
              <span>All Chapters</span>
            </button>

            {selectedChapterIds.size > 0 && (
              <button
                type="button"
                onClick={async () => {
                  if (!studio) {
                    toast.error('Editor not ready');
                    return;
                  }
                  setIsSendingChapters(true);
                  try {
                    // Gather all scenes from selected chapters in order
                    const selectedEps = chapters.filter((ep) =>
                      selectedChapterIds.has(ep.id)
                    );
                    const allScenes: SceneForTimeline[] = [];
                    for (const ep of selectedEps) {
                      for (const scene of ep.scenes) {
                        if (scene.video_url || scene.audio_url) {
                          allScenes.push(scene as SceneForTimeline);
                        }
                      }
                    }
                    if (allScenes.length === 0) {
                      toast.error(
                        'No scenes with audio/video in selected chapters'
                      );
                      setIsSendingChapters(false);
                      return;
                    }

                    const settings: SceneTimelineSettings[] = allScenes.map(
                      (s) => ({
                        sceneId: s.id,
                        matchVideoToAudio: !!(s.audio_text || s.audio_url),
                      })
                    );
                    const results = await buildSceneClips({
                      scenes: allScenes,
                      settings,
                      canvasWidth: canvasSize.width,
                      canvasHeight: canvasSize.height,
                    });

                    const hasAnyVideo = results.some((r) => r.videoClip);
                    const hasAnyAudio = results.some((r) => r.audioClip);

                    let videoTrackId: string | undefined;
                    let audioTrackId: string | undefined;

                    if (hasAnyVideo) {
                      const track = studio.addTrack({
                        type: 'Video',
                        name: 'Chapter Video',
                      });
                      videoTrackId = track.id;
                    }
                    if (hasAnyAudio) {
                      const track = studio.addTrack({
                        type: 'Audio',
                        name: 'Chapter Audio',
                      });
                      audioTrackId = track.id;
                    }

                    for (const result of results) {
                      if (result.videoClip && videoTrackId) {
                        await studio.addClip(result.videoClip, {
                          trackId: videoTrackId,
                        });
                      }
                      if (result.audioClip && audioTrackId) {
                        await studio.addClip(result.audioClip, {
                          trackId: audioTrackId,
                        });
                      }
                    }

                    const videoCount = results.filter(
                      (r) => r.videoClip
                    ).length;
                    const audioCount = results.filter(
                      (r) => r.audioClip
                    ).length;
                    toast.success(
                      `Added ${videoCount} video + ${audioCount} audio clips from ${selectedEps.length} chapter${selectedEps.length > 1 ? 's' : ''}`
                    );
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : 'Failed to send to timeline'
                    );
                  } finally {
                    setIsSendingChapters(false);
                  }
                }}
                disabled={isSendingChapters}
                className="ml-auto inline-flex items-center gap-1 h-6 px-2 rounded border border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isSendingChapters ? (
                  <IconLoader2 className="size-3 animate-spin" />
                ) : (
                  <IconSend className="size-3" />
                )}
                {selectedChapterIds.size} CH
                {selectedChapterIds.size > 1 ? 's' : ''} → Timeline
              </button>
            )}
          </div>
        )}

        {/* ── Live generation status (persists during realtime work) ── */}
        {chapters.length > 0 &&
          (() => {
            const allScenes = chapters.flatMap((ch) => ch.scenes);
            const genVideo = allScenes.filter(
              (s) => s.video_status === 'generating'
            ).length;
            const genTts = allScenes.filter(
              (s) => s.tts_status === 'generating'
            ).length;
            if (genVideo === 0 && genTts === 0) return null;
            const parts: string[] = [];
            if (genVideo > 0)
              parts.push(`${genVideo} video${genVideo > 1 ? 's' : ''}`);
            if (genTts > 0) parts.push(`${genTts} TTS`);
            return (
              <div className="flex items-center gap-1.5 px-1 py-1.5 border-b border-border/20 mb-1">
                <IconLoader2 className="size-3 text-yellow-400 animate-spin shrink-0" />
                <span className="text-[10px] text-yellow-400 font-medium">
                  Generating {parts.join(' + ')}…
                </span>
              </div>
            );
          })()}

        {/* ── Video-level bulk actions ───────────────────────────────── */}
        {chapters.length > 0 &&
          (() => {
            const allScenes = chapters.flatMap((ch) => ch.scenes);
            const failedVideoScenes = allScenes.filter(
              (s) => s.video_status === 'failed' && !s.video_url
            );
            // Scenes whose video generation was never submitted at all —
            // idle state, no URL, prompt ready, and (for narrative scenes)
            // TTS already present.
            const untriedVideoScenes = allScenes.filter((s) => {
              if (
                !s.prompt ||
                s.video_url ||
                s.video_status === 'generating' ||
                s.video_status === 'failed' ||
                s.video_status === 'done'
              )
                return false;
              if (s.audio_text && !s.audio_url) return false;
              return true;
            });
            const failedTtsScenes = allScenes.filter(
              (s) => s.tts_status === 'failed' && !s.audio_url && !!s.audio_text
            );
            const pendingTtsScenes = allScenes.filter(
              (s) =>
                !!s.audio_text && !s.audio_url && s.tts_status !== 'generating'
            );
            const isRunning = videoLevelBatch !== null;

            if (
              failedVideoScenes.length === 0 &&
              untriedVideoScenes.length === 0 &&
              failedTtsScenes.length === 0 &&
              pendingTtsScenes.length === 0
            )
              return null;

            return (
              <div className="flex flex-wrap items-center gap-1.5 px-1 py-1.5 border-b border-border/20 mb-1">
                <span className="text-[9px] text-muted-foreground/60 mr-1">
                  Video Actions:
                </span>

                {untriedVideoScenes.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      setVideoLevelBatch({
                        type: 'generate-missing',
                        done: 0,
                        total: untriedVideoScenes.length,
                      });
                      let failures = 0;
                      const missingSlugs = new Set<string>();
                      let firstError: string | undefined;
                      try {
                        for (const [i, scene] of untriedVideoScenes.entries()) {
                          const result = await callGenerateApi(
                            `/api/v2/scenes/${scene.id}/generate-video`
                          );
                          if (!result.ok) {
                            failures++;
                            if (!firstError && result.error)
                              firstError = result.error;
                            for (const s of result.missing_slugs ?? [])
                              missingSlugs.add(s);
                          }
                          setVideoLevelBatch({
                            type: 'generate-missing',
                            done: i + 1,
                            total: untriedVideoScenes.length,
                          });
                        }
                        if (failures === 0) {
                          toast.success(
                            `Started generation for ${untriedVideoScenes.length} scene(s)`
                          );
                        } else if (missingSlugs.size > 0) {
                          const slugList = Array.from(missingSlugs).join(', ');
                          toast.error(
                            `Missing variant images — generate these first: ${slugList}`
                          );
                        } else {
                          toast.error(
                            `Failed to start ${failures}/${untriedVideoScenes.length} scene(s)${
                              firstError ? `: ${firstError}` : ''
                            }`
                          );
                        }
                      } finally {
                        setVideoLevelBatch(null);
                      }
                    }}
                    disabled={isRunning}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Scenes that were never submitted to the video generator"
                  >
                    <IconSparkles className="size-2.5" />
                    Generate Missing Video ({untriedVideoScenes.length})
                  </button>
                )}

                {failedVideoScenes.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      setVideoLevelBatch({
                        type: 'retry',
                        done: 0,
                        total: failedVideoScenes.length,
                      });
                      try {
                        for (const [i, scene] of failedVideoScenes.entries()) {
                          await callGenerateApi(
                            `/api/v2/scenes/${scene.id}/generate-video`
                          );
                          setVideoLevelBatch({
                            type: 'retry',
                            done: i + 1,
                            total: failedVideoScenes.length,
                          });
                        }
                        toast.success(
                          `Retried ${failedVideoScenes.length} failed video(s)`
                        );
                      } catch {
                        toast.error('Retry failed');
                      } finally {
                        setVideoLevelBatch(null);
                      }
                    }}
                    disabled={isRunning}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <IconRefresh className="size-2.5" />
                    Retry Failed ({failedVideoScenes.length})
                  </button>
                )}

                {failedVideoScenes.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      setVideoLevelBatch({
                        type: 'retry-fal',
                        done: 0,
                        total: failedVideoScenes.length,
                      });
                      try {
                        for (const [i, scene] of failedVideoScenes.entries()) {
                          await callGenerateApi(
                            `/api/v2/scenes/${scene.id}/generate-video`,
                            { provider: 'fal' }
                          );
                          setVideoLevelBatch({
                            type: 'retry-fal',
                            done: i + 1,
                            total: failedVideoScenes.length,
                          });
                        }
                        toast.success(
                          `Retried ${failedVideoScenes.length} video(s) via fal.ai`
                        );
                      } catch {
                        toast.error('fal.ai retry failed');
                      } finally {
                        setVideoLevelBatch(null);
                      }
                    }}
                    disabled={isRunning}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <IconRefresh className="size-2.5" />
                    Retry fal.ai ({failedVideoScenes.length})
                  </button>
                )}

                {pendingTtsScenes.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      setVideoLevelBatch({
                        type: 'tts',
                        done: 0,
                        total: pendingTtsScenes.length,
                      });
                      try {
                        for (const [i, scene] of pendingTtsScenes.entries()) {
                          await callGenerateApi(
                            `/api/v2/scenes/${scene.id}/generate-tts`
                          );
                          setVideoLevelBatch({
                            type: 'tts',
                            done: i + 1,
                            total: pendingTtsScenes.length,
                          });
                        }
                        toast.success(
                          `Generated TTS for ${pendingTtsScenes.length} scene(s)`
                        );
                      } catch {
                        toast.error('TTS generation failed');
                      } finally {
                        setVideoLevelBatch(null);
                      }
                    }}
                    disabled={isRunning}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <IconSparkles className="size-2.5" />
                    Generate TTS ({pendingTtsScenes.length})
                  </button>
                )}

                {failedTtsScenes.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      setVideoLevelBatch({
                        type: 'retry-tts',
                        done: 0,
                        total: failedTtsScenes.length,
                      });
                      try {
                        for (const [i, scene] of failedTtsScenes.entries()) {
                          await callGenerateApi(
                            `/api/v2/scenes/${scene.id}/generate-tts`
                          );
                          setVideoLevelBatch({
                            type: 'retry-tts',
                            done: i + 1,
                            total: failedTtsScenes.length,
                          });
                        }
                        toast.success(
                          `Retried ${failedTtsScenes.length} failed TTS scene(s)`
                        );
                      } catch {
                        toast.error('TTS retry failed');
                      } finally {
                        setVideoLevelBatch(null);
                      }
                    }}
                    disabled={isRunning}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <IconRefresh className="size-2.5" />
                    Retry Failed TTS ({failedTtsScenes.length})
                  </button>
                )}

                {failedTtsScenes.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      setVideoLevelBatch({
                        type: 'retry-tts-fal',
                        done: 0,
                        total: failedTtsScenes.length,
                      });
                      try {
                        for (const [i, scene] of failedTtsScenes.entries()) {
                          await callGenerateApi(
                            `/api/v2/scenes/${scene.id}/generate-tts`,
                            { provider: 'fal' }
                          );
                          setVideoLevelBatch({
                            type: 'retry-tts-fal',
                            done: i + 1,
                            total: failedTtsScenes.length,
                          });
                        }
                        toast.success(
                          `Retried ${failedTtsScenes.length} TTS scene(s) via fal.ai`
                        );
                      } catch {
                        toast.error('fal.ai TTS retry failed');
                      } finally {
                        setVideoLevelBatch(null);
                      }
                    }}
                    disabled={isRunning}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <IconRefresh className="size-2.5" />
                    Retry fal.ai TTS ({failedTtsScenes.length})
                  </button>
                )}

                {isRunning && videoLevelBatch && (
                  <span className="text-[9px] text-yellow-400 ml-1">
                    {videoLevelBatch.type === 'retry'
                      ? 'Retrying'
                      : videoLevelBatch.type === 'retry-fal'
                        ? 'Retrying (fal.ai)'
                        : videoLevelBatch.type === 'retry-tts'
                          ? 'Retrying TTS'
                          : videoLevelBatch.type === 'retry-tts-fal'
                            ? 'Retrying TTS (fal.ai)'
                            : videoLevelBatch.type === 'generate-missing'
                              ? 'Generating missing'
                              : 'Generating TTS'}{' '}
                    {videoLevelBatch.done}/{videoLevelBatch.total}...
                  </span>
                )}
              </div>
            );
          })()}

        {/* Full Script — all voiceovers combined */}
        {chapters.some((ch) => ch.scenes.some((s) => s.audio_text)) && (
          <FullScriptSection chapters={chapters} />
        )}

        {/* Video-level Assets — includes video-owned assets + scene-referenced */}
        {imageMap.size > 0 &&
          (() => {
            // Merge video-level asset slugs with scene-referenced slugs
            const allLocationSlugs = [
              ...new Set([
                ...videoAssetSlugs.locations,
                ...chapters.flatMap((ch) =>
                  ch.scenes
                    .map((s) => s.location_variant_slug)
                    .filter((s): s is string => !!s)
                ),
              ]),
            ];
            const allCharacterSlugs = [
              ...new Set([
                ...videoAssetSlugs.characters,
                ...chapters.flatMap((ch) =>
                  ch.scenes.flatMap((s) => s.character_variant_slugs ?? [])
                ),
              ]),
            ];
            const allPropSlugs = [
              ...new Set([
                ...videoAssetSlugs.props,
                ...chapters.flatMap((ch) =>
                  ch.scenes.flatMap((s) => s.prop_variant_slugs ?? [])
                ),
              ]),
            ];
            const totalAssets =
              allLocationSlugs.length +
              allCharacterSlugs.length +
              allPropSlugs.length;
            if (totalAssets === 0) return null;

            return (
              <VideoAssetsSection
                locationSlugs={allLocationSlugs}
                characterSlugs={allCharacterSlugs}
                propSlugs={allPropSlugs}
                imageMap={imageMap}
                totalAssets={totalAssets}
              />
            );
          })()}

        {/* Video Music */}
        <ProjectMusicSection projectId={projectId} videoId={videoId} />

        {/* Chapter list */}
        {chapters.length > 0 && (
          <Collapsible open={chaptersOpen} onOpenChange={setChaptersOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md bg-muted/15 border border-border/30 text-left hover:bg-muted/25 transition-colors"
              >
                <IconMovie className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-[11px] font-medium flex-1">Chapters</span>
                <span className="text-[9px] text-muted-foreground/60">
                  {chapters.length}
                </span>
                {chaptersOpen ? (
                  <IconChevronUp className="size-3 text-muted-foreground" />
                ) : (
                  <IconChevronDown className="size-3 text-muted-foreground" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 space-y-2">
                {chapters.map((ep) => (
                  <ChapterAccordion
                    key={ep.id}
                    chapter={ep}
                    imageMap={imageMap}
                    isChapterSelected={selectedChapterIds.has(ep.id)}
                    onToggleChapterSelected={() => {
                      setSelectedChapterIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(ep.id)) {
                          next.delete(ep.id);
                        } else {
                          next.add(ep.id);
                        }
                        return next;
                      });
                    }}
                    forceOpen={storyboardForceOpen}
                    focusedSceneId={focusedSceneId}
                    onSceneDeleted={(sceneId) => {
                      setChapters((prev) =>
                        prev.map((ch) =>
                          ch.id === ep.id
                            ? {
                                ...ch,
                                scenes: ch.scenes.filter(
                                  (s) => s.id !== sceneId
                                ),
                              }
                            : ch
                        )
                      );
                    }}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        <DeleteVideoDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          videoName={allVideo.find((v) => v.id === videoId)?.name ?? ''}
          onConfirm={handleDeleteVideo}
        />
      </div>
    </ScrollArea>
  );
}
