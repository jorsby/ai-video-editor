'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudioStore } from '@/stores/studio-store';
import { Audio, Log } from 'openvideo';
import { createClient } from '@/lib/supabase/client';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  IconChevronDown,
  IconChevronUp,
  IconLoader2,
  IconMusic,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconPlaylistAdd,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { toast } from 'sonner';

interface MusicTrack {
  id: string;
  project_id: string;
  video_id: string | null;
  name: string;
  music_type: 'lyrical' | 'instrumental';
  prompt: string | null;
  style: string | null;
  title: string | null;
  audio_url: string | null;
  cover_image_url: string | null;
  duration: number | null;
  status: 'draft' | 'generating' | 'done' | 'failed';
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function MusicTrackCard({
  track,
  onAddToTimeline,
  onDelete,
}: {
  track: MusicTrack;
  onAddToTimeline: (track: MusicTrack) => void;
  onDelete: (trackId: string) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [localTitle, setLocalTitle] = useState(track.title ?? track.name ?? '');
  const [localStyle, setLocalStyle] = useState(track.style ?? '');
  const [localPrompt, setLocalPrompt] = useState(track.prompt ?? '');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalTitle(track.title ?? track.name ?? '');
    setLocalStyle(track.style ?? '');
    setLocalPrompt(track.prompt ?? '');
  }, [track.id]);

  const schedulePatch = useCallback(
    (updates: Record<string, unknown>) => {
      if (patchTimer.current) clearTimeout(patchTimer.current);
      patchTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/v2/music/${track.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            toast.error(data.error ?? 'Failed to save changes');
          }
        } catch {
          toast.error('Failed to save changes');
        }
      }, 700);
    },
    [track.id]
  );

  const handleTitleChange = (val: string) => {
    setLocalTitle(val);
    const trimmed = val.trim();
    if (trimmed) schedulePatch({ title: trimmed });
  };
  const handleStyleChange = (val: string) => {
    setLocalStyle(val);
    const trimmed = val.trim();
    if (trimmed) schedulePatch({ style: trimmed });
  };
  const handlePromptChange = (val: string) => {
    setLocalPrompt(val);
    const trimmed = val.trim();
    schedulePatch({ prompt: trimmed.length > 0 ? trimmed : null });
  };

  const handleRetry = async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    const isStuck = track.status === 'generating';
    const endpoint = isStuck
      ? `/api/v2/music/${track.id}/refresh`
      : `/api/v2/music/${track.id}/generate`;
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIsRetrying(false);
        toast.error(
          data.error ??
            (isStuck
              ? 'Failed to refresh status'
              : 'Failed to regenerate music')
        );
        return;
      }
      if (isStuck) {
        if (data.status === 'done') {
          toast.success(`Music ready: ${track.name}`);
        } else if (data.status === 'failed') {
          toast.error(
            data.failed_reason
              ? `Music failed: ${data.failed_reason}`
              : 'Music generation failed on provider'
          );
        } else {
          toast.info('Still generating — checked again just now');
        }
        setIsRetrying(false);
      } else {
        toast.success(`Music regenerating: ${track.name}`);
      }
    } catch {
      setIsRetrying(false);
      toast.error('Network error');
    }
  };

  // Reset retry state when track status changes via realtime
  useEffect(() => {
    if (isRetrying && track.status !== 'generating') {
      setIsRetrying(false);
    }
  }, [track.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePlay = () => {
    if (!track.audio_url) return;
    if (playing && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }
    const audio = new window.Audio(track.audio_url);
    audio.onended = () => setPlaying(false);
    audio.play();
    audioRef.current = audio;
    setPlaying(true);
  };

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const isGenerating = track.status === 'generating';
  const isFailed = track.status === 'failed';
  const isDone = track.status === 'done' && !!track.audio_url;

  return (
    <div className="rounded-md border border-border/30 bg-muted/10 hover:bg-muted/20 transition-colors group">
      <div className="flex items-center gap-2 px-2.5 py-2">
        {/* Cover / Icon */}
        {track.cover_image_url ? (
          <img
            src={track.cover_image_url}
            alt={track.name}
            className="w-10 h-10 rounded object-cover shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded bg-muted/30 border border-border/30 shrink-0 flex items-center justify-center">
            {isGenerating ? (
              <IconLoader2 className="size-4 animate-spin text-amber-400" />
            ) : (
              <IconMusic className="size-4 text-muted-foreground" />
            )}
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium truncate">{track.name}</p>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted-foreground capitalize">
              {track.music_type}
            </span>
            {isDone && (
              <span className="text-[9px] text-muted-foreground">
                {formatDuration(track.duration)}
              </span>
            )}
            {isGenerating && (
              <span className="text-[9px] text-amber-400 animate-pulse">
                Generating...
              </span>
            )}
            {isFailed && (
              <span className="text-[9px] text-red-400">Failed</span>
            )}
          </div>
          {track.style && (
            <p className="text-[9px] text-muted-foreground/60 truncate">
              {track.style}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Retry / Regenerate — also shown for stuck 'generating' tracks */}
          {(isFailed || isDone || track.status === 'generating') && (
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={isRetrying}
              className="p-1 rounded hover:bg-blue-500/20 text-blue-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                isFailed
                  ? 'Retry'
                  : track.status === 'generating'
                    ? 'Stuck? Force retry'
                    : 'Regenerate'
              }
            >
              <IconRefresh className="size-3.5" />
            </button>
          )}
          {isDone && (
            <>
              <button
                type="button"
                onClick={togglePlay}
                className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                title={playing ? 'Stop' : 'Preview'}
              >
                {playing ? (
                  <IconPlayerStopFilled className="size-3.5" />
                ) : (
                  <IconPlayerPlayFilled className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onAddToTimeline(track)}
                className="p-1 rounded hover:bg-primary/20 text-primary transition-colors"
                title="Add to timeline"
              >
                <IconPlus className="size-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            title={expanded ? 'Collapse' : 'Edit prompts'}
          >
            {expanded ? (
              <IconChevronUp className="size-3.5" />
            ) : (
              <IconChevronDown className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => onDelete(track.id)}
            className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
            title="Delete"
          >
            <IconTrash className="size-3" />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-2.5 pb-2.5 pt-2 space-y-2 border-t border-border/30">
          <label className="block">
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">
              Title
            </span>
            <input
              value={localTitle}
              onChange={(e) => handleTitleChange(e.target.value)}
              className="w-full mt-0.5 px-1.5 py-1 text-[11px] rounded bg-background/40 border border-border/30 focus:border-primary/50 outline-none"
              placeholder="Track title"
            />
          </label>
          <label className="block">
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">
              Style
            </span>
            <textarea
              value={localStyle}
              onChange={(e) => handleStyleChange(e.target.value)}
              rows={2}
              className="w-full mt-0.5 px-1.5 py-1 text-[11px] rounded bg-background/40 border border-border/30 focus:border-primary/50 outline-none resize-none"
              placeholder="Musical style, mood, instruments..."
            />
          </label>
          <label className="block">
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground/60">
              Prompt (lyrics)
            </span>
            <textarea
              value={localPrompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              rows={3}
              className="w-full mt-0.5 px-1.5 py-1 text-[11px] rounded bg-background/40 border border-border/30 focus:border-primary/50 outline-none resize-none"
              placeholder="Leave empty for instrumental"
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function ProjectMusicSection({
  projectId,
  videoId,
}: {
  projectId: string | null;
  videoId?: string | null;
}) {
  const { studio } = useStudioStore();
  const [isOpen, setIsOpen] = useState(true);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTracks = useCallback(async () => {
    if (!projectId) {
      setTracks([]);
      return;
    }
    setLoading(true);
    try {
      const url = videoId
        ? `/api/v2/videos/${videoId}/music`
        : `/api/v2/projects/${projectId}/music`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setTracks(data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectId, videoId]);

  useEffect(() => {
    void fetchTracks();
  }, [fetchTracks]);

  // Auto-poll KIE for tracks stuck in `generating` when the webhook drops —
  // refresh endpoint flips them to done/failed if KIE has a result.
  useEffect(() => {
    const generatingIds = tracks
      .filter((t) => t.status === 'generating')
      .map((t) => t.id);
    if (generatingIds.length === 0) return;

    const tick = async () => {
      await Promise.all(
        generatingIds.map((id) =>
          fetch(`/api/v2/music/${id}/refresh`, { method: 'POST' }).catch(
            () => null
          )
        )
      );
      void fetchTracks();
    };

    const handle = setInterval(() => {
      void tick();
    }, 20_000);
    return () => clearInterval(handle);
  }, [tracks, fetchTracks]);

  // Realtime subscription for musics changes
  useEffect(() => {
    if (!projectId) return;

    const supabase = createClient('studio');
    const filterStr = videoId
      ? `video_id=eq.${videoId}`
      : `project_id=eq.${projectId}`;
    const channel = supabase
      .channel(`project-music-${videoId ?? projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'musics',
          filter: filterStr,
        },
        () => {
          void fetchTracks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, videoId, fetchTracks]);

  const handleAddToTimeline = useCallback(
    async (track: MusicTrack) => {
      if (!studio || !track.audio_url) return;
      try {
        // Proxy through our API to avoid CORS issues with external audio URLs
        const proxyUrl = `/api/proxy/media?url=${encodeURIComponent(track.audio_url)}`;
        const audioClip = await Audio.fromUrl(proxyUrl);
        audioClip.name = track.name;
        audioClip.volume = 1;
        await studio.addClip(audioClip);
        toast.success(`Added "${track.name}" to timeline`);
      } catch (error) {
        Log.error('Failed to add music to timeline:', error);
        toast.error('Failed to add music to timeline');
      }
    },
    [studio]
  );

  const [addingAll, setAddingAll] = useState(false);

  const handleAddAllToTimeline = useCallback(async () => {
    if (!studio) return;
    const doneTracks = tracks.filter((t) => t.status === 'done' && t.audio_url);
    if (doneTracks.length === 0) {
      toast.error('No completed music tracks to add');
      return;
    }

    setAddingAll(true);
    try {
      // Create a dedicated audio track for music
      const musicTrack = studio.addTrack({
        type: 'Audio',
        name: 'Music',
      });

      let offsetMicroseconds = 0;

      for (const track of doneTracks) {
        const proxyUrl = `/api/proxy/media?url=${encodeURIComponent(track.audio_url!)}`;
        const audioClip = await Audio.fromUrl(proxyUrl);
        audioClip.name = track.name;
        audioClip.volume = 1;

        // Position sequentially: each clip starts where the previous one ended
        audioClip.display.from = offsetMicroseconds;
        audioClip.display.to = offsetMicroseconds + audioClip.duration;

        await studio.addClip(audioClip, { trackId: musicTrack.id });

        offsetMicroseconds += audioClip.duration;
      }

      toast.success(
        `Added ${doneTracks.length} music track${doneTracks.length > 1 ? 's' : ''} sequentially to timeline`
      );
    } catch (error) {
      Log.error('Failed to add all music to timeline:', error);
      toast.error('Failed to add music to timeline');
    } finally {
      setAddingAll(false);
    }
  }, [studio, tracks]);

  const handleDelete = useCallback(async (trackId: string) => {
    try {
      const res = await fetch(`/api/v2/music/${trackId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setTracks((prev) => prev.filter((t) => t.id !== trackId));
        toast.success('Music track deleted');
      } else {
        toast.error('Failed to delete track');
      }
    } catch {
      toast.error('Failed to delete track');
    }
  }, []);

  if (!projectId) return null;

  const doneCount = tracks.filter((t) => t.status === 'done').length;
  const generatingCount = tracks.filter(
    (t) => t.status === 'generating'
  ).length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md bg-muted/15 border border-border/30 text-left hover:bg-muted/25 transition-colors"
        >
          <IconMusic className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium flex-1">Music</span>
          {generatingCount > 0 && (
            <span className="text-[9px] text-amber-400 animate-pulse">
              Generating {generatingCount}
            </span>
          )}
          <span className="text-[9px] text-muted-foreground/60">
            {tracks.length}
          </span>
          {isOpen ? (
            <IconChevronUp className="size-3 text-muted-foreground" />
          ) : (
            <IconChevronDown className="size-3 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-1 px-2 py-2 rounded-md bg-muted/10 border border-border/20 space-y-1.5">
          {doneCount >= 2 && (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={handleAddAllToTimeline}
                disabled={addingAll}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                title="Add all music tracks sequentially to timeline"
              >
                {addingAll ? (
                  <IconLoader2 className="size-3 animate-spin" />
                ) : (
                  <IconPlaylistAdd className="size-3.5" />
                )}
                Add All
              </button>
            </div>
          )}
          {loading && tracks.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/70 animate-pulse py-2">
              Loading music tracks...
            </p>
          ) : tracks.length === 0 ? null : (
            tracks.map((track) => (
              <MusicTrackCard
                key={track.id}
                track={track}
                onAddToTimeline={handleAddToTimeline}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
