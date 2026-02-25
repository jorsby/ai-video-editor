import { useState } from 'react';
import { usePlaybackStore } from '@/stores/playback-store';
import { useLanguageStore } from '@/stores/language-store';
import { useLanguageSwitch } from '@/hooks/use-language-switch';
import { useProjectId } from '@/contexts/project-context';
import { createClient } from '@/lib/supabase/client';
import { SUPPORTED_LANGUAGES, type LanguageCode } from '@/lib/constants/languages';
import { toast } from 'sonner';
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
  const projectId = useProjectId();
  const [pendingLang, setPendingLang] = useState<LanguageCode | null>(null);
  const [addLangCode, setAddLangCode] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);

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
    switchLanguage(lang);
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
              {availableLanguages.map((code) => {
                const isActive = code === activeLanguage;
                return (
                  <Tooltip key={code}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        disabled={isLanguageSwitching}
                        onClick={() => handleLanguageClick(code)}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors disabled:opacity-50 ${
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-secondary/50 text-muted-foreground'
                        }`}
                      >
                        {code.toUpperCase()}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isActive ? `Editing: ${code.toUpperCase()}` : `Switch to ${code.toUpperCase()}`}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
              {/* Add language button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => { setAddLangCode(''); setPendingLang('__new__' as LanguageCode); }}
                    className="px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/50 rounded transition-colors"
                  >
                    +
                  </button>
                </TooltipTrigger>
                <TooltipContent>Add language</TooltipContent>
              </Tooltip>
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

      {/* Add language dialog */}
      <Dialog
        open={pendingLang !== null}
        onOpenChange={(v) => !v && setPendingLang(null)}
      >
        <DialogContent className="max-w-xs">
          <DialogTitle>Add Language</DialogTitle>
          <DialogDescription>
            Choose a language to add to the timeline.
          </DialogDescription>
          <div className="flex flex-col gap-3 mt-2">
            <select
              className="w-full h-8 text-xs border border-border rounded-md px-2 bg-background"
              value={addLangCode}
              onChange={(e) => setAddLangCode(e.target.value)}
            >
              <option value="">Select language...</option>
              {SUPPORTED_LANGUAGES.filter((l) => !availableLanguages.includes(l.code)).map((l) => (
                <option key={l.code} value={l.code}>{l.label} — {l.name}</option>
              ))}
            </select>
            <div className="flex flex-col gap-2">
              <Button
                disabled={!addLangCode || isTranslating}
                onClick={async () => {
                  if (!addLangCode) return;
                  setIsTranslating(true);
                  try {
                    const supabase = createClient();
                    const { data: sb } = await supabase
                      .from('storyboards')
                      .select('id')
                      .eq('project_id', projectId)
                      .order('created_at', { ascending: false })
                      .limit(1)
                      .single();
                    if (!sb) {
                      toast.error('No storyboard found');
                      return;
                    }
                    const res = await fetch('/api/translate-language', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ storyboard_id: sb.id, target_language: addLangCode }),
                    });
                    if (!res.ok) throw new Error('Translation failed');
                    await copyAndSwitch(addLangCode);
                    toast.success(`${addLangCode.toUpperCase()} voiceovers translated`);
                  } catch {
                    toast.error('Translation failed');
                  } finally {
                    setIsTranslating(false);
                    setPendingLang(null);
                  }
                }}
              >
                {isTranslating ? 'Translating...' : `Translate from ${activeLanguage.toUpperCase()}`}
              </Button>
              <Button
                variant="outline"
                disabled={!addLangCode}
                onClick={async () => {
                  if (addLangCode) await copyAndSwitch(addLangCode);
                  setPendingLang(null);
                }}
              >
                Copy timeline from {activeLanguage.toUpperCase()}
              </Button>
              <Button
                variant="outline"
                disabled={!addLangCode}
                onClick={async () => {
                  if (addLangCode) await switchLanguage(addLangCode);
                  setPendingLang(null);
                }}
              >
                Start empty
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
