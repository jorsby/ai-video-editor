'use client';
import { useEffect, useRef } from 'react';
import { CircleOff, XIcon } from 'lucide-react';
import useLayoutStore from '../store/use-layout-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ICaptionsControlProps } from '../interface/captions';
import { STYLE_CAPTION_PRESETS, NONE_PRESET } from '../constant/caption';

import { useStudioStore } from '@/stores/studio-store';
import { fontManager } from 'openvideo';
import { regenerateCaptionClips } from '@/lib/caption-utils';

const CSSPresetPreview = ({ preset }: { preset: ICaptionsControlProps }) => {
  const textShadowParts: string[] = [];

  if (preset.boxShadow) {
    textShadowParts.push(
      `${preset.boxShadow.x}px ${preset.boxShadow.y}px ${preset.boxShadow.blur}px ${preset.boxShadow.color}`
    );
  }

  if (preset.borderWidth > 0 && preset.borderColor !== 'transparent') {
    const w = Math.min(preset.borderWidth, 4);
    const offsets = [
      [-w, 0],
      [w, 0],
      [0, -w],
      [0, w],
      [-w, -w],
      [w, -w],
      [-w, w],
      [w, w],
    ];
    for (const [dx, dy] of offsets) {
      textShadowParts.push(`${dx}px ${dy}px 0 ${preset.borderColor}`);
    }
  }

  return (
    <div
      className="flex items-center justify-center w-full h-full rounded-lg px-2"
      style={{
        backgroundColor:
          preset.backgroundColor && preset.backgroundColor !== 'transparent'
            ? preset.backgroundColor
            : '#27272a',
      }}
    >
      <span
        style={{
          color: preset.activeColor,
          fontFamily: preset.fontFamily || 'Bangers-Regular, sans-serif',
          fontSize: '18px',
          fontWeight: 700,
          textTransform:
            (preset.textTransform as React.CSSProperties['textTransform']) ||
            'none',
          textShadow:
            textShadowParts.length > 0 ? textShadowParts.join(', ') : 'none',
          letterSpacing: '0.5px',
        }}
      >
        {preset.name || 'Sample'}
      </span>
    </div>
  );
};

const CaptionPresetPicker = () => {
  const { setFloatingControl } = useLayoutStore();
  const { studio, selectedClips } = useStudioStore();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setFloatingControl('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [setFloatingControl]);

  // Preload fonts for CSS-previewed presets
  useEffect(() => {
    const fontsToLoad = STYLE_CAPTION_PRESETS.filter(
      (p) => !p.previewUrl && p.fontFamily && p.fontUrl
    );
    for (const preset of fontsToLoad) {
      fontManager.addFont({
        name: preset.fontFamily!,
        url: preset.fontUrl!,
      });
    }
  }, []);

  const handleApplyPreset = async (preset: ICaptionsControlProps) => {
    if (!studio) return;

    // Filter for Captions
    const captionClips = selectedClips.filter((c) => c.type === 'Caption');
    if (captionClips.length === 0) return;
    if (preset.fontFamily === undefined) {
      preset.fontFamily = 'Bangers-Regular';
    }
    if (preset.fontUrl === undefined) {
      preset.fontUrl =
        'https://fonts.gstatic.com/s/bangers/v13/FeVQS0BTqb0h60ACL5la2bxii28.ttf';
    }

    try {
      // Load fonts if needed
      if (preset.fontFamily && preset.fontUrl) {
        await fontManager.addFont({
          name: preset.fontFamily,
          url: preset.fontUrl,
        });
      }
      const x = preset.boxShadow?.x ?? 4;
      const y = preset.boxShadow?.y ?? 0;

      // Map ICaptionsControlProps to ICaptionOpts
      const styleUpdate: any = {
        fill: preset.color,
        strokeWidth: preset.borderWidth,
        stroke: preset.borderColor,
        fontFamily: preset.fontFamily,
        fontUrl: preset.fontUrl,
        align: preset.textAlign as any,
        caption: {
          colors: {
            appeared: preset.appearedColor,
            active: preset.activeColor,
            activeFill: preset.activeFillColor,
            background: preset.backgroundColor,
            keyword: preset.isKeywordColor ?? 'transparent',
          },
          preserveKeywordColor: preset.preservedColorKeyWord ?? false,
        },
        animation: preset.animation || 'undefined',
        textCase: preset.textTransform || 'normal',
        dropShadow: {
          color: preset.boxShadow?.color ?? 'transparent',
          alpha: 0.5,
          blur: preset.boxShadow?.blur ?? 4,
          distance: Math.sqrt(x * x + y * y) ?? 4,
          angle: Math.PI / 4,
        },
      };

      // Deduplicate by mediaId so each group is only processed once
      const processedMediaIds = new Set<string>();
      const allCaptionClips = studio.clips.filter((c) => c.type === 'Caption');
      const mode = preset.type === 'word' ? 'single' : 'multiple';

      for (const clip of allCaptionClips) {
        const clipMediaId = (clip as any).mediaId;
        if (clipMediaId && processedMediaIds.has(clipMediaId)) continue;
        if (clipMediaId) processedMediaIds.add(clipMediaId);

        // Skip clips without a mediaId (e.g. orphaned clips)
        if (!clipMediaId) continue;

        await regenerateCaptionClips({
          studio,
          captionClip: clip,
          mode,
          fontSize: (clip as any).originalOpts?.fontSize,
          fontFamily: preset.fontFamily,
          fontUrl: preset.fontUrl,
          styleUpdate: styleUpdate,
        });
      }
    } catch (err) {
      console.error('Failed to apply caption preset:', err);
    }
  };

  const PresetGrid = ({ presets }: { presets: ICaptionsControlProps[] }) => (
    <div className="grid gap-2 p-4">
      <div
        className="flex h-[70px] cursor-pointer items-center justify-center bg-zinc-800 rounded-lg"
        onClick={() => {
          handleApplyPreset(NONE_PRESET);
        }}
      >
        <CircleOff />
      </div>

      {presets.map((preset, index) => (
        <div
          key={index}
          className="flex flex-col cursor-pointer"
          onClick={() => handleApplyPreset(preset)}
        >
          <div className="text-md flex h-[70px] items-center justify-center bg-zinc-800 overflow-hidden rounded-lg">
            {preset.previewUrl ? (
              <video
                src={preset.previewUrl}
                autoPlay
                loop
                muted
                playsInline
                className="h-40 place-content-center rounded-lg"
              />
            ) : (
              <CSSPresetPreview preset={preset} />
            )}
          </div>
          {preset.name && (
            <span className="text-[10px] text-muted-foreground text-center mt-1">
              {preset.name}
            </span>
          )}
        </div>
      ))}
    </div>
  );
  return (
    <div
      ref={containerRef}
      className="absolute left-full top-0 z-200 ml-2 w-72 border bg-background p-0"
    >
      <div className="handle flex  items-center justify-between px-4 py-3 pb-0">
        <p className="text-sm font-bold">Presets</p>
        <div className="h-4 w-4" onClick={() => setFloatingControl('')}>
          <XIcon className="h-3 w-3 cursor-pointer font-extrabold text-muted-foreground" />
        </div>
      </div>
      <ScrollArea className="h-[500px] w-full">
        <PresetGrid presets={STYLE_CAPTION_PRESETS} />
      </ScrollArea>
    </div>
  );
};

export default CaptionPresetPicker;
