'use client';

import { Button } from '@/components/ui/button';
import { useStudioStore } from '@/stores/studio-store';
import { Text, Log, fontManager } from 'openvideo';
import { useTextPresets } from '@/hooks/use-text-presets';
import type { SavedTextPreset } from '@/types/text-presets';
import { IconTrash } from '@tabler/icons-react';

const TEXT_PRESETS = [
  {
    name: 'Heading',
    description: 'Heading',
    style: {
      fontSize: 80,
      fontFamily: 'Inter',
      fontWeight: 'bold',
      fill: '#ffffff',
    },
  },
  {
    name: 'Body text',
    description: 'Body text',
    style: {
      fontSize: 40,
      fontFamily: 'Inter',
      fontWeight: 'normal',
      fill: '#ffffff',
    },
  },
  {
    name: 'Modern Bold',
    description: 'MODERN',
    style: {
      fontSize: 60,
      fontFamily: 'Montserrat',
      fontWeight: '900',
      fill: '#ffffff',
      stroke: { color: '#000000', width: 2, join: 'round' },
    },
  },
  {
    name: 'Elegant Serif',
    description: 'Serif Style',
    style: {
      fontSize: 60,
      fontFamily: 'Playfair Display',
      fontWeight: 'normal',
      fontStyle: 'italic',
      fill: '#ffffff',
    },
  },
  {
    name: 'Neon Glow',
    description: 'NEON',
    style: {
      fontSize: 60,
      fontFamily: 'Inter',
      fontWeight: 'bold',
      fill: '#00ffff',
      dropShadow: {
        color: '#00ffff',
        alpha: 0.8,
        blur: 10,
        angle: 0,
        distance: 0,
      },
    },
  },
  {
    name: 'Handwritten',
    description: 'Script',
    style: {
      fontSize: 70,
      fontFamily: 'Dancing Script',
      fontWeight: 'normal',
      fill: '#ffffff',
    },
  },
];

export default function PanelText() {
  const { studio } = useStudioStore();
  const { savedPresets, removePreset } = useTextPresets();

  const handleAddText = async (preset?: (typeof TEXT_PRESETS)[0]) => {
    if (!studio) return;

    try {
      const textClip = new Text(preset ? preset.description : 'Add Text pro', {
        fontSize: preset?.style.fontSize || 124,
        fontFamily: preset?.style.fontFamily || 'Arial',
        align: 'center',
        fontWeight: preset?.style.fontWeight || 'bold',
        fontStyle: (preset?.style as any)?.fontStyle || 'normal',
        fill: preset?.style.fill || '#ffffff',
        stroke: (preset?.style as any)?.stroke || undefined,
        dropShadow: (preset?.style as any)?.dropShadow || undefined,
        wordWrap: true,
        wordWrapWidth: 800,
        fontUrl: (preset?.style as any)?.fontUrl,
      });
      textClip.name = preset ? preset.name : 'Text';
      await textClip.ready;
      textClip.display.from = 0;
      textClip.duration = 5e6;
      textClip.display.to = 5e6;
      await studio.addClip(textClip);
    } catch (error) {
      Log.error('Failed to add text:', error);
    }
  };

  const handleAddTextFromSavedPreset = async (preset: SavedTextPreset) => {
    if (!studio) return;

    try {
      if (preset.style.fontUrl) {
        await fontManager.addFont({
          name: preset.style.fontFamily,
          url: preset.style.fontUrl,
        });
      }

      const textClip = new Text(preset.name, {
        fontSize: preset.style.fontSize,
        fontFamily: preset.style.fontFamily,
        fontWeight: preset.style.fontWeight,
        fontStyle: preset.style.fontStyle || 'normal',
        fill: preset.style.fill,
        align: preset.style.align || 'center',
        textCase: preset.style.textCase,
        letterSpacing: preset.style.letterSpacing,
        lineHeight: preset.style.lineHeight,
        wordWrap: preset.style.wordWrap ?? true,
        wordWrapWidth: preset.style.wordWrapWidth ?? 800,
        stroke: preset.style.stroke || undefined,
        dropShadow: preset.style.dropShadow || undefined,
        fontUrl: preset.style.fontUrl,
      });

      textClip.name = preset.name;
      await textClip.ready;

      const duration = preset.clipProperties.duration || 5e6;
      textClip.display.from = 0;
      textClip.duration = duration;
      textClip.display.to = duration;

      if (preset.clipProperties.opacity !== undefined) {
        textClip.opacity = preset.clipProperties.opacity;
      }
      if (preset.clipProperties.angle !== undefined) {
        textClip.angle = preset.clipProperties.angle;
      }
      if (preset.clipProperties.left !== undefined) {
        textClip.left = preset.clipProperties.left;
      }
      if (preset.clipProperties.top !== undefined) {
        textClip.top = preset.clipProperties.top;
      }
      if (preset.clipProperties.width !== undefined) {
        textClip.width = preset.clipProperties.width;
      }
      if (preset.clipProperties.height !== undefined) {
        textClip.height = preset.clipProperties.height;
      }

      await studio.addClip(textClip);
    } catch (error) {
      Log.error('Failed to add text from saved preset:', error);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4">
        <Button onClick={() => handleAddText()} className="w-full h-9">
          Add Text
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-4">
        {/* Built-in presets */}
        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
          Built-in
        </label>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-3 pb-4">
          {TEXT_PRESETS.map((preset, index) => (
            <button
              type="button"
              key={index}
              onClick={() => handleAddText(preset)}
              className="aspect-square bg-secondary/50 rounded-lg flex items-center justify-center p-4 hover:bg-secondary transition-colors group relative overflow-hidden border border-border"
            >
              <span
                style={{
                  fontFamily: preset.style.fontFamily,
                  fontSize: '12px',
                  fontWeight: preset.style.fontWeight,
                  color: preset.style.fill,
                  textAlign: 'center',
                }}
                className="line-clamp-2"
              >
                {preset.description}
              </span>
            </button>
          ))}
        </div>

        {/* Saved presets */}
        {savedPresets.length > 0 && (
          <>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
              My Presets
            </label>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-3 pb-4">
              {savedPresets.map((preset) => (
                <button
                  type="button"
                  key={preset.id}
                  onClick={() => handleAddTextFromSavedPreset(preset)}
                  className="aspect-square bg-secondary/50 rounded-lg flex items-center justify-center p-4 hover:bg-secondary transition-colors group relative overflow-hidden border border-border"
                >
                  <span
                    style={{
                      fontFamily: preset.style.fontFamily,
                      fontSize: '12px',
                      fontWeight: preset.style.fontWeight,
                      fontStyle: preset.style.fontStyle,
                      color: preset.style.fill,
                      textAlign: 'center',
                    }}
                    className="line-clamp-2"
                  >
                    {preset.name}
                  </span>
                  <div
                    className="absolute top-1 right-1 p-1 rounded-md bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePreset(preset.id);
                    }}
                  >
                    <IconTrash className="size-3" />
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
