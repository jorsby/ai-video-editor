import { useState, useEffect, useRef } from 'react';
import type { IClip } from 'openvideo';
import { useStudioStore } from '@/stores/studio-store';
import {
  IconVolume,
  IconGauge,
  IconMusic,
  IconLoader2,
  IconRefresh,
} from '@tabler/icons-react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
// TODO: Re-implement voiceover clip helpers after storyboard cleanup
// biome-ignore lint/suspicious/noExplicitAny: stub
function getVoiceoverForClip(_clip: any): Promise<null> { return Promise.resolve(null); }
// biome-ignore lint/suspicious/noExplicitAny: stub
function regenerateVoiceover(..._args: any[]): { promise: Promise<{ success: boolean; error?: string }>; abort: () => void } {
  return { promise: Promise.resolve({ success: false, error: 'Not implemented' }), abort: () => {} };
}
interface Voiceover {
  id: string;
  scene_id: string;
  text: string | null;
  status: 'pending' | 'processing' | 'success' | 'failed';
  audio_url?: string | null;
  language: string;
  duration?: number | null;
}

interface AudioPropertiesProps {
  clip: IClip;
}

export function AudioProperties({ clip }: AudioPropertiesProps) {
  const audioClip = clip as any;
  const { studio } = useStudioStore();

  const [voiceover, setVoiceover] = useState<Voiceover | null>(null);
  const [voiceoverLoading, setVoiceoverLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);

  // Look up voiceover record when clip changes
  useEffect(() => {
    let cancelled = false;
    setVoiceover(null);
    setVoiceoverLoading(true);

    getVoiceoverForClip(clip).then((vo) => {
      if (!cancelled) {
        setVoiceover(vo);
        setVoiceoverLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [clip.src, clip.id]);

  // Cleanup abort handle on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.();
    };
  }, []);

  const handleRegenerate = async () => {
    if (!studio || !voiceover || isRegenerating) return;

    setIsRegenerating(true);
    toast.info('Voiceover regeneration started...');

    const { promise, abort } = regenerateVoiceover(studio, clip, voiceover);
    abortRef.current = abort;

    const result = await promise;
    abortRef.current = null;
    setIsRegenerating(false);

    if (result.success) {
      toast.success('Voiceover regenerated successfully');
    } else if (result.error !== 'Aborted') {
      toast.error(result.error || 'Voiceover regeneration failed');
    }
  };

  const handleUpdate = (updates: any) => {
    if ('playbackRate' in updates && studio && audioClip.trim) {
      const newRate = updates.playbackRate || 1;
      const newDuration = Math.round(
        (audioClip.trim.to - audioClip.trim.from) / newRate
      );
      studio.updateClip(audioClip.id, { ...updates, duration: newDuration });
    } else {
      audioClip.update(updates);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Voiceover Regeneration Section */}
      {voiceover && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Voiceover
          </span>
          {voiceover.text && (
            <p className="text-xs text-muted-foreground line-clamp-3">
              {voiceover.text}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleRegenerate}
            disabled={isRegenerating}
          >
            {isRegenerating ? (
              <IconLoader2 className="size-3.5 animate-spin mr-1.5" />
            ) : (
              <IconRefresh className="size-3.5 mr-1.5" />
            )}
            {isRegenerating ? 'Regenerating...' : 'Regenerate Voiceover'}
          </Button>
        </div>
      )}

      {/* Volume Section */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Volume
        </span>
        <div className="flex items-center gap-4">
          <IconVolume className="size-4 text-muted-foreground" />
          <Slider
            value={[Math.round((audioClip.volume ?? 1) * 100)]}
            onValueChange={(v) => handleUpdate({ volume: v[0] / 100 })}
            max={100}
            step={1}
            className="flex-1"
          />
          <InputGroup className="w-20">
            <InputGroupInput
              type="number"
              value={Math.round((audioClip.volume ?? 1) * 100)}
              onChange={(e) =>
                handleUpdate({
                  volume: (parseInt(e.target.value, 10) || 0) / 100,
                })
              }
              className="text-sm p-0 text-center"
            />
            <InputGroupAddon align="inline-end" className="p-0 pr-2">
              <span className="text-[10px] text-muted-foreground">%</span>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </div>

      {/* Pitch Section (UI Only) */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Pitch
        </span>
        <div className="flex items-center gap-4">
          <IconMusic className="size-4 text-muted-foreground" />
          <Slider
            value={[0]}
            onValueChange={() => {}}
            min={-12}
            max={12}
            step={1}
            className="flex-1"
            disabled
          />
          <InputGroup className="w-20">
            <InputGroupInput
              type="number"
              value={0}
              disabled
              className="text-sm p-0 text-center"
            />
            <InputGroupAddon align="inline-end" className="p-0 pr-2">
              <span className="text-[10px] text-muted-foreground">st</span>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </div>

      {/* Speed Section */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Speed
        </span>
        <div className="flex items-center gap-4">
          <IconGauge className="size-4 text-muted-foreground" />
          <Slider
            value={[Math.round((audioClip.playbackRate ?? 1) * 100)]}
            onValueChange={(v) => handleUpdate({ playbackRate: v[0] / 100 })}
            min={25}
            max={400}
            step={5}
            className="flex-1"
          />
          <InputGroup className="w-20">
            <InputGroupInput
              type="number"
              value={Math.round((audioClip.playbackRate ?? 1) * 100)}
              onChange={(e) =>
                handleUpdate({
                  playbackRate: (parseInt(e.target.value, 10) || 25) / 100,
                })
              }
              className="text-sm p-0 text-center"
            />
            <InputGroupAddon align="inline-end" className="p-0 pr-2">
              <span className="text-[10px] text-muted-foreground">%</span>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </div>
    </div>
  );
}
