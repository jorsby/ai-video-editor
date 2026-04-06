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
import { Button } from '@/components/ui/button';
import {
  IconChevronDown,
  IconChevronRight,
  IconLoader2,
  IconMusic,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconPlaylistAdd,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { toast } from 'sonner';

interface MusicTrack {
  id: string;
  project_id: string;
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
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
    <div className="flex items-center gap-2 px-2.5 py-2 rounded-md border border-border/30 bg-muted/10 hover:bg-muted/20 transition-colors group">
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
          {isFailed && <span className="text-[9px] text-red-400">Failed</span>}
        </div>
        {track.style && (
          <p className="text-[9px] text-muted-foreground/60 truncate">
            {track.style}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
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
          onClick={() => onDelete(track.id)}
          className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
          title="Delete"
        >
          <IconTrash className="size-3" />
        </button>
      </div>
    </div>
  );
}

export function ProjectMusicSection({
  projectId,
}: {
  projectId: string | null;
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
      const res = await fetch(`/api/v2/projects/${projectId}/music`);
      if (res.ok) {
        const data = await res.json();
        setTracks(data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchTracks();
  }, [fetchTracks]);

  // Realtime subscription for project_music changes
  useEffect(() => {
    if (!projectId) return;

    const supabase = createClient('studio');
    const channel = supabase
      .channel(`project-music-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'project_music',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          void fetchTracks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, fetchTracks]);

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
      <div className="flex items-center gap-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex-1 flex items-center gap-2 px-1 py-1 rounded-sm hover:bg-muted/20 transition-colors text-left"
          >
            {isOpen ? (
              <IconChevronDown className="size-3.5 text-muted-foreground" />
            ) : (
              <IconChevronRight className="size-3.5 text-muted-foreground" />
            )}
            <IconMusic className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Music</span>
            <span className="text-[10px] text-muted-foreground">
              ({tracks.length})
            </span>
            {generatingCount > 0 && (
              <span className="text-[9px] text-amber-400 animate-pulse">
                Generating {generatingCount}
              </span>
            )}
          </button>
        </CollapsibleTrigger>

        {doneCount >= 2 && (
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
        )}
      </div>

      <CollapsibleContent>
        <div className="pl-5 pr-1 space-y-1.5 pt-1">
          {loading && tracks.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/70 animate-pulse py-2">
              Loading music tracks...
            </p>
          ) : tracks.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/70 py-2">
              No music tracks yet. Generate via API or Video Showrunner.
            </p>
          ) : (
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
