'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useProjectId } from '@/contexts/project-context';
import { createClient } from '@/lib/supabase/client';
import { clearTimeline } from '@/lib/supabase/timeline-service';
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
  IconSelectAll,
  IconFileText,
  IconPencil,
  IconDeviceFloppy,
} from '@tabler/icons-react';
import { useChapterFocusStore } from '@/stores/chapter-focus-store';
import { usePanelCollapseStore } from '@/stores/panel-collapse-store';
import { useVideoSelectorStore } from '@/stores/video-selector-store';
import { CopyButton } from '../shared/copy-button';
import { ExpandableText } from '../shared/expandable-text';

// ── Types ──────────────────────────────────────────────────────────────────────

type VideoOption = { id: string; name: string };

interface SceneData {
  id: string;
  order: number;
  title: string | null;
  prompt: string | null;
  audio_text: string | null;
  audio_url: string | null;
  audio_duration: number | null;
  video_url: string | null;
  video_duration: number | null;
  status: string | null;
  location_variant_slug: string | null;
  character_variant_slugs: string[];
  prop_variant_slugs: string[];
  tts_status: string;
  video_status: string;
}

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

/** slug → variant info lookup */
interface VariantInfo {
  image_url: string | null;
  id: string;
  image_gen_status: string;
}
type VariantImageMap = Map<string, VariantInfo>;

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: string | null): string {
  switch (status) {
    case 'done':
      return 'border-green-500/40 bg-green-500/10 text-green-400';
    case 'partial':
    case 'ready':
      return 'border-blue-500/40 bg-blue-500/10 text-blue-400';
    case 'generating':
      return 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400';
    case 'failed':
      return 'border-red-500/40 bg-red-500/10 text-red-400';
    default:
      return 'border-border/60 bg-secondary/20 text-muted-foreground';
  }
}

function slugToLabel(slug: string): string {
  return slug
    .replace(/-main$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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

/** Derive a display status from generation states + URL presence.
 *  URL presence takes priority over stale failed status — if the asset
 *  was successfully re-generated the URL proves it succeeded. */
function deriveSceneStatus(scene: SceneData): string {
  if (scene.tts_status === 'generating' || scene.video_status === 'generating')
    return 'generating';

  // Check URL-based completion first — a present URL means the asset
  // succeeded even if a previous attempt left a stale 'failed' status.
  const ttsOk = !scene.audio_text?.trim() || !!scene.audio_url;
  const videoOk = !!scene.video_url;

  if (ttsOk && videoOk) return 'done';

  // Only show failed if the status says failed AND the URL is still missing
  const ttsFailed = scene.tts_status === 'failed' && !scene.audio_url;
  const videoFailed = scene.video_status === 'failed' && !scene.video_url;
  if (ttsFailed || videoFailed) return 'failed';

  if (scene.audio_url || scene.video_url) return 'partial';
  if (scene.prompt) return 'ready';
  return 'draft';
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
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

function HighlightedPrompt({
  prompt,
  locationSlug,
  characterSlugs,
  propSlugs,
  imageMap,
}: {
  prompt: string;
  locationSlug: string | null;
  characterSlugs: string[];
  propSlugs: string[];
  imageMap: VariantImageMap;
}) {
  const colorMap = new Map<string, string>();
  if (locationSlug)
    colorMap.set(locationSlug, 'text-emerald-400 bg-emerald-500/15');
  for (const s of characterSlugs)
    colorMap.set(s, 'text-blue-400 bg-blue-500/15');
  for (const s of propSlugs) colorMap.set(s, 'text-amber-400 bg-amber-500/15');

  const pattern = /@([a-z0-9]+(?:-[a-z0-9]+)*)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(prompt)) !== null) {
    if (match.index > lastIndex) {
      parts.push(prompt.slice(lastIndex, match.index));
    }
    const slug = match[1];
    const color = colorMap.get(slug);
    if (color) {
      parts.push(
        <span
          key={match.index}
          className={`${color} rounded px-0.5 font-medium inline-flex items-center gap-0.5`}
        >
          <VariantAvatar slug={slug} imageMap={imageMap} />@{slugToLabel(slug)}
        </span>
      );
    } else {
      parts.push(
        <span
          key={match.index}
          className="text-purple-400 bg-purple-500/15 rounded px-0.5 font-medium"
        >
          @{slug}
        </span>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < prompt.length) {
    parts.push(prompt.slice(lastIndex));
  }

  return <>{parts}</>;
}

// ── Generate API Calls ─────────────────────────────────────────────────────────

async function callGenerateApi(
  path: string,
  body: Record<string, unknown> = {}
): Promise<{ ok: boolean; task_id?: string; error?: string }> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok)
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, task_id: data.task_id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

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
      <span className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 animate-pulse font-medium">
        <IconLoader2 className="size-3 animate-spin" />
        Generating {label}...
      </span>
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
  const [isRetrying, setIsRetrying] = useState(false);
  const label = slugToLabel(slug);

  const handleRetry = async () => {
    if (!variantId || isRetrying) return;
    setIsRetrying(true);
    try {
      const res = await fetch(`/api/v2/variants/${variantId}/generate-image`, {
        method: 'POST',
      });
      if (res.ok) {
        (await import('sonner')).toast.success(`Image regenerating: ${label}`);
      } else {
        const data = await res.json().catch(() => ({}));
        (await import('sonner')).toast.error(data.error ?? 'Failed to retry image');
      }
    } catch {
      (await import('sonner')).toast.error('Network error');
    } finally {
      setIsRetrying(false);
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
            <span className="text-[8px] text-muted-foreground">?</span>
          </div>
        )}
        {/* Retry overlay */}
        {variantId && (
          <button
            type="button"
            onClick={() => void handleRetry()}
            disabled={isRetrying}
            className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-md opacity-0 group-hover:opacity-100 transition-opacity disabled:cursor-not-allowed"
            title={`Regenerate ${label}`}
          >
            {isRetrying ? (
              <IconLoader2 className="size-3.5 text-white animate-spin" />
            ) : (
              <IconRefresh className="size-3.5 text-white" />
            )}
          </button>
        )}
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
}: {
  scene: SceneData;
  index: number;
  imageMap: VariantImageMap;
  isSelected: boolean;
  onToggleSelected: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localTtsStatus, setLocalTtsStatus] = useState<string | null>(null);
  const [localVideoStatus, setLocalVideoStatus] = useState<string | null>(null);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editPromptText, setEditPromptText] = useState('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

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
      className={`rounded-md overflow-hidden transition-colors ${isSelected ? 'border-2 border-primary/60 bg-primary/5' : 'border border-border/40 bg-card/50'}`}
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

      {/* Expanded: Full prompt with highlighted slugs + avatars + copy + edit */}
      {isExpanded && (hasPrompt || isEditingPrompt) && (
        <div className="px-3 pb-3 pt-1 border-t border-border/20">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Visual Prompt
            </p>
            <div className="flex items-center gap-1">
              {!isEditingPrompt && hasPrompt && (
                <CopyButton text={scene.prompt!} />
              )}
              {isEditingPrompt ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsEditingPrompt(false)}
                    className="text-[9px] px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSavingPrompt || editPromptText.trim() === (scene.prompt ?? '')}
                    onClick={async () => {
                      setIsSavingPrompt(true);
                      try {
                        const supabase = (await import('@/lib/supabase/client')).createClient('studio');
                        const { error } = await supabase
                          .from('scenes')
                          .update({ prompt: editPromptText.trim() })
                          .eq('id', scene.id);
                        if (error) throw new Error(error.message);
                        scene.prompt = editPromptText.trim();
                        setIsEditingPrompt(false);
                        (await import('sonner')).toast.success('Prompt saved');
                      } catch (err) {
                        (await import('sonner')).toast.error(
                          err instanceof Error ? err.message : 'Failed to save'
                        );
                      } finally {
                        setIsSavingPrompt(false);
                      }
                    }}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isSavingPrompt ? (
                      <IconLoader2 className="size-2.5 animate-spin" />
                    ) : (
                      <IconDeviceFloppy className="size-2.5" />
                    )}
                    Save
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditPromptText(scene.prompt ?? '');
                    setIsEditingPrompt(true);
                  }}
                  className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                  title="Edit prompt"
                >
                  <IconPencil className="size-2.5" />
                  Edit
                </button>
              )}
            </div>
          </div>
          {isEditingPrompt ? (
            <textarea
              value={editPromptText}
              onChange={(e) => setEditPromptText(e.target.value)}
              className="w-full text-[11px] leading-relaxed text-foreground/80 bg-muted/20 rounded-md p-2.5 border border-primary/30 focus:border-primary/50 outline-none resize-y min-h-[80px]"
              rows={6}
              autoFocus
            />
          ) : (
            <div className="text-[11px] leading-relaxed text-foreground/80 bg-muted/20 rounded-md p-2.5 border border-border/20">
              <HighlightedPrompt
                prompt={scene.prompt!}
                locationSlug={scene.location_variant_slug}
                characterSlugs={scene.character_variant_slugs ?? []}
                propSlugs={scene.prop_variant_slugs ?? []}
                imageMap={imageMap}
              />
            </div>
          )}
        </div>
      )}

      {isExpanded && !hasPrompt && !isEditingPrompt && (
        <div className="px-3 pb-3 pt-1 border-t border-border/20">
          <p className="text-[10px] text-muted-foreground/50 italic">
            No visual prompt written yet.
          </p>
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
    </div>
  );
}

// ── Gallery Card (expandable) ──────────────────────────────────────────────────

function GalleryCard({
  slug,
  imageMap,
  fallbackIcon: FallbackIcon,
}: {
  slug: string;
  imageMap: VariantImageMap;
  fallbackIcon: React.FC<{ className?: string }>;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const info = imageMap.get(slug);
  const url = info?.image_url;

  return (
    <div className="flex flex-col items-center gap-1">
      {url ? (
        <>
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="w-full aspect-[9/16] rounded-md overflow-hidden border border-border/30 cursor-pointer hover:ring-2 hover:ring-primary/50 hover:brightness-110 transition-all relative group"
          >
            <img
              src={url}
              alt={slugToLabel(slug)}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <IconEye className="size-4 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
            </div>
          </button>
          {lightboxOpen && (
            <ImageLightbox
              url={url}
              label={slugToLabel(slug)}
              onClose={() => setLightboxOpen(false)}
            />
          )}
        </>
      ) : (
        <div className="w-full aspect-[9/16] rounded-md bg-muted/30 border border-border/30 flex items-center justify-center">
          <FallbackIcon className="size-4 text-muted-foreground/30" />
        </div>
      )}
      <span className="text-[8px] text-muted-foreground text-center leading-tight truncate w-full">
        {slugToLabel(slug)}
      </span>
      {info && (
        <GenerateButton
          label="Image"
          genStatus={info.image_gen_status}
          hasResult={!!url}
          size="md"
          onClick={() => {
            callGenerateApi(`/api/v2/variants/${info.id}/generate-image`);
          }}
        />
      )}
    </div>
  );
}

// ── Asset Gallery ──────────────────────────────────────────────────────────────

function AssetGallery({
  slugs,
  role,
  imageMap,
}: {
  slugs: string[];
  role: 'character' | 'location' | 'prop';
  imageMap: VariantImageMap;
}) {
  if (slugs.length === 0) return null;

  const roleConfig = {
    character: { icon: IconUser, color: 'blue', label: 'Characters' },
    location: { icon: IconMapPin, color: 'emerald', label: 'Locations' },
    prop: { icon: IconBox, color: 'amber', label: 'Props' },
  }[role];

  const Icon = roleConfig.icon;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Icon className="size-3" />
        <span className="font-medium">{roleConfig.label}</span>
        <span className="opacity-50">({slugs.length})</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {slugs.map((slug) => (
          <GalleryCard
            key={slug}
            slug={slug}
            imageMap={imageMap}
            fallbackIcon={Icon}
          />
        ))}
      </div>
    </div>
  );
}

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
      matchVideoToAudio: !!s.audio_text, // default ON for narrative
    }))
  );
  const [isSending, setIsSending] = useState(false);

  // Reset settings when scenes change
  useEffect(() => {
    setSettings(
      scenes.map((s) => ({
        sceneId: s.id,
        matchVideoToAudio: !!s.audio_text,
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

      const videoCount = hasAnyVideo ? results.filter((r) => r.videoClip).length : 0;
      const audioCount = hasAnyAudio ? results.filter((r) => r.audioClip).length : 0;
      const modeLabel = mediaMode === 'video-only' ? 'video' : mediaMode === 'audio-only' ? 'audio' : 'video + audio';
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

              const isNarrative = !!scene.audio_text;
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

                  {/* Speed match toggle (narrative only) */}
                  {isNarrative && hasAudio && hasVideo && (
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
      (ch) =>
        `CH${ch.order}: ${ch.title ?? 'Untitled'}\n${ch.lines.join('\n')}`
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
}: {
  chapter: ChapterData;
  imageMap: VariantImageMap;
  isChapterSelected: boolean;
  onToggleChapterSelected: () => void;
  forceOpen?: boolean | null;
}) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (forceOpen !== null && forceOpen !== undefined) {
      setIsOpen(forceOpen);
    }
  }, [forceOpen]);
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
    (scene) => !!scene.audio_text && !scene.audio_url
  ).length;
  const selectedVideoCount = selectedSceneList.filter((scene) => {
    if (!scene.prompt || scene.video_url) return false;
    // Don't count narrative scenes that need TTS first
    if (scene.audio_text && !scene.audio_url) return false;
    return true;
  }).length;
  const failedVideoScenes = chapter.scenes.filter(
    (scene) => scene.video_status === 'failed' && !scene.video_url && !!scene.prompt
  );
  const failedVideoCount = failedVideoScenes.length;
  const [retryBatchProgress, setRetryBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const isBatchRunning =
    ttsBatchProgress !== null || videoBatchProgress !== null || retryBatchProgress !== null;

  const { focusedChapterId, setFocus, clearFocus } = useChapterFocusStore();
  const isThisChapterFocused = focusedChapterId === chapter.id;

  const handleFilterAssets = () => {
    if (isThisChapterFocused) {
      clearFocus();
      return;
    }
    // Collect all variant slugs used in this chapter's scenes
    const allSlugs = [
      ...locationSlugs,
      ...characterSlugs,
      ...propSlugs,
    ];
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
        selectedScenes.has(scene.id) && !!scene.audio_text && !scene.audio_url
    );
    if (targets.length < 1) return;

    setTtsBatchProgress({ done: 0, total: targets.length });
    try {
      for (const [index, scene] of targets.entries()) {
        await callGenerateApi(`/api/v2/scenes/${scene.id}/generate-tts`);
        setTtsBatchProgress({ done: index + 1, total: targets.length });
      }
    } finally {
      setTtsBatchProgress(null);
    }
  };

  const runBatchVideo = async () => {
    const targets = chapter.scenes.filter((scene) => {
      if (!selectedScenes.has(scene.id) || !scene.prompt || scene.video_url)
        return false;
      // Skip narrative scenes that still need TTS
      const isNarrative = !!scene.audio_text;
      if (isNarrative && !scene.audio_url) return false;
      return true;
    });
    if (targets.length < 1) return;

    setVideoBatchProgress({ done: 0, total: targets.length });
    try {
      for (const [index, scene] of targets.entries()) {
        await callGenerateApi(`/api/v2/scenes/${scene.id}/generate-video`);
        setVideoBatchProgress({ done: index + 1, total: targets.length });
      }
    } finally {
      setVideoBatchProgress(null);
    }
  };

  const runRetryFailedVideos = async () => {
    if (failedVideoScenes.length < 1) return;

    setRetryBatchProgress({ done: 0, total: failedVideoScenes.length });
    try {
      for (const [index, scene] of failedVideoScenes.entries()) {
        await callGenerateApi(`/api/v2/scenes/${scene.id}/generate-video`);
        setRetryBatchProgress({ done: index + 1, total: failedVideoScenes.length });
      }
    } finally {
      setRetryBatchProgress(null);
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
                  role="location"
                  imageMap={imageMap}
                />
                <AssetGallery
                  slugs={characterSlugs}
                  role="character"
                  imageMap={imageMap}
                />
                <AssetGallery
                  slugs={propSlugs}
                  role="prop"
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);
  const prevVideoIdRef = useRef<string | null>(null);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(
    new Set()
  );
  const [isSendingChapters, setIsSendingChapters] = useState(false);
  const { studio } = useStudioStore();
  const { canvasSize } = useProjectStore();
  const { toggleAll, getForceOpen } = usePanelCollapseStore();
  const storyboardForceOpen = getForceOpen('storyboard');

  // Helper to set video both locally and in persistent store
  const setVideoId = useCallback(
    (id: string | null) => {
      setVideoIdLocal(id);
      if (id && projectId) persistVideoId(projectId, id);
    },
    [projectId, persistVideoId]
  );

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
              'id, chapter_id, "order", title, prompt, audio_text, audio_url, audio_duration, video_url, video_duration, status, location_variant_slug, character_variant_slugs, prop_variant_slugs, tts_status, video_status'
            )
            .in('chapter_id', epIds)
            .order('"order"', { ascending: true });

          if (scError) throw new Error(scError.message);
          allScenes = (sceneRows ?? []) as unknown as (SceneData & {
            chapter_id: string;
          })[];
        }

        // Collect all unique variant slugs across scenes
        const slugSet = new Set<string>();
        for (const s of allScenes as (SceneData & { chapter_id: string })[]) {
          if (s.location_variant_slug) slugSet.add(s.location_variant_slug);
          for (const c of s.character_variant_slugs ?? []) slugSet.add(c);
          for (const p of s.prop_variant_slugs ?? []) slugSet.add(p);
        }

        // Fetch variant info for all referenced slugs
        const newImageMap = new Map<string, VariantInfo>();
        if (slugSet.size > 0) {
          const { data: variantRows } = await supabase
            .from('project_asset_variants')
            .select('id, slug, image_url, image_gen_status')
            .in('slug', [...slugSet]);

          for (const v of variantRows ?? []) {
            if (v.slug) {
              newImageMap.set(v.slug, {
                id: v.id,
                image_url: v.image_url,
                image_gen_status: v.image_gen_status ?? 'idle',
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
      .subscribe();

    const variantSub = supabaseRT
      .channel('storyboard-variants')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'studio', table: 'project_asset_variants' },
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

  // ── Auto-reload timeline when video selection changes ─────────────────────
  useEffect(() => {
    // Skip the initial mount — only react to actual user-driven video changes
    if (prevVideoIdRef.current === null) {
      prevVideoIdRef.current = videoId;
      return;
    }
    if (videoId === prevVideoIdRef.current) return;
    prevVideoIdRef.current = videoId;

    if (!videoId || !studio || !projectId) return;

    let cancelled = false;

    const reloadTimeline = async () => {
      try {
        // 1. Clear existing timeline (UI + DB)
        studio.clear();
        await clearTimeline(projectId);

        if (cancelled) return;

        // 2. Fetch scenes for the NEW video directly from DB (don't rely on stale state)
        const supabase = createClient('studio');
        const { data: chapterRows } = await supabase
          .from('chapters')
          .select('id')
          .eq('video_id', videoId)
          .order('"order"', { ascending: true });

        const chapterIds = (chapterRows ?? []).map((c: { id: string }) => c.id);
        if (chapterIds.length === 0 || cancelled) {
          if (!cancelled) toast.info('No chapters in this video');
          return;
        }

        const { data: sceneRows } = await supabase
          .from('scenes')
          .select(
            'id, chapter_id, "order", prompt, audio_text, audio_url, audio_duration, video_url, video_duration'
          )
          .in('chapter_id', chapterIds)
          .order('"order"', { ascending: true });

        if (cancelled) return;

        const allScenes: SceneForTimeline[] = ((sceneRows ?? []) as unknown as SceneForTimeline[]).filter(
          (s) => s.video_url || s.audio_url
        );

        if (allScenes.length === 0) {
          toast.info('No scenes with media in this video');
          return;
        }

        // 3. Build clips
        const settings: SceneTimelineSettings[] = allScenes.map((s) => ({
          sceneId: s.id,
          matchVideoToAudio: !!s.audio_text,
        }));
        const results = await buildSceneClips({
          scenes: allScenes,
          settings,
          canvasWidth: canvasSize.width,
          canvasHeight: canvasSize.height,
        });

        if (cancelled) return;

        // 4. Create tracks & add clips
        const hasAnyVideo = results.some((r) => r.videoClip);
        const hasAnyAudio = results.some((r) => r.audioClip);

        let videoTrackId: string | undefined;
        let audioTrackId: string | undefined;

        if (hasAnyVideo) {
          const track = studio.addTrack({ type: 'Video', name: 'Video' });
          videoTrackId = track.id;
        }
        if (hasAnyAudio) {
          const track = studio.addTrack({ type: 'Audio', name: 'Voiceover' });
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

        if (cancelled) return;

        const videoCount = results.filter((r) => r.videoClip).length;
        const audioCount = results.filter((r) => r.audioClip).length;
        toast.success(
          `Timeline reloaded: ${videoCount} video + ${audioCount} audio clips`
        );
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to reload timeline:', err);
          toast.error('Failed to reload timeline');
        }
      }
    };

    reloadTimeline();

    return () => {
      cancelled = true;
    };
  }, [videoId, studio, projectId, canvasSize]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="p-3 border-b border-border/20">
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
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-4 text-center gap-2">
          <IconMovie className="size-8 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">No chapters yet.</p>
          <p className="text-[10px] text-muted-foreground/50">
            Create chapters via API to see the storyboard.
          </p>
        </div>
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
              title={storyboardForceOpen === true ? 'Collapse all chapters' : 'Expand all chapters'}
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

                    // Build clips with matchVideoToAudio for all narrative scenes
                    const settings: SceneTimelineSettings[] = allScenes.map(
                      (s) => ({
                        sceneId: s.id,
                        matchVideoToAudio: !!s.audio_text,
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

        {/* Full Script — all voiceovers combined */}
        {chapters.some((ch) =>
          ch.scenes.some((s) => s.audio_text)
        ) && <FullScriptSection chapters={chapters} />}

        {/* Chapter list */}
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
          />
        ))}
      </div>
    </ScrollArea>
  );
}
