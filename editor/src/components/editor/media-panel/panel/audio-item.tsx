import { Button } from '@/components/ui/button';
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { useRef, useState, useEffect } from 'react';
import type { Asset } from '@/types/media';

interface AudioItemProps {
  item: Asset;
  onAdd: (url: string, name: string) => void;
  onDelete?: () => void;
  playingId: string | null;
  setPlayingId: (id: string | null) => void;
}

export const AudioItem = ({
  item,
  onAdd,
  onDelete,
  playingId,
  setPlayingId,
}: AudioItemProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState<string>('--:--');
  const isPlaying = playingId === item.id;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.play();
    } else {
      audio.pause();
      audio.currentTime = 0;
    }

    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, [isPlaying]);

  const togglePlay = () => {
    if (isPlaying) {
      setPlayingId(null);
    } else {
      setPlayingId(item.id);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      const seconds = Math.round(audioRef.current.duration);
      const min = Math.floor(seconds / 60);
      const sec = seconds % 60;
      setDuration(`${min}:${sec.toString().padStart(2, '0')}`);
    }
  };

  return (
    <div className="group relative flex items-center gap-3 p-2 bg-secondary rounded-sm border hover:border-white/10 transition-colors">
      <audio
        ref={audioRef}
        src={item.url}
        onEnded={() => setPlayingId(null)}
        onLoadedMetadata={handleLoadedMetadata}
        className="hidden"
      />

      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 shrink-0"
        onClick={togglePlay}
      >
        {isPlaying ? (
          <IconPlayerPause className="size-4 fill-current" />
        ) : (
          <IconPlayerPlay className="size-4 fill-current ml-0.5" />
        )}
      </Button>

      <div
        onClick={() => onAdd(item.url, item.name)}
        className="flex flex-col min-w-0 flex-1 cursor-pointer"
      >
        <span className="text-xs font-medium truncate mb-0.5 text-zinc-300">
          {item.name}
        </span>
        <span className="text-[10px] text-muted-foreground">{duration}</span>
      </div>

      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {onDelete && (
          <Button
            size="icon"
            variant="ghost"
            className="size-5.5 cursor-pointer rounded-full hover:bg-red-500/80"
            onClick={onDelete}
          >
            <IconTrash className="size-3.5" />
          </Button>
        )}
        <Button
          size="icon"
          className="size-5.5 cursor-pointer rounded-full"
          onClick={() => onAdd(item.url, item.name)}
        >
          <IconPlus className="size-4" />
        </Button>
      </div>
    </div>
  );
};
