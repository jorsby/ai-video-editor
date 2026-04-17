'use client';

import { useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useStudioStore } from '@/stores/studio-store';
import { useProjectStore } from '@/stores/project-store';
import {
  type SceneForTimeline,
  type SceneTimelineSettings,
  calculateSceneTiming,
  buildSceneClips,
} from '@/lib/timeline/scene-to-timeline';
import type { SceneData } from '../../shared/scene-types';
import {
  IconVolume,
  IconVideo,
  IconLoader2,
  IconSend,
} from '@tabler/icons-react';

// ── Send to Timeline Modal ──────────────────────────────────────────────────────

type TimelineMediaMode = 'both' | 'video-only' | 'audio-only';

export function SendToTimelineModal({
  scenes,
  open,
  onOpenChange,
}: {
  scenes: SceneData[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const studio = useStudioStore((s) => s.studio);
  const canvasSize = useProjectStore((s) => s.canvasSize);

  const [mediaMode, setMediaMode] = useState<TimelineMediaMode>('both');
  const [settings, setSettings] = useState<SceneTimelineSettings[]>(() =>
    scenes.map((s) => ({
      sceneId: s.id,
      matchVideoToAudio: !!(s.audio_text || s.audio_url), // default ON for narrative
    }))
  );
  const [isSending, setIsSending] = useState(false);

  // Reset settings when scenes change
  useEffect(() => {
    setSettings(
      scenes.map((s) => ({
        sceneId: s.id,
        matchVideoToAudio: !!(s.audio_text || s.audio_url),
      }))
    );
  }, [scenes]);

  const updateSetting = (
    sceneId: string,
    patch: Partial<SceneTimelineSettings>
  ) => {
    setSettings((prev) =>
      prev.map((s) => (s.sceneId === sceneId ? { ...s, ...patch } : s))
    );
  };

  // Calculate total duration (estimate from DB values — real durations probed at send time)
  const totalDuration = scenes.reduce((sum, scene) => {
    const s = settings.find((x) => x.sceneId === scene.id);
    if (!s) return sum;
    const timing = calculateSceneTiming(
      scene.audio_duration ?? 0,
      scene.video_duration ?? 0,
      !!scene.audio_text,
      s
    );
    return sum + timing.sceneDuration;
  }, 0);

  const handleSend = async () => {
    if (!studio) {
      toast.error('Editor not ready');
      return;
    }

    setIsSending(true);
    try {
      const results = await buildSceneClips({
        scenes: scenes as SceneForTimeline[],
        settings,
        canvasWidth: canvasSize.width,
        canvasHeight: canvasSize.height,
      });

      // Create tracks based on media mode selection
      const includeVideo = mediaMode !== 'audio-only';
      const includeAudio = mediaMode !== 'video-only';

      const hasAnyVideo = includeVideo && results.some((r) => r.videoClip);
      const hasAnyAudio = includeAudio && results.some((r) => r.audioClip);

      let videoTrackId: string | undefined;
      let audioTrackId: string | undefined;

      if (hasAnyVideo) {
        const track = studio.addTrack({ type: 'Video', name: 'Scene Video' });
        videoTrackId = track.id;
      }
      if (hasAnyAudio) {
        const track = studio.addTrack({ type: 'Audio', name: 'Scene Audio' });
        audioTrackId = track.id;
      }

      for (const result of results) {
        if (result.videoClip && videoTrackId) {
          await studio.addClip(result.videoClip, { trackId: videoTrackId });
        }
        if (result.audioClip && audioTrackId) {
          await studio.addClip(result.audioClip, { trackId: audioTrackId });
        }
      }

      const videoCount = hasAnyVideo
        ? results.filter((r) => r.videoClip).length
        : 0;
      const audioCount = hasAnyAudio
        ? results.filter((r) => r.audioClip).length
        : 0;
      const modeLabel =
        mediaMode === 'video-only'
          ? 'video'
          : mediaMode === 'audio-only'
            ? 'audio'
            : 'video + audio';
      toast.success(
        `Added ${videoCount + audioCount} ${modeLabel} clips to timeline`
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to add clips'
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <DialogTitle className="text-sm font-semibold flex items-center gap-2">
          <IconSend className="size-4" />
          Send to Timeline
          <Badge variant="secondary" className="text-[10px]">
            {scenes.length} scene{scenes.length !== 1 ? 's' : ''}
          </Badge>
        </DialogTitle>

        {/* Media mode selector */}
        <div className="flex items-center gap-1 pb-2 border-b border-border/30">
          {(
            [
              { value: 'both', label: 'Video + Audio' },
              { value: 'video-only', label: 'Video Only' },
              { value: 'audio-only', label: 'Audio Only' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMediaMode(opt.value)}
              className={`flex-1 text-[10px] py-1 px-2 rounded border transition-colors ${
                mediaMode === opt.value
                  ? 'border-primary bg-primary/15 text-primary font-medium'
                  : 'border-border/40 bg-transparent text-muted-foreground hover:bg-muted/20'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Bulk controls */}
        <div className="space-y-2 pb-2 border-b border-border/30">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
            All Scenes
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.every((s) => s.matchVideoToAudio)}
              onChange={(e) =>
                setSettings((prev) =>
                  prev.map((s) => ({
                    ...s,
                    matchVideoToAudio: e.target.checked,
                  }))
                )
              }
              className="size-3.5 rounded border-border/60 accent-primary"
            />
            <span className="text-[10px] text-muted-foreground">
              Match video speed to audio (all scenes)
            </span>
          </label>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-3 py-2">
            {scenes.map((scene, i) => {
              const s = settings.find((x) => x.sceneId === scene.id);
              if (!s) return null;

              const timing = calculateSceneTiming(
                scene.audio_duration ?? 0,
                scene.video_duration ?? 0,
                !!scene.audio_text,
                s
              );
              const hasAudio = !!scene.audio_url;
              const hasVideo = !!scene.video_url;

              return (
                <div
                  key={scene.id}
                  className="rounded-md border border-border/40 bg-card/50 p-3 space-y-2.5"
                >
                  {/* Scene header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-muted-foreground">
                        S{i + 1}
                      </span>
                      <span className="text-xs font-medium truncate">
                        {scene.title || `Scene ${i + 1}`}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {timing.sceneDuration.toFixed(1)}s
                    </span>
                  </div>

                  {/* Media info */}
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    {hasAudio && (
                      <span className="flex items-center gap-1">
                        <IconVolume className="size-3" />
                        {(scene.audio_duration ?? 0).toFixed(1)}s
                      </span>
                    )}
                    {hasVideo && (
                      <span className="flex items-center gap-1">
                        <IconVideo className="size-3" />
                        {(scene.video_duration ?? 0).toFixed(1)}s
                      </span>
                    )}
                    {s.matchVideoToAudio && timing.videoPlaybackRate !== 1 && (
                      <span className="font-mono text-primary">
                        {timing.videoPlaybackRate.toFixed(2)}x
                      </span>
                    )}
                  </div>

                  {/* Speed match toggle — any scene with both audio and video */}
                  {hasAudio && hasVideo && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={s.matchVideoToAudio}
                        onChange={(e) =>
                          updateSetting(scene.id, {
                            matchVideoToAudio: e.target.checked,
                          })
                        }
                        className="size-3.5 rounded border-border/60 accent-primary"
                      />
                      <span className="text-[10px] text-muted-foreground">
                        Match video to audio
                        {s.matchVideoToAudio &&
                          timing.videoPlaybackRate !== 1 && (
                            <span className="ml-1 font-mono text-primary">
                              ({timing.videoPlaybackRate.toFixed(2)}x)
                            </span>
                          )}
                      </span>
                    </label>
                  )}

                  {/* Warnings */}
                  {!hasVideo && !hasAudio && (
                    <p className="text-[9px] text-amber-400">
                      No media — scene will be skipped
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-border/40">
          <div className="text-[11px] text-muted-foreground">
            Total:{' '}
            <span className="font-mono font-medium text-foreground">
              {totalDuration.toFixed(1)}s
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => onOpenChange(false)}
              disabled={isSending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={handleSend}
              disabled={
                isSending || scenes.every((s) => !s.video_url && !s.audio_url)
              }
            >
              {isSending ? (
                <IconLoader2 className="size-3 animate-spin" />
              ) : (
                <IconSend className="size-3" />
              )}
              Add to Timeline
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
