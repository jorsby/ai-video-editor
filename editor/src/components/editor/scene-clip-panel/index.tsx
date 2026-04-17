'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IClip } from 'openvideo';
import { useStudioStore } from '@/stores/studio-store';
import { useProjectStore } from '@/stores/project-store';
import { useSceneData } from '@/hooks/use-scene-data';
import { syncSceneToTimeline } from '@/lib/timeline/sync-scene-to-timeline';
import {
  type SceneData,
  type VariantImageMap,
  callGenerateApi,
  deriveSceneStatus,
  statusColor,
  slugToLabel,
  formatDuration,
} from '@/components/editor/media-panel/shared/scene-types';
import { ExpandableText } from '@/components/editor/media-panel/shared/expandable-text';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group';
import { NumberInput } from '@/components/ui/number-input';
import {
  IconVolume,
  IconGauge,
  IconVideo,
  IconMapPin,
  IconUser,
  IconBox,
  IconLoader2,
  IconPlayerPlay,
  IconPlayerPause,
  IconPhoto,
  IconSparkles,
  IconRefresh,
  IconPencil,
  IconDeviceFloppy,
  IconX,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

// ── SceneClipPanel ──────────────────────────────────────────────────────────────

export function SceneClipPanel({ selectedClips }: { selectedClips: IClip[] }) {
  const { studio } = useStudioStore();
  const sceneId = (selectedClips[0]?.metadata?.sceneId as string) ?? null;

  // Find sibling video and audio clips for this scene
  const videoClip = studio?.clips.find(
    (c) => c.type === 'Video' && (c.metadata?.sceneId as string) === sceneId
  ) as any | null;

  const audioClip = studio?.clips.find(
    (c) => c.type === 'Audio' && (c.metadata?.sceneId as string) === sceneId
  ) as any | null;

  // Re-render when clip props change
  const [, setTick] = useState(0);
  useEffect(() => {
    const clips = [videoClip, audioClip].filter(Boolean);
    const onPropsChange = () => setTick((t) => t + 1);
    for (const clip of clips) {
      clip.on?.('propsChange', onPropsChange);
    }
    return () => {
      for (const clip of clips) {
        clip.off?.('propsChange', onPropsChange);
      }
    };
  }, [videoClip, audioClip]);

  // Video update handler (recalculates duration on speed change)
  const handleVideoUpdate = useCallback(
    (updates: any) => {
      if (!videoClip) return;
      if ('playbackRate' in updates && studio && videoClip.trim) {
        const newRate = updates.playbackRate || 1;
        const newDuration = Math.round(
          (videoClip.trim.to - videoClip.trim.from) / newRate
        );
        studio.updateClip(videoClip.id, { ...updates, duration: newDuration });
      } else {
        videoClip.update(updates);
      }
    },
    [videoClip, studio]
  );

  // Audio update handler (recalculates duration on speed change)
  const handleAudioUpdate = useCallback(
    (updates: any) => {
      if (!audioClip) return;
      if ('playbackRate' in updates && studio && audioClip.trim) {
        const newRate = updates.playbackRate || 1;
        const newDuration = Math.round(
          (audioClip.trim.to - audioClip.trim.from) / newRate
        );
        studio.updateClip(audioClip.id, { ...updates, duration: newDuration });
      } else {
        audioClip.update(updates);
      }
    },
    [audioClip, studio]
  );

  // Fetch scene data
  const { scene, imageMap, isLoading } = useSceneData(sceneId);

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-4">
        {/* Section A: Video Clip Controls */}
        {videoClip && (
          <div className="flex flex-col gap-3">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Video
            </span>
            {/* Volume */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-muted-foreground">Volume</span>
              <div className="flex items-center gap-4">
                <IconVolume className="size-4 text-muted-foreground" />
                <Slider
                  value={[Math.round((videoClip.volume ?? 1) * 100)]}
                  onValueChange={(v) =>
                    handleVideoUpdate({ volume: v[0] / 100 })
                  }
                  max={100}
                  step={1}
                  className="flex-1"
                />
                <InputGroup className="w-20">
                  <NumberInput
                    value={Math.round((videoClip.volume ?? 1) * 100)}
                    onChange={(val) => handleVideoUpdate({ volume: val / 100 })}
                    className="p-0 text-center"
                  />
                  <InputGroupAddon align="inline-end" className="p-0 pr-2">
                    <span className="text-[10px] text-muted-foreground">%</span>
                  </InputGroupAddon>
                </InputGroup>
              </div>
            </div>
            {/* Speed */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-muted-foreground">Speed</span>
              <div className="flex items-center gap-4">
                <IconGauge className="size-4 text-muted-foreground" />
                <Slider
                  value={[Math.round((videoClip.playbackRate ?? 1) * 100)]}
                  onValueChange={(v) =>
                    handleVideoUpdate({ playbackRate: v[0] / 100 })
                  }
                  min={25}
                  max={400}
                  step={5}
                  className="flex-1"
                />
                <InputGroup className="w-20">
                  <NumberInput
                    value={Math.round((videoClip.playbackRate ?? 1) * 100)}
                    onChange={(val) =>
                      handleVideoUpdate({ playbackRate: val / 100 })
                    }
                    className="p-0 text-center"
                  />
                  <InputGroupAddon align="inline-end" className="p-0 pr-2">
                    <span className="text-[10px] text-muted-foreground">%</span>
                  </InputGroupAddon>
                </InputGroup>
              </div>
            </div>
          </div>
        )}

        {/* Section B: Audio/VoiceOver Clip Controls */}
        {audioClip && (
          <div className="flex flex-col gap-3">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              VoiceOver
            </span>
            {/* Volume */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-muted-foreground">Volume</span>
              <div className="flex items-center gap-4">
                <IconVolume className="size-4 text-muted-foreground" />
                <Slider
                  value={[Math.round((audioClip.volume ?? 1) * 100)]}
                  onValueChange={(v) =>
                    handleAudioUpdate({ volume: v[0] / 100 })
                  }
                  max={100}
                  step={1}
                  className="flex-1"
                />
                <InputGroup className="w-20">
                  <NumberInput
                    value={Math.round((audioClip.volume ?? 1) * 100)}
                    onChange={(val) => handleAudioUpdate({ volume: val / 100 })}
                    className="p-0 text-center"
                  />
                  <InputGroupAddon align="inline-end" className="p-0 pr-2">
                    <span className="text-[10px] text-muted-foreground">%</span>
                  </InputGroupAddon>
                </InputGroup>
              </div>
            </div>
            {/* Speed */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-muted-foreground">Speed</span>
              <div className="flex items-center gap-4">
                <IconGauge className="size-4 text-muted-foreground" />
                <Slider
                  value={[Math.round((audioClip.playbackRate ?? 1) * 100)]}
                  onValueChange={(v) =>
                    handleAudioUpdate({ playbackRate: v[0] / 100 })
                  }
                  min={25}
                  max={400}
                  step={5}
                  className="flex-1"
                />
                <InputGroup className="w-20">
                  <NumberInput
                    value={Math.round((audioClip.playbackRate ?? 1) * 100)}
                    onChange={(val) =>
                      handleAudioUpdate({ playbackRate: val / 100 })
                    }
                    className="p-0 text-center"
                  />
                  <InputGroupAddon align="inline-end" className="p-0 pr-2">
                    <span className="text-[10px] text-muted-foreground">%</span>
                  </InputGroupAddon>
                </InputGroup>
              </div>
            </div>
          </div>
        )}

        {/* Duration Sync */}
        {videoClip && audioClip && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!videoClip.trim || !audioClip.duration) return;
                const targetDuration = audioClip.duration;
                const rawDuration = videoClip.trim.to - videoClip.trim.from;
                const newRate = rawDuration / targetDuration;
                const clampedRate = Math.max(0.25, Math.min(4, newRate));
                handleVideoUpdate({ playbackRate: clampedRate });
                toast.success('Video speed matched to VoiceOver');
              }}
              className="flex-1 inline-flex items-center justify-center gap-1 text-[9px] px-2 py-1.5 rounded border border-border/40 bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              title="Adjust video speed so its duration matches the voiceover"
            >
              <IconVideo className="size-3" />
              <span>Match to VoiceOver</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!audioClip.trim || !videoClip.duration) return;
                const targetDuration = videoClip.duration;
                const rawDuration = audioClip.trim.to - audioClip.trim.from;
                const newRate = rawDuration / targetDuration;
                const clampedRate = Math.max(0.25, Math.min(4, newRate));
                handleAudioUpdate({ playbackRate: clampedRate });
                toast.success('VoiceOver speed matched to Video');
              }}
              className="flex-1 inline-flex items-center justify-center gap-1 text-[9px] px-2 py-1.5 rounded border border-border/40 bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
              title="Adjust voiceover speed so its duration matches the video"
            >
              <IconVolume className="size-3" />
              <span>Match to Video</span>
            </button>
          </div>
        )}

        {/* Divider */}
        {(videoClip || audioClip) && <div className="h-px bg-border" />}

        {/* Section C: Scene Editor */}
        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {scene && !isLoading && (
          <SceneSection scene={scene} imageMap={imageMap} sceneId={sceneId!} />
        )}
      </div>
    </ScrollArea>
  );
}

// ── Scene Section ────────────────────────────────────────────────────────────

function SceneSection({
  scene,
  imageMap,
  sceneId,
}: {
  scene: SceneData;
  imageMap: VariantImageMap;
  sceneId: string;
}) {
  const { studio } = useStudioStore();
  const { canvasSize } = useProjectStore();

  // Optimistic generation status
  const [localTtsStatus, setLocalTtsStatus] = useState<string | null>(null);
  const [localVideoStatus, setLocalVideoStatus] = useState<string | null>(null);

  // Auto-sync timeline when media URLs change (after generation)
  const prevUrlsRef = useRef({
    audio: scene.audio_url,
    video: scene.video_url,
  });
  useEffect(() => {
    const prev = prevUrlsRef.current;
    const audioArrived = scene.audio_url !== prev.audio && !!scene.audio_url;
    const videoArrived = scene.video_url !== prev.video && !!scene.video_url;
    prevUrlsRef.current = { audio: scene.audio_url, video: scene.video_url };

    if (!audioArrived && !videoArrived) return;
    if (!studio) return;

    void (async () => {
      try {
        await syncSceneToTimeline({
          sceneId,
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
        studio.deselectClip();
        const newClip = studio.clips.find(
          (c) =>
            c.type === 'Video' && (c.metadata?.sceneId as string) === sceneId
        );
        if (newClip) studio.selectClipsByIds([newClip.id]);
        toast.success('Timeline updated');
      } catch {
        // Silent fail
      }
    })();
  }, [scene.audio_url, scene.video_url, sceneId, studio, canvasSize]);

  // Prompt editing
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editPromptText, setEditPromptText] = useState('');
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  // Reset local overrides when DB status arrives
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

  const effectiveTtsStatus = localTtsStatus ?? scene.tts_status;
  const effectiveVideoStatus = localVideoStatus ?? scene.video_status;
  const hasAudio = !!scene.audio_url;
  const hasVideo = !!scene.video_url;
  const hasPrompt = !!scene.prompt;
  const isNarrative = !!scene.audio_text;
  const needsTtsFirst = isNarrative && !hasAudio;

  const allSlugs: string[] = [];
  if (scene.location_variant_slug) allSlugs.push(scene.location_variant_slug);
  if (scene.character_variant_slugs)
    allSlugs.push(...scene.character_variant_slugs);
  if (scene.prop_variant_slugs) allSlugs.push(...scene.prop_variant_slugs);

  return (
    <div className="flex flex-col gap-3">
      {/* Title + Status */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium truncate flex-1">
          {scene.title || 'Untitled Scene'}
        </span>
        <Badge
          variant="outline"
          className={`text-[9px] shrink-0 ${statusColor(
            deriveSceneStatus({
              ...scene,
              tts_status: effectiveTtsStatus,
              video_status: effectiveVideoStatus,
            })
          )}`}
        >
          {deriveSceneStatus({
            ...scene,
            tts_status: effectiveTtsStatus,
            video_status: effectiveVideoStatus,
          })}
        </Badge>
      </div>

      {/* Voiceover text */}
      {scene.audio_text && (
        <ExpandableText
          text={scene.audio_text}
          label="Voiceover"
          italic
          clampLines={2}
        />
      )}

      {/* Media row */}
      {(hasAudio || hasVideo) && (
        <div className="flex flex-col gap-1.5">
          {hasAudio && <MiniAudioPlayer url={scene.audio_url!} />}
          {hasVideo && (
            <VideoThumbnail
              url={scene.video_url!}
              duration={scene.video_duration}
            />
          )}
        </div>
      )}

      {/* Visual Prompt */}
      {(hasPrompt || isEditingPrompt) && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Visual Prompt
            </span>
            <div className="flex items-center gap-1">
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
                      editPromptText.trim() === (scene.prompt ?? '')
                    }
                    onClick={async () => {
                      setIsSavingPrompt(true);
                      try {
                        const supabase = createClient('studio');
                        const { error } = await supabase
                          .from('scenes')
                          .update({
                            structured_prompt: [
                              { prompt: editPromptText.trim() },
                            ],
                          })
                          .eq('id', sceneId);
                        if (error) throw new Error(error.message);
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
                    setEditPromptText(scene.prompt ?? '');
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
            <p className="text-[11px] leading-relaxed text-foreground/80 bg-muted/20 rounded-md p-2.5 border border-border/20">
              {scene.prompt}
            </p>
          )}
        </div>
      )}

      {/* Asset badges */}
      {allSlugs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {scene.location_variant_slug && (
            <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <VariantAvatar
                slug={scene.location_variant_slug}
                imageMap={imageMap}
              />
              <IconMapPin className="size-2.5" />
              {slugToLabel(scene.location_variant_slug)}
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
            </span>
          ))}
        </div>
      )}

      {/* Generation status + buttons */}
      <div className="flex flex-col gap-1.5 text-[10px]">
        {/* Audio row */}
        {scene.audio_text && (
          <div className="flex items-center gap-2">
            <GenerationStatus
              label="Audio"
              icon={<IconVolume className="size-3 inline mr-0.5" />}
              genStatus={effectiveTtsStatus}
              hasResult={hasAudio}
            />
            <div className="flex-1" />
            <GenerateButton
              label="TTS"
              genStatus={effectiveTtsStatus}
              hasResult={hasAudio}
              onClick={() => {
                setLocalTtsStatus('generating');
                void (async () => {
                  const result = await callGenerateApi(
                    `/api/v2/scenes/${sceneId}/generate-tts`
                  );
                  if (result.ok) {
                    toast.success('TTS generation started');
                  } else {
                    setLocalTtsStatus(null);
                    toast.error(
                      result.error ?? 'Failed to start TTS generation'
                    );
                  }
                })();
              }}
            />
            {effectiveTtsStatus === 'failed' && (
              <button
                type="button"
                onClick={() => {
                  setLocalTtsStatus('generating');
                  void (async () => {
                    const result = await callGenerateApi(
                      `/api/v2/scenes/${sceneId}/generate-tts`,
                      { provider: 'fal' }
                    );
                    if (result.ok) {
                      toast.success('fal.ai TTS retry started');
                    } else {
                      setLocalTtsStatus(null);
                      toast.error(result.error ?? 'fal.ai TTS retry failed');
                    }
                  })();
                }}
                className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500/20 transition-colors cursor-pointer"
                title="Retry TTS with fal.ai"
              >
                <IconRefresh className="size-2.5" />
                fal.ai
              </button>
            )}
          </div>
        )}
        {/* Video row */}
        {hasPrompt && (
          <div className="flex items-center gap-2">
            <GenerationStatus
              label="Video"
              icon={<IconVideo className="size-3 inline mr-0.5" />}
              genStatus={effectiveVideoStatus}
              hasResult={hasVideo}
            />
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <GenerateButton
                label="Video"
                genStatus={effectiveVideoStatus}
                hasResult={hasVideo}
                disabled={needsTtsFirst}
                disabledReason="Generate voice-over first"
                onClick={() => {
                  setLocalVideoStatus('generating');
                  void (async () => {
                    const result = await callGenerateApi(
                      `/api/v2/scenes/${sceneId}/generate-video`
                    );
                    if (result.ok) {
                      toast.success('Video generation started');
                    } else {
                      setLocalVideoStatus(null);
                      toast.error(
                        result.error ?? 'Failed to start Video generation'
                      );
                    }
                  })();
                }}
              />
              {effectiveVideoStatus === 'failed' && (
                <button
                  type="button"
                  onClick={() => {
                    setLocalVideoStatus('generating');
                    void (async () => {
                      const result = await callGenerateApi(
                        `/api/v2/scenes/${sceneId}/generate-video`,
                        { provider: 'fal' }
                      );
                      if (result.ok) {
                        toast.success('fal.ai retry started');
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
        )}
        {/* Prompt indicator */}
        <div className="flex items-center gap-2">
          <span
            className={hasPrompt ? 'text-green-400' : 'opacity-30'}
            title="Visual prompt"
          >
            <IconPhoto className="size-3 inline mr-0.5" />
            Prompt
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components (inlined for simplicity) ─────────────────────────────────

function VariantAvatar({
  slug,
  imageMap,
}: {
  slug: string;
  imageMap: VariantImageMap;
}) {
  const info = imageMap.get(slug);
  const url = info?.image_url;

  if (!url) {
    return (
      <div
        className="size-4 rounded-full bg-muted/40 border border-border/30 flex items-center justify-center shrink-0"
        title={slugToLabel(slug)}
      >
        <span className="text-[6px] text-muted-foreground">?</span>
      </div>
    );
  }

  return (
    <div
      className="size-4 rounded-full overflow-hidden border border-border/40 shrink-0"
      title={slugToLabel(slug)}
    >
      <img
        src={url}
        alt={slugToLabel(slug)}
        className="w-full h-full object-cover"
      />
    </div>
  );
}

function MiniAudioPlayer({ url }: { url: string }) {
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
      <div className="flex-1 h-1 bg-muted/30 rounded-full overflow-hidden min-w-[40px]">
        <div
          className="h-full bg-blue-400/60 rounded-full transition-all duration-200"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      {audioDuration !== null && (
        <span className="text-[9px] font-mono text-muted-foreground shrink-0">
          {playing ? fmtTime(currentTime) : fmtTime(audioDuration)}
        </span>
      )}
    </div>
  );
}

function VideoThumbnail({
  url,
  duration,
}: {
  url: string;
  duration?: number | null;
}) {
  const [showPlayer, setShowPlayer] = useState(false);
  const thumbRef = useRef<HTMLVideoElement | null>(null);
  const [thumbReady, setThumbReady] = useState(false);
  const [isVertical, setIsVertical] = useState(false);

  if (showPlayer) {
    return (
      <div
        className={`relative rounded-lg overflow-hidden border border-border/30 bg-black ${isVertical ? 'flex justify-center' : ''}`}
      >
        <video
          src={url}
          controls
          autoPlay
          className={
            isVertical
              ? 'h-[300px] max-w-full object-contain rounded-lg'
              : 'w-full max-h-[300px] object-contain rounded-lg'
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
      {!thumbReady && (
        <div className="absolute inset-0 bg-gradient-to-br from-muted/40 to-muted/20" />
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/20 transition-colors">
        <div
          className={`rounded-full bg-white/20 backdrop-blur-sm border border-white/20 flex items-center justify-center group-hover:bg-white/30 group-hover:scale-110 transition-all shadow-lg ${isVertical ? 'size-8' : 'size-10'}`}
        >
          <IconPlayerPlay
            className={`text-white ml-0.5 ${isVertical ? 'size-4' : 'size-5'}`}
          />
        </div>
      </div>
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

function GenerateButton({
  label,
  genStatus,
  hasResult,
  onClick,
  disabled = false,
  disabledReason,
}: {
  label: string;
  genStatus: string;
  hasResult: boolean;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  if (disabled && !hasResult && genStatus !== 'generating') {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground/50 border border-border/20 cursor-not-allowed"
        title={disabledReason ?? `Cannot generate ${label}`}
      >
        <IconSparkles className="size-2.5 opacity-40" />
        Generate {label}
      </span>
    );
  }

  if (genStatus === 'generating') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 animate-pulse font-medium">
        <IconLoader2 className="size-3 animate-spin" />
        Generating {label}...
      </span>
    );
  }

  if (hasResult) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground border border-border/30 hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
        title={`Regenerate ${label}`}
      >
        <IconRefresh className="size-2.5" />
        Regen
      </button>
    );
  }

  if (genStatus === 'failed') {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-pointer"
        title={`Retry ${label}`}
      >
        <IconRefresh className="size-2.5" />
        Retry
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors cursor-pointer"
      title={`Generate ${label}`}
    >
      <IconSparkles className="size-2.5" />
      Generate {label}
    </button>
  );
}

function GenerationStatus({
  label,
  icon,
  genStatus,
  hasResult,
}: {
  label: string;
  icon: React.ReactNode;
  genStatus: string;
  hasResult: boolean;
}) {
  if (genStatus === 'generating') {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-yellow-400 animate-pulse bg-yellow-500/10 px-1.5 py-0.5 rounded border border-yellow-500/20"
        title={`${label}: Generating...`}
      >
        {icon}
        <IconLoader2 className="size-2.5 inline animate-spin" />
        <span className="text-[8px] font-medium">Generating</span>
      </span>
    );
  }
  if (genStatus === 'failed') {
    return (
      <span className="text-red-400" title={`${label}: Failed`}>
        {icon}
        <span className="text-[8px]">&#10007;</span>
      </span>
    );
  }
  return (
    <span className={hasResult ? 'text-green-400' : 'opacity-30'} title={label}>
      {icon}
      {label}
    </span>
  );
}
