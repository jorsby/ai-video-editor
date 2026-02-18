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
  X,
} from 'lucide-react';
import {
  IconDeviceTv,
  IconPlayerPlay,
  IconPlayerPause,
} from '@tabler/icons-react';
import type { RenderedVideo } from '@/types/rendered-video';

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

interface RenderBatch {
  date: string;
  resolution: string | null;
  renders: RenderedVideo[];
}

function groupIntoBatches(renders: RenderedVideo[]): RenderBatch[] {
  if (renders.length === 0) return [];

  const sorted = [...renders].sort(
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

// ── Fullscreen video modal ──────────────────────────────────────────
function FullscreenModal({
  render,
  onClose,
}: {
  render: RenderedVideo;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      <video
        src={render.url}
        controls
        autoPlay
        className="max-h-[90vh] max-w-[90vw] rounded-lg"
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
}: {
  render: RenderedVideo;
  onAddToTimeline: (r: RenderedVideo) => void;
  onFullscreen: (r: RenderedVideo) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [copied, setCopied] = useState(false);

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
    <div className="group rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden transition-colors hover:border-white/20 hover:bg-white/[0.06]">
      {/* Video thumbnail / player */}
      <div className="relative aspect-video bg-black/40">
        <video
          ref={videoRef}
          src={render.url}
          className="h-full w-full object-contain"
          preload="metadata"
          onEnded={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
        />

        {/* Play / Pause overlay */}
        <button
          type="button"
          onClick={togglePlay}
          className={`absolute inset-0 flex items-center justify-center transition-opacity ${
            isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'
          }`}
        >
          <div className="rounded-full bg-black/60 p-3 backdrop-blur-sm transition-transform group-hover:scale-110">
            {isPlaying ? (
              <IconPlayerPause className="h-5 w-5 text-white fill-current" />
            ) : (
              <IconPlayerPlay className="h-5 w-5 text-white fill-current" />
            )}
          </div>
        </button>

        {/* Duration badge */}
        {render.duration && (
          <div className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {formatDuration(render.duration)}
          </div>
        )}

        {/* Language badge */}
        <div className="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
          {render.language}
        </div>

        {/* Fullscreen button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onFullscreen(render);
          }}
          className="absolute top-2 right-2 rounded bg-black/60 p-1.5 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-white/20 group-hover:opacity-100"
          title="Fullscreen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Info + actions */}
      <div className="flex items-center gap-1 px-3 py-2">
        <div className="flex-1 min-w-0 text-xs text-muted-foreground">
          {render.resolution && <span>{render.resolution}</span>}
          {render.file_size ? (
            <>
              {render.resolution && <span className="mx-1">·</span>}
              <span>{formatFileSize(render.file_size)}</span>
            </>
          ) : null}
        </div>

        {/* Add to timeline */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddToTimeline(render);
          }}
          className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-primary/20 hover:text-primary"
          title="Add to timeline"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        {/* Copy URL */}
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          title="Copy URL"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Download */}
        <a
          href={render.url}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          title="Download"
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>
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

  const handleAddToTimeline = useCallback(
    async (render: RenderedVideo) => {
      if (!studio) return;
      try {
        const videoClip = await Video.fromUrl(render.url);
        videoClip.name = `Render – ${render.language}`;
        await videoClip.scaleToFit(canvasSize.width, canvasSize.height);
        videoClip.centerInScene(canvasSize.width, canvasSize.height);
        await studio.addClip(videoClip);
      } catch (error) {
        Log.error('Failed to add render to timeline:', error);
      }
    },
    [studio, canvasSize]
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
      <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground px-6">
        <IconDeviceTv size={32} className="opacity-50" />
        <span className="text-sm">No renders yet</span>
        <span className="text-xs text-center opacity-70">
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

      <ScrollArea className="flex-1 px-4 py-3">
        <div className="space-y-5">
          {batches.map((batch) => {
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
                <div className="mb-2.5 flex items-baseline gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {dateLabel}
                  </span>
                  {batch.resolution && (
                    <span className="text-[10px] text-muted-foreground/60">
                      {batch.resolution}
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  {batch.renders.map((render) => (
                    <RenderCard
                      key={render.id}
                      render={render}
                      onAddToTimeline={handleAddToTimeline}
                      onFullscreen={setFullscreenRender}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
