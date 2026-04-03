import { useState, useCallback } from 'react';
import { usePlaybackStore } from '@/stores/playback-store';
import { useStudioStore } from '@/stores/studio-store';
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
  Magnet,
  ZoomOut,
  ZoomIn,
  Copy,
  Trash2,
  Scissors,
  RotateCcw,
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
} from '@tabler/icons-react';

export function TimelineToolbar({
  zoomLevel,
  setZoomLevel,
  onDelete,
  onDuplicate,
  onSplit,
  onReset,
}: {
  zoomLevel: number;
  setZoomLevel: (zoom: number) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onSplit?: () => void;
  onReset?: () => void;
}) {
  const { currentTime, duration, isPlaying, toggle, seek } = usePlaybackStore();

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
            <TooltipContent>Split element (Ctrl+S)</TooltipContent>
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
              <Button variant="ghost" size="icon">
                <Magnet className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Auto snapping</TooltipContent>
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
            <TooltipContent>Return to Start (Home / Enter)</TooltipContent>
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
                onClick={() => seek(0)}
              >
                <IconPlayerSkipForward className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Return to Start (Home / Enter)</TooltipContent>
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
