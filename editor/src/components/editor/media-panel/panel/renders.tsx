'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useProjectId } from '@/contexts/project-context';
import { useStudioStore } from '@/stores/studio-store';
import { useProjectStore } from '@/stores/project-store';
import { Video, Log } from 'openvideo';
import {
  Loader2,
  Download,
  Copy,
  Check,
  Plus,
  Maximize2,
  Minimize2,
  X,
  Trash2,
  Send,
  Share2,
  Flame,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  IconDeviceTv,
  IconPlayerPlay,
  IconPlayerPause,
} from '@tabler/icons-react';
import type { RenderedVideo } from '@/types/rendered-video';
import { useDeleteConfirmation } from '@/contexts/delete-confirmation-context';
import { createClient } from '@/lib/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function parseResolution(resolution: string | null): {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape' | 'square';
} | null {
  if (!resolution) return null;
  const match = resolution.match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  if (width === 0 || height === 0) return null;
  const orientation =
    width === height ? 'square' : width < height ? 'portrait' : 'landscape';
  return { width, height, orientation };
}

function getAspectRatio(resolution: string | null): string {
  const parsed = parseResolution(resolution);
  if (!parsed) return '16 / 9';
  return `${parsed.width} / ${parsed.height}`;
}

function getGridStyle(
  resolution: string | null,
  cardSize: number
): React.CSSProperties {
  const parsed = parseResolution(resolution);
  if (!parsed || parsed.orientation === 'landscape') return {};
  const baseMin = parsed.orientation === 'portrait' ? 120 : 150;
  const minWidth = baseMin + cardSize * 2;
  return {
    gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
  };
}

interface RenderBatch {
  date: string;
  resolution: string | null;
  renders: RenderedVideo[];
}

function groupIntoBatches(renders: RenderedVideo[]): RenderBatch[] {
  // Filter out shorts — they'll be nested under their parent
  const topLevel = renders.filter((r) => r.type !== 'short');
  if (topLevel.length === 0) return [];

  const sorted = [...topLevel].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const batches: RenderBatch[] = [];
  let current: RenderedVideo[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1].created_at).getTime();
    const curr = new Date(sorted[i].created_at).getTime();
    if (Math.abs(prev - curr) <= 5 * 60 * 1000) {
      current.push(sorted[i]);
    } else {
      batches.push({
        date: current[0].created_at,
        resolution: current[0].resolution,
        renders: current,
      });
      current = [sorted[i]];
    }
  }
  batches.push({
    date: current[0].created_at,
    resolution: current[0].resolution,
    renders: current,
  });

  return batches;
}

function getShortsForParent(
  renders: RenderedVideo[],
  parentId: string
): RenderedVideo[] {
  return renders
    .filter((r) => r.type === 'short' && r.parent_id === parentId)
    .sort((a, b) => (b.virality_score || 0) - (a.virality_score || 0));
}

// ── Fullscreen video modal ──────────────────────────────────────────
const PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const;

const getFsElement = (): Element | null =>
  document.fullscreenElement ??
  (document as Document & { webkitFullscreenElement?: Element })
    .webkitFullscreenElement ??
  null;

const enterFs = (el: HTMLElement) => {
  const req =
    el.requestFullscreen ??
    (el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> })
      .webkitRequestFullscreen;
  return req?.call(el);
};

const exitFs = () => {
  const ex =
    document.exitFullscreen ??
    (document as Document & { webkitExitFullscreen?: () => Promise<void> })
      .webkitExitFullscreen;
  return ex?.call(document);
};

function FullscreenModal({
  render,
  onClose,
}: {
  render: RenderedVideo;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // In fullscreen, Escape exits fullscreen first — don't also close the modal.
      if (e.key === 'Escape' && !getFsElement()) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(getFsElement() !== null);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const setSpeed = (rate: number) => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const toggleFullscreen = () => {
    if (getFsElement()) {
      exitFs();
    } else if (containerRef.current) {
      enterFs(containerRef.current);
    }
  };

  return (
    <div
      ref={containerRef}
      data-fullscreen={isFullscreen}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm data-[fullscreen=true]:bg-black"
      onClick={(e) => {
        if (!isFullscreen && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-full bg-white/10 p-1 backdrop-blur-sm">
          {PLAYBACK_RATES.map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSpeed(rate);
              }}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                playbackRate === rate
                  ? 'bg-white text-black'
                  : 'text-white/80 hover:bg-white/20'
              )}
            >
              {rate}x
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleFullscreen();
          }}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          className="rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/25"
        >
          {isFullscreen ? (
            <Minimize2 className="h-5 w-5" />
          ) : (
            <Maximize2 className="h-5 w-5" />
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close"
          className="rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/25"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      <video
        ref={videoRef}
        src={render.url}
        controls
        autoPlay
        className={cn(
          'rounded-xl',
          isFullscreen
            ? 'h-screen w-screen rounded-none object-contain'
            : 'max-h-[90vh] max-w-[90vw]'
        )}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ── Render card ─────────────────────────────────────────────────────
function RenderCard({
  render,
  onAddToTimeline,
  onFullscreen,
  onDelete,
}: {
  render: RenderedVideo;
  onAddToTimeline: (r: RenderedVideo) => void;
  onFullscreen: (r: RenderedVideo) => void;
  onDelete: (r: RenderedVideo) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Lazy load: only mount <video> when card enters viewport
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
    } else {
      v.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(render.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      ref={cardRef}
      className="group rounded-xl border border-white/[0.08] bg-zinc-900/60 overflow-hidden transition-all duration-200 hover:border-white/20 hover:bg-zinc-900/80 hover:shadow-lg hover:shadow-black/20"
    >
      {/* Video thumbnail / player */}
      <div
        className="relative rounded-t-xl bg-black/40 overflow-hidden"
        style={{ aspectRatio: getAspectRatio(render.resolution) }}
      >
        {isVisible ? (
          <>
            <video
              ref={videoRef}
              src={render.url}
              className="h-full w-full object-contain"
              preload="metadata"
              onEnded={() => setIsPlaying(false)}
              onPause={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
            />

            {/* Bottom gradient for badge readability */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/40 to-transparent" />

            {/* Play / Pause overlay */}
            <button
              type="button"
              onClick={togglePlay}
              className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'
              }`}
            >
              <div className="rounded-full bg-black/60 p-3.5 backdrop-blur-sm transition-transform group-hover:scale-110">
                {isPlaying ? (
                  <IconPlayerPause className="h-6 w-6 text-white fill-current" />
                ) : (
                  <IconPlayerPlay className="h-6 w-6 text-white fill-current" />
                )}
              </div>
            </button>

            {/* Duration badge */}
            {render.duration && (
              <div className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                {formatDuration(render.duration)}
              </div>
            )}

            {/* Fullscreen button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFullscreen(render);
              }}
              className="absolute top-2 right-2 rounded-md bg-black/60 p-1.5 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-white/20 group-hover:opacity-100"
              title="Fullscreen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <Skeleton className="h-full w-full rounded-none" />
        )}

        {/* Resolution + type badges — always visible */}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          {render.type === 'short' && (
            <div className="rounded bg-purple-500/80 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
              Short
            </div>
          )}
          {render.type === 'short' && render.virality_score != null && (
            <div className="flex items-center gap-0.5 rounded bg-orange-500/70 px-1.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
              <Flame className="h-3 w-3" />
              {render.virality_score}
            </div>
          )}
          {render.resolution && render.type !== 'short' && (
            <div className="rounded bg-white/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
              {render.resolution}
            </div>
          )}
        </div>
      </div>

      {/* Info + actions */}
      <div className="px-3 py-2.5 space-y-2">
        {/* Row 1: Metadata */}
        {render.type === 'short' && render.segment_title && (
          <p className="text-xs font-medium text-white truncate">
            {render.segment_title}
          </p>
        )}
        <div className="text-xs text-muted-foreground">
          {render.resolution && <span>{render.resolution}</span>}
          {render.file_size ? (
            <>
              {render.resolution && <span className="mx-1">·</span>}
              <span>{formatFileSize(render.file_size)}</span>
            </>
          ) : null}
        </div>

        {/* Row 2: Action buttons */}
        <div className="flex items-center gap-0.5">
          {/* Add to timeline */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddToTimeline(render);
            }}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/20 hover:text-primary"
            title="Add to timeline"
          >
            <Plus className="h-4 w-4" />
          </button>

          {/* Copy URL */}
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            title="Copy URL"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>

          {/* Publish to Social */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.open(`/post/${render.id}`, '_blank');
            }}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/20 hover:text-primary"
            title="Publish to Social"
          >
            <Send className="h-4 w-4" />
          </button>

          {/* Download */}
          <button
            type="button"
            disabled={isDownloading}
            onClick={async (e) => {
              e.stopPropagation();
              setIsDownloading(true);
              try {
                const res = await fetch(render.url);
                const blob = await res.blob();
                const blobUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = `jorsby_${render.id}.mp4`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                  document.body.removeChild(a);
                  URL.revokeObjectURL(blobUrl);
                }, 100);
              } finally {
                setIsDownloading(false);
              }
            }}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40"
            title="Download"
          >
            {isDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
          </button>

          <div className="flex-1" />

          {/* Delete */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(render);
            }}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-500/20 hover:text-red-400"
            title="Delete render"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shorts group (collapsible) ─────────────────────────────────────
function ShortsGroup({
  shorts,
  onAddToTimeline,
  onFullscreen,
  onDelete,
}: {
  shorts: RenderedVideo[];
  onAddToTimeline: (r: RenderedVideo) => void;
  onFullscreen: (r: RenderedVideo) => void;
  onDelete: (r: RenderedVideo) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mt-2 ml-3 border-l border-purple-500/30 pl-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-purple-400 hover:text-purple-300 transition-colors mb-2"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {shorts.length} short{shorts.length !== 1 ? 's' : ''}
      </button>
      {expanded && (
        <div className="grid gap-2">
          {shorts.map((short) => (
            <RenderCard
              key={short.id}
              render={short}
              onAddToTimeline={onAddToTimeline}
              onFullscreen={onFullscreen}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ──────────────────────────────────────────────────────
export default function PanelRenders() {
  const projectId = useProjectId();
  const { studio } = useStudioStore();
  const { canvasSize } = useProjectStore();
  const [renders, setRenders] = useState<RenderedVideo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fullscreenRender, setFullscreenRender] =
    useState<RenderedVideo | null>(null);
  const { confirm } = useDeleteConfirmation();
  const [cardSize, setCardSize] = useState(50);

  useEffect(() => {
    if (!projectId) return;

    const fetchRenders = async () => {
      try {
        const res = await fetch(`/api/rendered-videos?project_id=${projectId}`);
        if (!res.ok) throw new Error('Failed to fetch renders');
        const { rendered_videos } = await res.json();
        setRenders(rendered_videos || []);
      } catch (error) {
        console.error('Failed to fetch renders:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRenders();
  }, [projectId]);

  // Realtime subscription for live render updates
  useEffect(() => {
    if (!projectId) return;

    const supabase = createClient('studio');

    const channel = supabase
      .channel(`rendered_videos_${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'studio',
          table: 'rendered_videos',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const newRender = payload.new as RenderedVideo;
          setRenders((prev) => {
            if (prev.some((r) => r.id === newRender.id)) return prev;
            return [newRender, ...prev];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'studio',
          table: 'rendered_videos',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const deletedId = payload.old.id;
          setRenders((prev) => prev.filter((r) => r.id !== deletedId));
          setFullscreenRender((current) =>
            current?.id === deletedId ? null : current
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  const handleAddToTimeline = useCallback(
    async (render: RenderedVideo) => {
      if (!studio) return;
      try {
        const videoClip = await Video.fromUrl(render.url);
        videoClip.name = `Render – ${render.resolution || 'video'}`;
        await videoClip.scaleToFit(canvasSize.width, canvasSize.height);
        videoClip.centerInScene(canvasSize.width, canvasSize.height);
        await studio.addClip(videoClip);
      } catch (error) {
        Log.error('Failed to add render to timeline:', error);
      }
    },
    [studio, canvasSize]
  );

  const handleDelete = useCallback(
    async (render: RenderedVideo) => {
      const confirmed = await confirm({
        title: 'Delete Render',
        description:
          'Are you sure you want to delete this rendered video? The file will be permanently removed.',
      });

      if (!confirmed) return;

      try {
        const res = await fetch(`/api/rendered-videos?id=${render.id}`, {
          method: 'DELETE',
        });

        if (!res.ok) throw new Error('Failed to delete render');

        setRenders((prev) => prev.filter((r) => r.id !== render.id));

        if (fullscreenRender?.id === render.id) {
          setFullscreenRender(null);
        }
      } catch (error) {
        console.error('Failed to delete render:', error);
      }
    },
    [confirm, fullscreenRender]
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const batches = groupIntoBatches(renders);

  if (renders.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground px-8">
        <IconDeviceTv size={40} className="opacity-40" />
        <span className="text-sm font-medium">No renders yet</span>
        <span className="text-xs text-center opacity-60 leading-relaxed">
          Use Export &gt; Render to Cloud to create rendered videos
        </span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {fullscreenRender && (
        <FullscreenModal
          render={fullscreenRender}
          onClose={() => setFullscreenRender(null)}
        />
      )}

      {/* Size slider */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.06]">
        <span className="text-[11px] text-muted-foreground shrink-0">Size</span>
        <Slider
          value={[cardSize]}
          onValueChange={([v]) => setCardSize(v)}
          min={0}
          max={100}
          step={1}
          className="flex-1"
        />
      </div>

      <ScrollArea className="flex-1 px-4 py-3">
        <div className="space-y-6">
          {batches.map((batch, batchIndex) => {
            const batchDate = new Date(batch.date);
            const dateLabel = batchDate.toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div key={batch.date}>
                {batchIndex > 0 && (
                  <div className="mb-4 border-t border-white/[0.06]" />
                )}
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {dateLabel}
                  </span>
                  {batch.resolution && (
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground/70">
                      {batch.resolution}
                    </span>
                  )}
                  {batch.renders.length > 1 && projectId && (
                    <button
                      onClick={() =>
                        window.open(`/workflow/${projectId}`, '_blank')
                      }
                      className="ml-auto flex items-center gap-1 text-[10px] text-zinc-500 hover:text-white transition-colors"
                      title="Publish all language videos in this batch"
                    >
                      <Share2 className="h-3 w-3" />
                      Publish all
                    </button>
                  )}
                </div>
                <div
                  className="grid gap-3"
                  style={getGridStyle(batch.resolution, cardSize)}
                >
                  {batch.renders.map((render) => {
                    const shorts = getShortsForParent(renders, render.id);
                    return (
                      <div key={render.id}>
                        <RenderCard
                          render={render}
                          onAddToTimeline={handleAddToTimeline}
                          onFullscreen={setFullscreenRender}
                          onDelete={handleDelete}
                        />
                        {shorts.length > 0 && (
                          <ShortsGroup
                            shorts={shorts}
                            onAddToTimeline={handleAddToTimeline}
                            onFullscreen={setFullscreenRender}
                            onDelete={handleDelete}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
