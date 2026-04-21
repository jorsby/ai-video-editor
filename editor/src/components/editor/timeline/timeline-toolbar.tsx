import { useState, useCallback, useEffect } from 'react';
import { usePlaybackStore } from '@/stores/playback-store';
import { useStudioStore } from '@/stores/studio-store';
import { useTimelineStore } from '@/stores/timeline-store';
import { useMediaPanelStore } from '@/components/editor/media-panel/store';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  ZoomOut,
  ZoomIn,
  Copy,
  Trash2,
  Scissors,
  RotateCcw,
  Lock,
  LockOpen,
  Undo2,
  Redo2,
} from 'lucide-react';
import { DEFAULT_FPS } from '@/stores/project-store';
import { formatTimeCode } from '@/lib/time';
import { EditableTimecode } from '@/components/ui/editable-timecode';

import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconVolume,
  IconVolume3,
  IconLayoutList,
} from '@tabler/icons-react';

export function TimelineToolbar({
  zoomLevel,
  setZoomLevel,
  onDelete,
  onDuplicate,
  onSplit,
  onReset,
  onLockToggle,
  isLocked,
}: {
  zoomLevel: number;
  setZoomLevel: (zoom: number) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onSplit?: () => void;
  onReset?: () => void;
  onLockToggle?: () => void;
  isLocked?: boolean;
}) {
  const { currentTime, duration, isPlaying, toggle, seek } = usePlaybackStore();
  const { studio } = useStudioStore();
  const { selectedClipIds, clips } = useTimelineStore();

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    if (!studio) return;

    setCanUndo(studio.history.canUndo());
    setCanRedo(studio.history.canRedo());

    const handleHistoryChange = ({
      canUndo,
      canRedo,
    }: {
      canUndo: boolean;
      canRedo: boolean;
    }) => {
      setCanUndo(canUndo);
      setCanRedo(canRedo);
    };

    studio.on('history:changed', handleHistoryChange);

    return () => {
      studio.off('history:changed', handleHistoryChange);
    };
  }, [studio]);

  // Resolve sceneId from the currently selected clip (if exactly one scene-linked clip)
  const selectedSceneId =
    selectedClipIds.length === 1
      ? (clips[selectedClipIds[0]]?.metadata?.sceneId as string | undefined)
      : undefined;

  const handleZoomIn = () => {
    setZoomLevel(Math.min(3.5, zoomLevel + 0.15));
  };

  const handleZoomOut = () => {
    setZoomLevel(Math.max(0.15, zoomLevel - 0.15));
  };

  const handleZoomSliderChange = (values: number[]) => {
    setZoomLevel(values[0]);
  };

  return (
    <div className="flex items-center justify-between px-2 py-1 border-b h-10">
      <div className="flex items-center gap-1">
        <TooltipProvider delayDuration={500}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onSplit}>
                <Scissors className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Split element (Ctrl+B)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onDuplicate}>
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Duplicate element (Ctrl+D)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete element (Delete)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onLockToggle}>
                {isLocked ? (
                  <Lock className="h-4 w-4" />
                ) : (
                  <LockOpen className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isLocked ? 'Unlock element (Ctrl+L)' : 'Lock element (Ctrl+L)'}
            </TooltipContent>
          </Tooltip>

          <div className="w-px h-4 bg-border mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onReset}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset timeline</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => studio?.undo()}
                disabled={!canUndo}
              >
                <Undo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => studio?.redo()}
                disabled={!canRedo}
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
          </Tooltip>

          {selectedSceneId && (
            <>
              <div className="w-px h-4 bg-border mx-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      useMediaPanelStore
                        .getState()
                        .requestRevealScene(selectedSceneId)
                    }
                  >
                    <IconLayoutList className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Go to Scene</TooltipContent>
              </Tooltip>
            </>
          )}
        </TooltipProvider>
      </div>

      <div className="flex items-center gap-0">
        <TooltipProvider delayDuration={500}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="size-7"
                variant="ghost"
                size="icon"
                onClick={() => seek(0)}
              >
                <IconPlayerSkipBack className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Return to Start (Home)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={toggle}>
                {isPlaying ? (
                  <IconPlayerPauseFilled className="size-5" />
                ) : (
                  <IconPlayerPlayFilled className="size-5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="size-7"
                variant="ghost"
                size="icon"
                onClick={() => seek(duration)}
              >
                <IconPlayerSkipForward className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Go to End (End)</TooltipContent>
          </Tooltip>
          {/* Time Display */}
          <div className="flex flex-row items-center justify-center px-2">
            <EditableTimecode
              time={currentTime}
              duration={duration}
              format="MM:SS"
              fps={DEFAULT_FPS}
              onTimeChange={seek}
              className="text-center"
            />
            <div className="text-xs text-muted-foreground px-2">/</div>
            <div className="text-xs text-muted-foreground text-center">
              {formatTimeCode(duration, 'MM:SS')}
            </div>
          </div>
        </TooltipProvider>
      </div>

      <div className="flex items-center gap-1">
        <VolumeMixer />
        <SpeedSelector />

        <div className="w-px h-4 bg-border mx-1" />

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={handleZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Slider
            className="w-24"
            value={[zoomLevel]}
            onValueChange={handleZoomSliderChange}
            min={0.15}
            max={3.5}
            step={0.15}
          />
          <Button variant="ghost" size="icon" onClick={handleZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Speed Selector ───────────────────────────────────────────

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.25, 2.5, 2.75, 3] as const;

function SpeedSelector() {
  const { speed, setSpeed } = usePlaybackStore();

  return (
    <Popover>
      <TooltipProvider delayDuration={500}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-xs tabular-nums min-w-[40px]"
              >
                {speed}x
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Playback Speed</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent className="w-36 p-1.5" side="top" align="end">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">
            Speed
          </span>
          {SPEED_OPTIONS.map((s) => (
            <Button
              key={s}
              variant={speed === s ? 'secondary' : 'ghost'}
              size="sm"
              className="justify-start h-7 text-xs"
              onClick={() => setSpeed(s)}
            >
              {s}x
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Volume Mixer ──────────────────────────────────────────────

function VolumeMixer() {
  const { studio } = useStudioStore();
  const [videoVol, setVideoVol] = useState(100);
  const [audioVol, setAudioVol] = useState(100);

  const applyVolume = useCallback(
    (type: 'Video' | 'Audio', percent: number) => {
      if (!studio) return;
      const vol = percent / 100;
      for (const clip of studio.clips) {
        if (clip.type === type) {
          (clip as any).update({ volume: vol });
        }
      }
    },
    [studio]
  );

  const handleVideoVolume = (values: number[]) => {
    setVideoVol(values[0]);
    applyVolume('Video', values[0]);
  };

  const handleAudioVolume = (values: number[]) => {
    setAudioVol(values[0]);
    applyVolume('Audio', values[0]);
  };

  return (
    <Popover>
      <TooltipProvider delayDuration={500}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon">
                <IconVolume className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Volume Mixer</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent className="w-56 p-3" side="top" align="end">
        <div className="flex flex-col gap-3">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Volume Mixer
          </span>

          {/* Video volume */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <IconVolume3 className="size-3.5" /> Video
              </span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {videoVol}%
              </span>
            </div>
            <Slider
              value={[videoVol]}
              onValueChange={handleVideoVolume}
              max={100}
              step={1}
            />
          </div>

          {/* Audio volume */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <IconVolume className="size-3.5" /> Audio
              </span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {audioVol}%
              </span>
            </div>
            <Slider
              value={[audioVol]}
              onValueChange={handleAudioVolume}
              max={100}
              step={1}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
