'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';
import {
  type SceneData,
  type VariantImageMap,
  statusColor,
  deriveSceneStatus,
  formatDuration,
  callGenerateApi,
} from '../../shared/scene-types';
import { CopyIdBadge } from '../../shared/copy-id-badge';
import {
  IconChevronDown,
  IconChevronUp,
  IconFilter,
  IconPhoto,
  IconVolume,
  IconVideo,
  IconEye,
  IconSparkles,
  IconRefresh,
  IconSend,
  IconLoader2,
} from '@tabler/icons-react';
import { useChapterFocusStore } from '@/stores/chapter-focus-store';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import {
  statusDotColor,
  deriveChapterStatus,
  type ChapterData,
} from './helpers';
import { SceneCard } from './scene-card';
import { SceneListRow } from './layout-variants';
import { AssetGallery } from './gallery';
import { SendToTimelineModal } from './send-to-timeline-modal';

// ── Chapter Accordion ──────────────────────────────────────────────────────────

export function ChapterAccordion({
  chapter,
  imageMap,
  chapterSelectionStatus,
  onToggleChapter,
  selectedSceneIds,
  onToggleScene,
  forceOpen,
  onSceneDeleted,
  focusedSceneId,
  viewMode,
  onReorderScenes,
}: {
  chapter: ChapterData;
  imageMap: VariantImageMap;
  chapterSelectionStatus: 'none' | 'some' | 'all';
  onToggleChapter: () => void;
  selectedSceneIds: Set<string>;
  onToggleScene: (sceneId: string) => void;
  forceOpen?: boolean | null;
  onSceneDeleted: (sceneId: string) => void;
  focusedSceneId?: string | null;
  viewMode: 'card' | 'list';
  onReorderScenes: (chapterId: string, reorderedScenes: SceneData[]) => void;
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

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIdx = chapter.scenes.findIndex((s) => s.id === active.id);
      const newIdx = chapter.scenes.findIndex((s) => s.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return;
      const reordered = arrayMove(chapter.scenes, oldIdx, newIdx);
      onReorderScenes(chapter.id, reordered);
      // Persist order to API
      for (const [i, s] of reordered.entries()) {
        await fetch(`/api/v2/scenes/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: i + 1 }),
        }).catch(() => {});
      }
    },
    [chapter.scenes, chapter.id, onReorderScenes]
  );

  const [showAssets, setShowAssets] = useState(false);
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
  const selectedSceneList = chapter.scenes.filter((scene) =>
    selectedSceneIds.has(scene.id)
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
  // Scenes that were never submitted to the video generator: idle state,
  // no URL, prompt is ready. Narrative scenes without audio are held back
  // so TTS runs first — mirrors the runBatchVideo filter above.
  const untriedVideoScenes = chapter.scenes.filter((scene) => {
    if (
      !scene.prompt ||
      scene.video_url ||
      scene.video_status === 'generating' ||
      scene.video_status === 'failed' ||
      scene.video_status === 'done'
    )
      return false;
    if (scene.audio_text && !scene.audio_url) return false;
    return true;
  });
  const untriedVideoCount = untriedVideoScenes.length;
  const failedTtsScenes = chapter.scenes.filter(
    (scene) =>
      scene.tts_status === 'failed' && !scene.audio_url && !!scene.audio_text
  );
  const failedTtsCount = failedTtsScenes.length;
  const [retryBatchProgress, setRetryBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [generateMissingProgress, setGenerateMissingProgress] = useState<{
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
    generateMissingProgress !== null ||
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

  const runBatchTts = async () => {
    const targets = chapter.scenes.filter(
      (scene) =>
        selectedSceneIds.has(scene.id) &&
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
        !selectedSceneIds.has(scene.id) ||
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

  const runGenerateMissingVideos = async () => {
    if (untriedVideoScenes.length < 1) return;

    setGenerateMissingProgress({ done: 0, total: untriedVideoScenes.length });
    let failures = 0;
    const missingSlugs = new Set<string>();
    let firstError: string | undefined;
    try {
      for (const [index, scene] of untriedVideoScenes.entries()) {
        const result = await callGenerateApi(
          `/api/v2/scenes/${scene.id}/generate-video`
        );
        if (!result.ok) {
          failures++;
          if (!firstError && result.error) firstError = result.error;
          for (const s of result.missing_slugs ?? []) missingSlugs.add(s);
        }
        setGenerateMissingProgress({
          done: index + 1,
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
      setGenerateMissingProgress(null);
    }
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center gap-1">
          <input
            ref={(el) => {
              if (el) el.indeterminate = chapterSelectionStatus === 'some';
            }}
            type="checkbox"
            checked={chapterSelectionStatus === 'all'}
            onChange={onToggleChapter}
            className="ml-1 size-3 rounded border-border accent-primary shrink-0 cursor-pointer"
            title={`Select CH${chapter.order}`}
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
                {chapter.title?.replace(/^(EP|CH)\d+\s*[-\u2014]\s*/, '') ||
                  `Chapter ${chapter.order}`}
              </span>

              {/* Scene progress */}
              <span className="text-[10px] text-muted-foreground shrink-0">
                {doneCount}/{sceneCount}
              </span>

              {/* Status dots */}
              <div className="flex items-center gap-px shrink-0">
                {chapter.scenes.slice(0, 10).map((s) => (
                  <div
                    key={s.id}
                    className={`size-1.5 rounded-full ${statusDotColor(deriveSceneStatus(s))}`}
                  />
                ))}
                {chapter.scenes.length > 10 && (
                  <span className="text-[7px] text-muted-foreground ml-0.5">
                    +{chapter.scenes.length - 10}
                  </span>
                )}
              </div>

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
              {untriedVideoCount > 0 && (
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => {
                      void runGenerateMissingVideos();
                    }}
                    disabled={isBatchRunning}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Scenes that were never submitted to the video generator"
                  >
                    <IconSparkles className="size-2.5" />
                    Generate Missing Video ({untriedVideoCount})
                  </button>
                  {generateMissingProgress && (
                    <span className="text-[9px] text-yellow-400 mt-0.5">
                      Generating {generateMissingProgress.done}/
                      {generateMissingProgress.total}...
                    </span>
                  )}
                </div>
              )}
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
                      const retryFailures: string[] = [];
                      try {
                        for (const [i, scene] of failedTtsScenes.entries()) {
                          const result = await callGenerateApi(
                            `/api/v2/scenes/${scene.id}/generate-tts`
                          );
                          if (!result.ok)
                            retryFailures.push(result.error ?? 'unknown error');
                          setRetryTtsBatchProgress({
                            done: i + 1,
                            total: failedTtsScenes.length,
                          });
                        }
                      } finally {
                        setRetryTtsBatchProgress(null);
                      }
                      if (retryFailures.length > 0) {
                        toast.error(
                          `Retry TTS failed for ${retryFailures.length}/${failedTtsScenes.length} scenes: ${retryFailures[0]}`
                        );
                      } else {
                        toast.success(
                          `Retry TTS started for ${failedTtsScenes.length} scenes`
                        );
                      }
                    }}
                    disabled={isBatchRunning}
                    className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <IconRefresh className="size-2.5" />
                    Retry Failed TTS ({failedTtsCount})
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
                  selectedSceneIds.size === 0 ||
                  !chapter.scenes.some(
                    (s) =>
                      selectedSceneIds.has(s.id) && (s.video_url || s.audio_url)
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
              <DndContext
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={chapter.scenes.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {viewMode === 'list' ? (
                    <div className="space-y-0.5">
                      {chapter.scenes.map((scene, i) => (
                        <SceneListRow
                          key={scene.id}
                          scene={scene}
                          index={i}
                          imageMap={imageMap}
                          isSelected={selectedSceneIds.has(scene.id)}
                          onToggleSelected={() => onToggleScene(scene.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {chapter.scenes.map((scene, i) => (
                        <SceneCard
                          key={scene.id}
                          scene={scene}
                          index={i}
                          imageMap={imageMap}
                          isSelected={selectedSceneIds.has(scene.id)}
                          onToggleSelected={() => onToggleScene(scene.id)}
                          onDelete={() => onSceneDeleted(scene.id)}
                          isFocused={focusedSceneId === scene.id}
                        />
                      ))}
                    </div>
                  )}
                </SortableContext>
              </DndContext>
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
          (s) => selectedSceneIds.has(s.id) && (s.video_url || s.audio_url)
        )}
        open={timelineModalOpen}
        onOpenChange={setTimelineModalOpen}
      />
    </>
  );
}
