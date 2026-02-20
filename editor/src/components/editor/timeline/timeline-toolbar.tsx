import { useState } from 'react';
import { usePlaybackStore } from '@/stores/playback-store';
import { useLanguageStore } from '@/stores/language-store';
import { useLanguageSwitch } from '@/hooks/use-language-switch';
import { SUPPORTED_LANGUAGES, type LanguageCode } from '@/lib/constants/languages';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import {
  Magnet,
  ZoomOut,
  ZoomIn,
  Copy,
  Trash2,
  Scissors,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { DEFAULT_FPS } from '@/stores/project-store';
import { formatTimeCode } from '@/lib/time';
import { EditableTimecode } from '@/components/ui/editable-timecode';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
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
  const { activeLanguage, availableLanguages, isLanguageSwitching } =
    useLanguageStore();
  const { switchLanguage, copyAndSwitch } = useLanguageSwitch();
  const [pendingLang, setPendingLang] = useState<LanguageCode | null>(null);

  const handleZoomIn = () => {
    setZoomLevel(Math.min(3.5, zoomLevel + 0.15));
  };

  const handleZoomOut = () => {
    setZoomLevel(Math.max(0.15, zoomLevel - 0.15));
  };

  const handleZoomSliderChange = (values: number[]) => {
    setZoomLevel(values[0]);
  };

  const handleLanguageClick = (lang: LanguageCode) => {
    if (lang === activeLanguage || isLanguageSwitching) return;

    if (availableLanguages.includes(lang)) {
      // Language has existing data — switch directly
      switchLanguage(lang);
    } else {
      // No data for this language — prompt the user
      setPendingLang(lang);
    }
  };

  return (
    <>
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

            <div className="w-px h-4 bg-border mx-1" />

            {/* Language Switcher */}
            <div className="flex items-center gap-0.5">
              {isLanguageSwitching && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground mr-1" />
              )}
              {SUPPORTED_LANGUAGES.map((lang) => {
                const isActive = lang.code === activeLanguage;
                const hasData = availableLanguages.includes(lang.code);
                return (
                  <Tooltip key={lang.code}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        disabled={isLanguageSwitching}
                        onClick={() => handleLanguageClick(lang.code)}
                        className={`relative px-2 py-1 text-xs font-medium rounded transition-colors disabled:opacity-50 ${
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-secondary/50 text-muted-foreground'
                        }`}
                      >
                        {lang.label}
                        {hasData && !isActive && (
                          <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isActive
                        ? `Editing: ${lang.label}`
                        : hasData
                          ? `Switch to ${lang.label}`
                          : `${lang.label} (no data)`}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
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

      {/* "Copy from / Start empty" prompt dialog */}
      <Dialog
        open={pendingLang !== null}
        onOpenChange={(v) => !v && setPendingLang(null)}
      >
        <DialogContent className="max-w-xs">
          <DialogTitle>New language: {pendingLang?.toUpperCase()}</DialogTitle>
          <DialogDescription>
            No timeline data exists for this language yet.
          </DialogDescription>
          <div className="flex flex-col gap-2 mt-2">
            <Button
              onClick={() => {
                if (pendingLang) copyAndSwitch(pendingLang);
                setPendingLang(null);
              }}
            >
              Copy from {activeLanguage.toUpperCase()}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (pendingLang) switchLanguage(pendingLang);
                setPendingLang(null);
              }}
            >
              Start empty
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
