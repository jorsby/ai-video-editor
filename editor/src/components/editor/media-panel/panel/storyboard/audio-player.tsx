'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconVideo,
  IconX,
} from '@tabler/icons-react';
import { formatDuration } from '../../shared/scene-types';
import { VideoLightbox } from './lightbox';

// ── Mini Audio Player ──────────────────────────────────────────────────────────

export function MiniAudioPlayer({ url }: { url: string }) {
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

export function VideoThumbnail({
  url,
  duration,
  compact,
}: {
  url: string;
  duration?: number | null;
  compact?: boolean;
}) {
  const [showPlayer, setShowPlayer] = useState(false);
  const thumbRef = useRef<HTMLVideoElement | null>(null);
  const [thumbReady, setThumbReady] = useState(false);
  const [isVertical, setIsVertical] = useState(false);

  // Compact mode: open VideoLightbox modal instead of inline player
  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowPlayer(true)}
          className="relative w-16 rounded-md overflow-hidden border border-border/30 bg-black hover:border-primary/40 transition-all group cursor-pointer"
          style={{ aspectRatio: isVertical ? '9/16' : '16/9' }}
          title="Click to play"
        >
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
              if (vid.videoHeight > vid.videoWidth) setIsVertical(true);
              vid.currentTime = 0.1;
            }}
            onSeeked={() => setThumbReady(true)}
          />
          {!thumbReady && (
            <div className="absolute inset-0 bg-gradient-to-br from-muted/40 to-muted/20" />
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/20 transition-colors">
            <div className="size-6 rounded-full bg-white/20 backdrop-blur-sm border border-white/20 flex items-center justify-center group-hover:bg-white/30 group-hover:scale-110 transition-all">
              <IconPlayerPlay className="size-3 text-white ml-0.5" />
            </div>
          </div>
          {duration != null && duration > 0 && (
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1 py-0.5">
              <span className="text-[7px] font-mono text-white/80">
                {formatDuration(duration)}
              </span>
            </div>
          )}
        </button>
        {showPlayer && (
          <VideoLightbox url={url} onClose={() => setShowPlayer(false)} />
        )}
      </>
    );
  }

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
