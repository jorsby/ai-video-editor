'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useStudioStore } from '@/stores/studio-store';
import { useProjectStore } from '@/stores/project-store';
import { useSceneFocusStore } from '@/stores/scene-focus-store';
import { useTimelineStore } from '@/stores/timeline-store';
import { syncSceneToTimeline } from '@/lib/timeline/sync-scene-to-timeline';
import { useDeleteConfirmation } from '@/contexts/delete-confirmation-context';
import {
  type SceneData,
  type VariantImageMap,
  statusColor,
  slugToLabel,
  deriveSceneStatus,
  formatDuration,
  callGenerateApi,
} from '../../shared/scene-types';
import { CopyButton } from '../../shared/copy-button';
import { CopyIdBadge } from '../../shared/copy-id-badge';
import { ExpandableText } from '../../shared/expandable-text';
import {
  IconChevronDown,
  IconChevronUp,
  IconPhoto,
  IconVolume,
  IconVideo,
  IconMapPin,
  IconUser,
  IconBox,
  IconLoader2,
  IconRefresh,
  IconPencil,
  IconDeviceFloppy,
  IconTrash,
  IconArrowsExchange2,
  IconGripVertical,
} from '@tabler/icons-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getSceneThumbnailUrl } from './helpers';
import { VariantAvatar } from './lightbox';
import { MiniAudioPlayer, VideoThumbnail } from './audio-player';
import { HighlightedPrompt } from './highlighted-prompt';
import { GenerateButton, GenMetadataTooltip } from './generation-controls';
import { SceneVariantTile } from './scene-variant-tile';

// ── Scene Card ─────────────────────────────────────────────────────────────────

export function SceneCard({
  scene,
  index,
  imageMap,
  isSelected,
  onToggleSelected,
  onDelete,
  isFocused,
}: {
  scene: SceneData;
  index: number;
  imageMap: VariantImageMap;
  isSelected: boolean;
  onToggleSelected: () => void;
  onDelete: () => void;
  isFocused?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const {
    attributes: sortableAttributes,
    listeners: sortableListeners,
    setNodeRef: setSortableRef,
    transform,
    transition: sortableTransition,
    isDragging,
  } = useSortable({ id: scene.id });
  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition: sortableTransition,
    opacity: isDragging ? 0.5 : 1,
  };
  const [localTtsStatus, setLocalTtsStatus] = useState<string | null>(null);
  const [localVideoStatus, setLocalVideoStatus] = useState<string | null>(null);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editPromptText, setEditPromptText] = useState('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleText, setEditTitleText] = useState('');
  const [isEditingAudioText, setIsEditingAudioText] = useState(false);
  const [editAudioText, setEditAudioText] = useState('');
  const [isSavingAudioText, setIsSavingAudioText] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const { confirm } = useDeleteConfirmation();
  const studio = useStudioStore((s) => s.studio);
  const canvasSize = useProjectStore((s) => s.canvasSize);

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

  // Auto-expand and scroll into view when focused from timeline
  useEffect(() => {
    if (!isFocused) return;
    setIsExpanded(true);
    // Small delay so the DOM has time to expand before scrolling
    const timer = setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      useSceneFocusStore.getState().clearSceneFocus();
    }, 150);
    return () => clearTimeout(timer);
  }, [isFocused]);

  // Check if this scene has clips in the timeline
  const isInTimeline = useTimelineStore((state) =>
    Object.values(state.clips).some(
      (clip) => (clip.metadata?.sceneId as string) === scene.id
    )
  );

  const effectiveTtsStatus = localTtsStatus ?? scene.tts_status;
  const effectiveVideoStatus = localVideoStatus ?? scene.video_status;

  const hasAudio = !!scene.audio_url;
  const hasVideo = !!scene.video_url;
  const scenePromptText =
    scene.structured_prompt
      ?.map((s) =>
        Object.values(s)
          .filter((v) => typeof v === 'string' && v)
          .join(', ')
      )
      .join(' | ') ?? '';
  const hasPrompt = !!scenePromptText;
  const isNarrative = !!scene.audio_text;
  const needsTtsFirst = isNarrative && !hasAudio;
  const _charCount = scene.character_variant_slugs?.length ?? 0;
  const hasLocation = !!scene.location_variant_slug;
  const _propCount = scene.prop_variant_slugs?.length ?? 0;

  // Collect all slugs for this scene, main variants first
  const allSlugs: string[] = [];
  if (scene.location_variant_slug) allSlugs.push(scene.location_variant_slug);
  if (scene.character_variant_slugs)
    allSlugs.push(...scene.character_variant_slugs);
  if (scene.prop_variant_slugs) allSlugs.push(...scene.prop_variant_slugs);
  allSlugs.sort((a, b) => {
    const aMain = imageMap.get(a)?.is_main ? 0 : 1;
    const bMain = imageMap.get(b)?.is_main ? 0 : 1;
    return aMain - bMain;
  });

  return (
    <div
      ref={(el) => {
        (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        setSortableRef(el);
      }}
      style={sortableStyle}
      className={`group rounded-md overflow-hidden transition-colors ${isDragging ? 'z-50 shadow-lg' : ''} ${isFocused ? 'ring-2 ring-primary animate-pulse' : ''} ${isSelected ? 'border-2 border-primary/60 bg-primary/5' : 'border border-border/40 bg-card/50'}`}
    >
      {/* Scene header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border/30">
        <div
          className="cursor-grab active:cursor-grabbing p-0.5 text-muted-foreground/40 hover:text-muted-foreground shrink-0 touch-none"
          {...sortableAttributes}
          {...sortableListeners}
        >
          <IconGripVertical className="size-3" />
        </div>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelected}
          onClick={(event) => event.stopPropagation()}
          className="size-3.5 shrink-0 rounded border-border/60 bg-background accent-primary"
          aria-label={`Select scene ${index + 1}`}
        />

        {/* Scene thumbnail with status overlay */}
        {(() => {
          const thumbUrl = getSceneThumbnailUrl(scene, imageMap);
          const thumbStatus = deriveSceneStatus({
            ...scene,
            tts_status: effectiveTtsStatus,
            video_status: effectiveVideoStatus,
          });
          return (
            <div className="size-9 rounded shrink-0 overflow-hidden bg-muted/30 border border-border/20 flex items-center justify-center relative">
              {thumbUrl ? (
                scene.video_url && thumbUrl === scene.video_url ? (
                  <video
                    src={thumbUrl}
                    className="w-full h-full object-cover"
                    preload="metadata"
                    muted
                  />
                ) : (
                  <img
                    src={thumbUrl}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    alt=""
                  />
                )
              ) : (
                <IconPhoto className="size-3.5 text-muted-foreground/30" />
              )}
              {thumbStatus === 'generating' ? (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <IconLoader2 className="size-3 text-yellow-400 animate-spin" />
                </div>
              ) : thumbStatus === 'done' ? (
                <div className="absolute bottom-0 right-0 size-2.5 rounded-full bg-green-500 border border-card" />
              ) : thumbStatus === 'failed' ? (
                <div className="absolute bottom-0 right-0 size-2.5 rounded-full bg-red-500 border border-card" />
              ) : null}
            </div>
          );
        })()}

        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsExpanded(!isExpanded)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsExpanded(!isExpanded);
            }
          }}
          className="flex-1 flex items-center gap-2 min-w-0 hover:bg-muted/40 transition-colors text-left rounded-sm px-1 py-0.5 cursor-pointer"
        >
          {isExpanded ? (
            <IconChevronUp className="size-3 text-muted-foreground shrink-0" />
          ) : (
            <IconChevronDown className="size-3 text-muted-foreground shrink-0" />
          )}
          <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0">
            S{index + 1}
          </span>
          <CopyIdBadge id={scene.id} />
          {isEditingTitle ? (
            <input
              type="text"
              value={editTitleText}
              onChange={(e) => setEditTitleText(e.target.value)}
              onBlur={() => {
                const trimmed = editTitleText.trim();
                if (trimmed !== (scene.title ?? '')) {
                  fetch(`/api/v2/scenes/${scene.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: trimmed || null }),
                  })
                    .then((res) => {
                      if (res.ok) toast.success('Title updated');
                      else toast.error('Failed to update title');
                    })
                    .catch(() => toast.error('Failed to update title'));
                }
                setIsEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setIsEditingTitle(false);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="text-xs font-medium bg-muted/30 rounded px-1 py-0.5 border border-primary/30 outline-none flex-1 min-w-0"
            />
          ) : (
            <span className="text-xs font-medium truncate flex-1">
              {scene.title || `Scene ${index + 1}`}
            </span>
          )}
          {!isEditingTitle && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditTitleText(scene.title || '');
                setIsEditingTitle(true);
              }}
              className="p-0.5 rounded hover:bg-muted/50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              title="Edit title"
            >
              <IconPencil className="size-2.5 text-muted-foreground" />
            </button>
          )}

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
        </div>
      </div>

      {/* Scene summary (always visible) */}
      <div className="px-3 py-2 space-y-2">
        {/* Media row — side-by-side: video thumbnail left, narration + audio right */}
        {hasAudio || hasVideo || scene.audio_text ? (
          <div className="flex gap-2 items-start">
            {hasVideo && (
              <div className="shrink-0">
                <VideoThumbnail
                  url={scene.video_url!}
                  duration={scene.video_duration}
                  compact
                />
              </div>
            )}
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              {(scene.audio_text || isEditingAudioText) &&
                (isEditingAudioText ? (
                  <div
                    onBlur={(e) => {
                      // Close edit mode when focus leaves this container entirely
                      if (
                        !e.currentTarget.contains(e.relatedTarget as Node) &&
                        !isSavingAudioText
                      ) {
                        setIsEditingAudioText(false);
                      }
                    }}
                  >
                    <textarea
                      value={editAudioText}
                      onChange={(e) => setEditAudioText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setIsEditingAudioText(false);
                      }}
                      className="w-full text-[11px] leading-relaxed text-foreground/80 italic bg-muted/20 rounded-md p-2 border border-primary/30 focus:border-primary/50 outline-none resize-y min-h-[50px]"
                      rows={3}
                    />
                    <div className="flex items-center gap-1 mt-1">
                      <button
                        type="button"
                        onClick={() => setIsEditingAudioText(false)}
                        className="text-[9px] px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={
                          isSavingAudioText ||
                          editAudioText.trim() === (scene.audio_text ?? '')
                        }
                        onClick={async () => {
                          setIsSavingAudioText(true);
                          try {
                            const res = await fetch(
                              `/api/v2/scenes/${scene.id}`,
                              {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  audio_text: editAudioText.trim() || null,
                                }),
                              }
                            );
                            if (!res.ok) throw new Error('Failed');
                            setIsEditingAudioText(false);
                            toast.success('Voiceover text updated');
                          } catch {
                            toast.error('Failed to save voiceover text');
                          } finally {
                            setIsSavingAudioText(false);
                          }
                        }}
                        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isSavingAudioText ? (
                          <IconLoader2 className="size-2.5 animate-spin" />
                        ) : (
                          <IconDeviceFloppy className="size-2.5" />
                        )}
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={
                          isSavingAudioText ||
                          editAudioText.trim() === (scene.audio_text ?? '')
                        }
                        onClick={async () => {
                          setIsSavingAudioText(true);
                          try {
                            const res = await fetch(
                              `/api/v2/scenes/${scene.id}`,
                              {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  audio_text: editAudioText.trim() || null,
                                }),
                              }
                            );
                            if (!res.ok) throw new Error('Failed');
                            setIsEditingAudioText(false);
                            toast.success('Voiceover text updated');
                            // Trigger TTS regeneration
                            const result = await callGenerateApi(
                              `/api/v2/scenes/${scene.id}/generate-tts`
                            );
                            if (result.ok) {
                              setLocalTtsStatus('generating');
                              toast.success(
                                `TTS regeneration started for S${index + 1}`
                              );
                            } else {
                              toast.error(
                                result.error ?? 'TTS generation failed'
                              );
                            }
                          } catch {
                            toast.error('Failed to save voiceover text');
                          } finally {
                            setIsSavingAudioText(false);
                          }
                        }}
                        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isSavingAudioText ? (
                          <IconLoader2 className="size-2.5 animate-spin" />
                        ) : (
                          <IconRefresh className="size-2.5" />
                        )}
                        Save &amp; Regen TTS
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="group/audio flex items-start gap-1">
                    <div className="flex-1 min-w-0">
                      <ExpandableText
                        text={scene.audio_text!}
                        label="Voiceover"
                        italic
                        clampLines={2}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditAudioText(scene.audio_text ?? '');
                        setIsEditingAudioText(true);
                      }}
                      className="p-0.5 rounded hover:bg-muted/50 opacity-0 group-hover/audio:opacity-100 transition-opacity shrink-0 mt-0.5"
                      title="Edit voiceover text"
                    >
                      <IconPencil className="size-2.5 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              {hasAudio && (
                <>
                  <MiniAudioPlayer url={scene.audio_url!} />
                  <GenMetadataTooltip
                    metadata={scene.tts_generation_metadata}
                  />
                </>
              )}
            </div>
          </div>
        ) : null}

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
              {imageMap.get(scene.location_variant_slug!)?.is_main && (
                <span className="text-[7px] opacity-60">M</span>
              )}
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
              {imageMap.get(slug)?.is_main && (
                <span className="text-[7px] opacity-60">M</span>
              )}
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
              {imageMap.get(slug)?.is_main && (
                <span className="text-[7px] opacity-60">M</span>
              )}
            </span>
          ))}
        </div>

        {/* Compact status + generate actions */}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          {/* Prompt status — icon only */}
          <span
            className={hasPrompt ? 'text-green-400' : 'opacity-30'}
            title={hasPrompt ? 'Prompt ready' : 'No prompt'}
          >
            <IconPhoto className="size-3" />
          </span>

          {/* Audio: merged status + generate */}
          {scene.audio_text &&
            (effectiveTtsStatus === 'generating' ? (
              <span
                className="text-yellow-400 animate-pulse"
                title="TTS generating"
              >
                <IconLoader2 className="size-3 animate-spin" />
              </span>
            ) : hasAudio ? (
              <span className="text-green-400" title="Audio ready">
                <IconVolume className="size-3" />
              </span>
            ) : (
              <GenerateButton
                label="TTS"
                genStatus={effectiveTtsStatus}
                hasResult={hasAudio}
                size="sm"
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
            ))}

          {/* Video: merged status + generate */}
          {hasPrompt &&
            (effectiveVideoStatus === 'generating' ? (
              <span
                className="text-yellow-400 animate-pulse"
                title="Video generating"
              >
                <IconLoader2 className="size-3 animate-spin" />
              </span>
            ) : hasVideo ? (
              <>
                <span className="text-green-400" title="Video ready">
                  <IconVideo className="size-3" />
                </span>
                <GenMetadataTooltip
                  metadata={scene.video_generation_metadata}
                />
              </>
            ) : (
              <GenerateButton
                label="Video"
                genStatus={effectiveVideoStatus}
                hasResult={hasVideo}
                size="sm"
                disabled={needsTtsFirst}
                disabledReason="Generate voice-over first"
                onClick={() => {
                  setLocalVideoStatus('generating');
                  void (async () => {
                    const result = await callGenerateApi(
                      `/api/v2/scenes/${scene.id}/generate-video`
                    );
                    if (result.ok) {
                      toast.success(
                        `Video generation started for S${index + 1}`
                      );
                    } else {
                      setLocalVideoStatus(null);
                      toast.error(
                        result.error ?? 'Failed to start Video generation'
                      );
                    }
                  })();
                }}
              />
            ))}

          {/* fal.ai retry — only when failed */}
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
                <CopyButton text={scenePromptText} />
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
                    disabled={
                      isSavingPrompt ||
                      editPromptText.trim() === scenePromptText
                    }
                    onClick={async () => {
                      setIsSavingPrompt(true);
                      try {
                        const res = await fetch(`/api/v2/scenes/${scene.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            structured_prompt: editPromptText.trim()
                              ? [{ text: editPromptText.trim() }]
                              : null,
                          }),
                        });
                        if (!res.ok) {
                          const data = await res.json().catch(() => ({}));
                          throw new Error(data.error ?? 'Failed to save');
                        }
                        setIsEditingPrompt(false);
                        toast.success('Prompt saved');
                      } catch (err) {
                        toast.error(
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
                    setEditPromptText(scenePromptText);
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
            />
          ) : (
            <div className="text-[11px] leading-relaxed text-foreground/80 bg-muted/20 rounded-md p-2.5 border border-border/20">
              <HighlightedPrompt
                prompt={scenePromptText}
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
          <div className="flex flex-col gap-1.5">
            {allSlugs.map((slug) => (
              <SceneVariantTile key={slug} slug={slug} imageMap={imageMap} />
            ))}
          </div>
        </div>
      )}

      {/* Expanded: Sync to Timeline + In Timeline badge */}
      {isExpanded && isInTimeline && (hasAudio || hasVideo) && (
        <div className="px-3 pb-2 pt-1 border-t border-border/20 flex items-center justify-between">
          <span className="text-[9px] text-primary/70 font-medium">
            In Timeline
          </span>
          <button
            type="button"
            disabled={isSyncing || !studio}
            onClick={async (e) => {
              e.stopPropagation();
              if (!studio) return;
              setIsSyncing(true);
              try {
                const result = await syncSceneToTimeline({
                  sceneId: scene.id,
                  scene: {
                    id: scene.id,
                    order: scene.order,
                    title: scene.title,
                    audio_url: scene.audio_url,
                    video_url: scene.video_url,
                    audio_text: scene.audio_text,
                    audio_duration: scene.audio_duration,
                    video_duration: scene.video_duration,
                  },
                  studio,
                  matchVideoToAudio: true,
                  canvasWidth: canvasSize.width,
                  canvasHeight: canvasSize.height,
                });
                toast.success(
                  `Synced ${result.replaced} clip${result.replaced !== 1 ? 's' : ''} to timeline`
                );
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Sync failed');
              } finally {
                setIsSyncing(false);
              }
            }}
            className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSyncing ? (
              <IconLoader2 className="size-2.5 animate-spin" />
            ) : (
              <IconArrowsExchange2 className="size-2.5" />
            )}
            {isSyncing ? 'Syncing...' : 'Sync to Timeline'}
          </button>
        </div>
      )}

      {/* Expanded: Delete scene */}
      {isExpanded && (
        <div className="px-3 pb-2 pt-1 border-t border-border/20 flex justify-end">
          <button
            type="button"
            disabled={isDeleting}
            onClick={async (e) => {
              e.stopPropagation();
              const ok = await confirm({
                title: 'Delete Scene',
                description: `Delete scene "${scene.title || `S${index + 1}`}"? This cannot be undone.`,
              });
              if (!ok) return;
              setIsDeleting(true);
              try {
                const res = await fetch(`/api/v2/scenes/${scene.id}`, {
                  method: 'DELETE',
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  toast.error(data.error ?? 'Failed to delete scene');
                } else {
                  toast.success(`Scene S${index + 1} deleted`);
                  onDelete();
                }
              } catch {
                toast.error('Failed to delete scene');
              } finally {
                setIsDeleting(false);
              }
            }}
            className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isDeleting ? (
              <IconLoader2 className="size-2.5 animate-spin" />
            ) : (
              <IconTrash className="size-2.5" />
            )}
            {isDeleting ? 'Deleting...' : 'Delete Scene'}
          </button>
        </div>
      )}
    </div>
  );
}
