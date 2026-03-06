import type { IClip } from 'openvideo';
import { IconVolume } from '@tabler/icons-react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Slider } from '@/components/ui/slider';

interface EffectPropertiesProps {
  clip: IClip;
}

export function EffectProperties({ clip }: EffectPropertiesProps) {
  const _effectClip = clip as any;

  const handleUpdate = (_updates: any) => {
    // audioClip.update(updates);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Volume Section */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Duration
        </span>
        <div className="flex items-center gap-4">
          <IconVolume className="size-4 text-muted-foreground" />
          <Slider
            value={[50]}
            onValueChange={(v) => handleUpdate({ volume: v[0] / 100 })}
            max={100}
            step={1}
            className="flex-1"
          />
          <InputGroup className="w-20">
            <InputGroupInput
              type="number"
              value={50}
              onChange={(e) =>
                handleUpdate({
                  volume: (parseInt(e.target.value, 10) || 0) / 100,
                })
              }
              className="text-sm p-0 text-center"
            />
            <InputGroupAddon align="inline-end" className="p-0 pr-2">
              <span className="text-[10px] text-muted-foreground">s</span>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </div>
    </div>
  );
}
