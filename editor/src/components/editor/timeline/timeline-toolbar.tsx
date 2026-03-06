import { useState } from 'react';
import { usePlaybackStore } from '@/stores/playback-store';
import { useLanguageStore } from '@/stores/language-store';
import { useLanguageSwitch } from '@/hooks/use-language-switch';
import { useProjectId } from '@/contexts/project-context';
import { useDeleteConfirmation } from '@/contexts/delete-confirmation-context';
import { createClient } from '@/lib/supabase/client';
import {
  SUPPORTED_LANGUAGES,
  type LanguageCode,
} from '@/lib/constants/languages';
import { toast } from 'sonner';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  const { switchLanguage, copyToMultiple, addEmptyLanguages, removeLanguage } =
    useLanguageSwitch();
  const projectId = useProjectId();
  const { confirm: confirmDelete } = useDeleteConfirmation();
  const [contextMenuLang, setContextMenuLang] = useState<LanguageCode | null>(
    null
  );
  const [pendingLang, setPendingLang] = useState<LanguageCode | null>(null);
  const [selectedLangs, setSelectedLangs] = useState<Set<string>>(new Set());
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateProgress, setTranslateProgress] = useState('');

  const unaddedLanguages = SUPPORTED_LANGUAGES.filter(
    (l) => !availableLanguages.includes(l.code)
  );
  const allSelected =
    selectedLangs.size === unaddedLanguages.length &&
    unaddedLanguages.length > 0;
  const someSelected = selectedLangs.size > 0;

  const closeDialog = () => {
    setPendingLang(null);
    setSelectedLangs(new Set());
    setTranslateProgress('');
  };

  const handleTranslate = async () => {
    if (selectedLangs.size === 0) return;
    const langs = Array.from(selectedLangs);

    setIsTranslating(true);
    setTranslateProgress(`Translating ${langs.length} language(s)...`);

    try {
      const supabase = createClient('studio');
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

      const res = await fetch('/api/translate-languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyboard_id: sb.id, target_languages: langs }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || 'Translation failed');
      }

      const result = await res.json();
      const {
        translated,
        failed,
      }: { translated: string[]; failed: { code: string; reason: string }[] } =
        result;

      if (translated.length > 0) {
        setTranslateProgress(
          `Copying timelines for ${translated.length} language(s)...`
        );
        await copyToMultiple(translated);
        await switchLanguage(translated[0]);
      }

      if (failed.length === 0) {
        toast.success(
          `${translated.length} language(s) translated successfully`
        );
      } else if (translated.length > 0) {
        toast.warning(
          `${translated.length} translated, ${failed.length} failed: ${failed.map((f: { code: string }) => f.code.toUpperCase()).join(', ')}`
        );
      } else {
        toast.error('All translations failed');
      }
    } catch (err) {
      console.error('Batch translate error:', err);
      toast.error(err instanceof Error ? err.message : 'Translation failed');
    } finally {
      setIsTranslating(false);
      closeDialog();
    }
  };

  const handleCopyTimeline = async () => {
    if (selectedLangs.size === 0) return;
    const langs = Array.from(selectedLangs);

    setIsTranslating(true);
    setTranslateProgress(`Copying timeline to ${langs.length} language(s)...`);

    try {
      await copyToMultiple(langs);
      await switchLanguage(langs[0]);
      toast.success(`Timeline copied to ${langs.length} language(s)`);
    } catch {
      toast.error('Failed to copy timeline');
    } finally {
      setIsTranslating(false);
      closeDialog();
    }
  };

  const handleStartEmpty = async () => {
    if (selectedLangs.size === 0) return;
    const langs = Array.from(selectedLangs);

    try {
      await addEmptyLanguages(langs);
      await switchLanguage(langs[0]);
      toast.success(`${langs.length} empty language(s) added`);
    } catch {
      toast.error('Failed to add languages');
    } finally {
      closeDialog();
    }
  };

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

  const handleRemoveLanguage = async (lang: LanguageCode) => {
    const confirmed = await confirmDelete({
      title: `Remove ${lang.toUpperCase()} language`,
      description: `All tracks, clips, voiceovers, and rendered videos for ${lang.toUpperCase()} will be permanently deleted. This action cannot be undone.`,
      confirmLabel: 'Remove',
    });
    if (confirmed) {
      await removeLanguage(lang);
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
              {availableLanguages.map((code) => {
                const isActive = code === activeLanguage;
                return (
                  <DropdownMenu
                    key={code}
                    open={contextMenuLang === code}
                    onOpenChange={(open) => {
                      if (!open) setContextMenuLang(null);
                    }}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            disabled={isLanguageSwitching}
                            onClick={() => handleLanguageClick(code)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              if (!isLanguageSwitching)
                                setContextMenuLang(code);
                            }}
                            className={`px-2 py-1 text-xs font-medium rounded transition-colors disabled:opacity-50 ${
                              isActive
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-secondary/50 text-muted-foreground'
                            }`}
                          >
                            {code.toUpperCase()}
                          </button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isActive
                          ? `Editing: ${code.toUpperCase()}`
                          : `Switch to ${code.toUpperCase()} (right-click to remove)`}
                      </TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent
                      align="start"
                      className="min-w-[160px]"
                    >
                      <DropdownMenuItem
                        disabled={availableLanguages.length <= 1}
                        className="text-destructive focus:text-destructive"
                        onClick={() => {
                          setContextMenuLang(null);
                          handleRemoveLanguage(code);
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove {code.toUpperCase()}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })}
              {/* Add language button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLangs(new Set());
                      setPendingLang('__new__' as LanguageCode);
                    }}
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
        onOpenChange={(v) => {
          if (!v && isTranslating) return;
          if (!v) closeDialog();
        }}
      >
        <DialogContent
          className="max-w-sm"
          onInteractOutside={(e) => {
            if (isTranslating) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (isTranslating) e.preventDefault();
          }}
          showCloseButton={!isTranslating}
        >
          <DialogTitle>Add Languages</DialogTitle>
          <DialogDescription>
            Select one or more languages to add to the timeline.
          </DialogDescription>

          {isTranslating ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {translateProgress}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 mt-2">
              {unaddedLanguages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  All supported languages have been added.
                </p>
              ) : (
                <>
                  {/* Select All */}
                  <label className="flex items-center gap-2 pb-1 border-b cursor-pointer">
                    <Checkbox
                      checked={
                        allSelected
                          ? true
                          : someSelected
                            ? 'indeterminate'
                            : false
                      }
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedLangs(
                            new Set(unaddedLanguages.map((l) => l.code))
                          );
                        } else {
                          setSelectedLangs(new Set());
                        }
                      }}
                    />
                    <span className="text-xs font-medium">
                      Select all ({unaddedLanguages.length})
                    </span>
                  </label>

                  {/* Language checkbox list */}
                  <ScrollArea className="max-h-52">
                    <div className="flex flex-col gap-1">
                      {unaddedLanguages.map((l) => (
                        <label
                          key={l.code}
                          className="flex items-center gap-2 px-1 py-1 rounded hover:bg-secondary/50 cursor-pointer"
                        >
                          <Checkbox
                            checked={selectedLangs.has(l.code)}
                            onCheckedChange={(checked) => {
                              setSelectedLangs((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(l.code);
                                else next.delete(l.code);
                                return next;
                              });
                            }}
                          />
                          <span className="text-xs">
                            {l.label} — {l.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>

                  {/* Action buttons */}
                  <div className="flex flex-col gap-2">
                    <Button disabled={!someSelected} onClick={handleTranslate}>
                      Translate{someSelected ? ` (${selectedLangs.size})` : ''}{' '}
                      from {activeLanguage.toUpperCase()}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!someSelected}
                      onClick={handleCopyTimeline}
                    >
                      Copy timeline
                      {someSelected ? ` (${selectedLangs.size})` : ''}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!someSelected}
                      onClick={handleStartEmpty}
                    >
                      Start empty
                      {someSelected ? ` (${selectedLangs.size})` : ''}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
