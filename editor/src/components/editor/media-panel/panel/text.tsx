'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useStudioStore } from '@/stores/studio-store';
import { Text, Log, fontManager, type IClip } from 'openvideo';
import { useTextPresets } from '@/hooks/use-text-presets';
import type { SavedTextPreset } from '@/types/text-presets';
import { IconTrash } from '@tabler/icons-react';
import { Loader2, RefreshCw, Trash2, Sparkles } from 'lucide-react';
import { useLanguageStore } from '@/stores/language-store';
import { useProjectId } from '@/contexts/project-context';
import {
  generateHookTextConfig,
  calculateHookDuration,
  HOOK_CLIP_NAME,
} from '@/lib/hook-generator';

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

const HOOK_PRESETS = [
  // 0 — MrBeast: THE viral standard (Bangers, white, heavy outline)
  {
    name: 'MrBeast',
    style: {
      fontSize: 90,
      fontFamily: 'Bangers-Regular',
      fontWeight: 'normal',
      fill: '#ffffff',
      textCase: 'uppercase' as const,
      stroke: { color: '#000000', width: 8, join: 'round' },
      dropShadow: { color: '#000000', alpha: 0.7, blur: 6, angle: Math.PI / 4, distance: 3 },
      fontUrl: 'https://fonts.gstatic.com/s/bangers/v13/FeVQS0BTqb0h60ACL5la2bxii28.ttf',
    },
  },
  // 1 — Hormozi: Business/authority (Montserrat, gold, heavy outline)
  {
    name: 'Hormozi',
    style: {
      fontSize: 88,
      fontFamily: 'Montserrat',
      fontWeight: '800',
      fill: '#FFD700',
      textCase: 'uppercase' as const,
      stroke: { color: '#000000', width: 8, join: 'round' },
      dropShadow: { color: '#000000', alpha: 0.6, blur: 6, angle: Math.PI / 4, distance: 3 },
      fontUrl: 'https://fonts.gstatic.com/s/montserrat/v18/JTURjIg1_i6t8kCHKm45_c5H7g7J_950vCo.ttf',
    },
  },
  // 2 — Clean White: CapCut default, most versatile
  {
    name: 'Clean White',
    style: {
      fontSize: 85,
      fontFamily: 'Montserrat',
      fontWeight: '800',
      fill: '#ffffff',
      textCase: 'uppercase' as const,
      stroke: { color: '#000000', width: 7, join: 'round' },
      fontUrl: 'https://fonts.gstatic.com/s/montserrat/v18/JTURjIg1_i6t8kCHKm45_c5H7g7J_950vCo.ttf',
    },
  },
  // 3 — Heavy Outline: Gym/motivation, ultra-legible condensed
  {
    name: 'Heavy Outline',
    style: {
      fontSize: 90,
      fontFamily: 'Oswald',
      fontWeight: '700',
      fill: '#ffffff',
      textCase: 'uppercase' as const,
      stroke: { color: '#000000', width: 10, join: 'round' },
    },
  },
  // 4 — Ali Abdaal: Educational/professional (white on video, soft shadow)
  {
    name: 'Ali Abdaal',
    style: {
      fontSize: 82,
      fontFamily: 'Poppins',
      fontWeight: '600',
      fill: '#ffffff',
      textCase: 'uppercase' as const,
      stroke: { color: '#000000', width: 5, join: 'round' },
      dropShadow: { color: '#000000', alpha: 0.5, blur: 10, angle: Math.PI / 2, distance: 3 },
      fontUrl: 'https://fonts.gstatic.com/s/poppins/v15/pxiByp8kv8JHgFVrLCz7V1tvFP-KUEg.ttf',
    },
  },
  // 5 — Breaking: News/drama urgency (white text, red stroke)
  {
    name: 'Breaking',
    style: {
      fontSize: 88,
      fontFamily: 'Roboto',
      fontWeight: '900',
      fill: '#ffffff',
      textCase: 'uppercase' as const,
      stroke: { color: '#CC0000', width: 8, join: 'round' },
      fontUrl: 'https://fonts.gstatic.com/s/roboto/v29/KFOlCnqEu92Fr1MmYUtvAx05IsDqlA.ttf',
    },
  },
  // 6 — Neon Green: Gaming/tech/hacker
  {
    name: 'Neon Green',
    style: {
      fontSize: 85,
      fontFamily: 'Inter',
      fontWeight: 'bold',
      fill: '#39FF14',
      textCase: 'uppercase' as const,
      stroke: { color: '#000000', width: 6, join: 'round' },
      dropShadow: { color: '#39FF14', alpha: 0.7, blur: 12, angle: 0, distance: 0 },
    },
  },
  // 7 — Fire: Warm/motivation (orange, heavy outline)
  {
    name: 'Fire',
    style: {
      fontSize: 88,
      fontFamily: 'Montserrat',
      fontWeight: '900',
      fill: '#FF4D00',
      textCase: 'uppercase' as const,
      stroke: { color: '#000000', width: 8, join: 'round' },
      fontUrl: 'https://fonts.gstatic.com/s/montserrat/v18/JTURjIg1_i6t8kCHKm45_c5H7g7J_950vCo.ttf',
    },
  },
  // 8 — Cinematic: Documentary/luxury (warm serif, soft shadow)
  {
    name: 'Cinematic',
    style: {
      fontSize: 80,
      fontFamily: 'Playfair Display',
      fontWeight: '700',
      fill: '#F5E6CC',
      textCase: 'uppercase' as const,
      stroke: { color: '#000000', width: 6, join: 'round' },
      dropShadow: { color: '#000000', alpha: 0.7, blur: 10, angle: Math.PI / 4, distance: 4 },
    },
  },
  // 9 — Electric Pop: Tech/finance/gaming (green, heavy outline)
  {
    name: 'Electric Pop',
    style: {
      fontSize: 88,
      fontFamily: 'Montserrat',
      fontWeight: '900',
      fill: '#00FF88',
      textCase: 'uppercase' as const,
      stroke: { color: '#000000', width: 8, join: 'round' },
      fontUrl: 'https://fonts.gstatic.com/s/montserrat/v18/JTURjIg1_i6t8kCHKm45_c5H7g7J_950vCo.ttf',
    },
  },
  // 10 — Sky Blue: Educational/trust
  {
    name: 'Sky Blue',
    style: {
      fontSize: 85,
      fontFamily: 'Montserrat',
      fontWeight: '800',
      fill: '#00BFFF',
      textCase: 'uppercase' as const,
      stroke: { color: '#000000', width: 7, join: 'round' },
      fontUrl: 'https://fonts.gstatic.com/s/montserrat/v18/JTURjIg1_i6t8kCHKm45_c5H7g7J_950vCo.ttf',
    },
  },
  // 11 — Sunset: Travel/food/warm energy
  {
    name: 'Sunset',
    style: {
      fontSize: 85,
      fontFamily: 'Montserrat',
      fontWeight: '800',
      fill: '#FF6B35',
      textCase: 'uppercase' as const,
      stroke: { color: '#000000', width: 6, join: 'round' },
      dropShadow: { color: '#FF6B35', alpha: 0.5, blur: 8, angle: 0, distance: 0 },
      fontUrl: 'https://fonts.gstatic.com/s/montserrat/v18/JTURjIg1_i6t8kCHKm45_c5H7g7J_950vCo.ttf',
    },
  },
];

interface HookPresetAnimation {
  name: string;
  opts: {
    duration: number;
    delay?: number;
    easing?: string;
    iterCount?: number;
  };
  params?: any;
}

const HOOK_ANIMATIONS: { name: string; animation: HookPresetAnimation | null }[] = [
  { name: 'None', animation: null },
  { name: 'Pop In', animation: { name: 'wobbleZoomIn', opts: { duration: 400_000 } } },
  { name: 'Slam Down', animation: { name: 'dropBlurIn', opts: { duration: 350_000 } } },
  { name: 'Typewriter', animation: { name: 'charTypewriter', opts: { duration: 500_000 } } },
  { name: 'Slide Up', animation: { name: 'slideIn', opts: { duration: 400_000 }, params: { direction: 'bottom' } } },
  { name: 'Word Reveal', animation: { name: 'wordFadeIn', opts: { duration: 600_000 } } },
  { name: 'Glitch In', animation: { name: 'glitchSlideIn', opts: { duration: 500_000 } } },
  { name: 'Cinematic Zoom', animation: { name: 'zoomBlurIn', opts: { duration: 450_000 } } },
  { name: 'Flash Zoom', animation: { name: 'flashZoomIn', opts: { duration: 350_000 } } },
  { name: 'Snap In', animation: { name: 'zoomIn', opts: { duration: 300_000, easing: 'easeOutCubic' } } },
  { name: 'Char Fade', animation: { name: 'charFadeIn', opts: { duration: 600_000 } } },
];

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const hh = h > 0 ? `${h.toString().padStart(2, '0')}:` : '';
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');

  return `${hh}${mm}:${ss}`;
}

export default function PanelText() {
  const { studio } = useStudioStore();
  const { savedPresets, removePreset } = useTextPresets();
  const { activeLanguage } = useLanguageStore();
  const projectId = useProjectId();

  const [hookClip, setHookClip] = useState<IClip | null>(null);
  const [isGeneratingHook, setIsGeneratingHook] = useState(false);
  const [mediaItems, setMediaItems] = useState<IClip[]>([]);
  const [selectedStyleIdx, setSelectedStyleIdx] = useState<number>(0);
  const [selectedAnimIdx, setSelectedAnimIdx] = useState<number>(0); // 0 = None

  // Track clips: media items and existing hook
  useEffect(() => {
    if (!studio) return;

    const scanClips = () => {
      const tracks = studio.getTracks();
      const allClips: IClip[] = [];
      tracks.forEach((track: any) => {
        track.clipIds.forEach((id: string) => {
          const clip = studio.getClipById(id);
          if (clip) allClips.push(clip);
        });
      });

      const media = allClips.filter(
        (clip: IClip) => clip.type === 'Video' || clip.type === 'Audio'
      );
      setMediaItems(media);

      // Find hook across ALL clip types (backward compat with Caption hooks)
      const hook = allClips.find(
        (clip: IClip) => (clip as any).name === HOOK_CLIP_NAME
      );
      setHookClip(hook || null);
    };

    scanClips();

    const handleUpdate = () => scanClips();
    studio.on('clip:added', handleUpdate);
    studio.on('clip:removed', handleUpdate);
    studio.on('clip:updated', handleUpdate);

    return () => {
      studio.off('clip:added', handleUpdate);
      studio.off('clip:removed', handleUpdate);
      studio.off('clip:updated', handleUpdate);
    };
  }, [studio]);

  const handleGenerateHook = async (
    presetStyle?: (typeof HOOK_PRESETS)[0]['style'],
    presetAnimation?: HookPresetAnimation,
  ) => {
    if (!studio || mediaItems.length === 0) return;

    setIsGeneratingHook(true);
    try {
      const isRTL = activeLanguage === 'ar';
      const fontName = isRTL ? 'Cairo' : 'Montserrat';
      const fontUrl = isRTL
        ? 'https://fonts.gstatic.com/s/cairo/v28/SLXgc1nY6HkvangtZmpcWmhzfH5lWWgcQyyS4J0.ttf'
        : 'https://fonts.gstatic.com/s/montserrat/v18/JTURjIg1_i6t8kCHKm45_c5H7g7J_950vCo.ttf';

      await fontManager.addFont({ name: fontName, url: fontUrl });

      // Also load preset font if different from default
      const presetFontUrl = (presetStyle as any)?.fontUrl;
      if (presetFontUrl && presetStyle?.fontFamily && presetStyle.fontFamily !== fontName) {
        await fontManager.addFont({ name: presetStyle.fontFamily, url: presetFontUrl });
      }

      const res = await fetch('/api/generate-hook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          language: activeLanguage === 'auto' ? 'en' : activeLanguage,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate hook');
      }

      const { line1, line2, line3 } = await res.json();
      const hookText = `${line1}\n${line2}\n${line3}`;

      const config = generateHookTextConfig({
        videoWidth: (studio as any).opts.width,
        videoHeight: (studio as any).opts.height,
        hookText,
        durationUs: calculateHookDuration(hookText),
        fontFamily: presetStyle?.fontFamily ?? fontName,
        fontUrl: presetStyle ? undefined : fontUrl,
        isRTL,
      });

      // Override with preset style if provided
      const textOpts = presetStyle
        ? { ...config.textOpts, ...presetStyle }
        : config.textOpts;

      const textClip = new Text(config.content, textOpts as any);
      textClip.name = HOOK_CLIP_NAME;
      await textClip.ready;

      textClip.display.from = 0;
      textClip.duration = config.clipProps.durationUs;
      textClip.display.to = config.clipProps.durationUs;
      textClip.left = config.clipProps.left;
      textClip.top = config.clipProps.top;
      textClip.zIndex = config.clipProps.zIndex;

      // Apply animation if provided
      if (presetAnimation) {
        const { name, opts, params } = presetAnimation;
        const resolvedOpts =
          opts.iterCount === Infinity
            ? { ...opts, duration: textClip.duration }
            : opts;
        (textClip as any).addAnimation(name, resolvedOpts, params);
      }

      // Remove existing hook if any
      if (hookClip) {
        studio.removeClipById(hookClip.id);
      }

      await studio.addClip(textClip);
    } catch (error) {
      Log.error('Failed to generate hook:', error);
    } finally {
      setIsGeneratingHook(false);
    }
  };

  const handleDeleteHook = () => {
    if (!studio || !hookClip) return;
    studio.removeClipById(hookClip.id);
  };

  const handleApplyHookStyle = async (styleIdx: number) => {
    const preset = HOOK_PRESETS[styleIdx];
    const fontUrl = (preset.style as any).fontUrl;
    if (fontUrl && preset.style.fontFamily) {
      await fontManager.addFont({ name: preset.style.fontFamily, url: fontUrl });
    }

    setSelectedStyleIdx(styleIdx);
    const anim = HOOK_ANIMATIONS[selectedAnimIdx].animation;

    if (!hookClip) {
      handleGenerateHook(preset.style, anim ?? undefined);
      return;
    }

    (hookClip as any).update({ style: { ...preset.style } });
    (hookClip as any).clearAnimations();
    if (anim) {
      const resolvedOpts = anim.opts.iterCount === Infinity
        ? { ...anim.opts, duration: hookClip.duration } : anim.opts;
      (hookClip as any).addAnimation(anim.name, resolvedOpts, anim.params);
    }
  };

  const handleApplyHookAnimation = (animIdx: number) => {
    setSelectedAnimIdx(animIdx);
    if (!hookClip) return;

    (hookClip as any).clearAnimations();
    const anim = HOOK_ANIMATIONS[animIdx].animation;
    if (anim) {
      const resolvedOpts = anim.opts.iterCount === Infinity
        ? { ...anim.opts, duration: hookClip.duration } : anim.opts;
      (hookClip as any).addAnimation(anim.name, resolvedOpts, anim.params);
    }
  };

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

  const hookText = hookClip ? (hookClip as any).text || '' : '';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Hook Section */}
      <div className="w-full flex flex-col gap-2 px-4 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Hook
          </span>
          {hookClip && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-muted-foreground hover:text-white"
                onClick={() => handleGenerateHook(
                  HOOK_PRESETS[selectedStyleIdx].style,
                  HOOK_ANIMATIONS[selectedAnimIdx].animation ?? undefined,
                )}
                disabled={isGeneratingHook || mediaItems.length === 0}
              >
                {isGeneratingHook ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3 w-3" />
                )}
                Regenerate
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-red-400"
                onClick={handleDeleteHook}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
        {hookClip ? (
          <>
            <div className="rounded-md border border-white/[0.08] bg-zinc-900/40 p-3">
              <p className="text-sm text-zinc-300 whitespace-pre-line leading-relaxed">
                {hookText}
              </p>
              <p className="mt-1.5 text-[10px] font-mono text-muted-foreground">
                {formatTime(0)} - {formatTime(hookClip.display.to / 1_000_000)}
              </p>
            </div>
            {/* Style presets */}
            <p className="text-[10px] text-zinc-500 mt-2 mb-1">Styles</p>
            <div className="grid grid-cols-4 gap-1.5">
              {HOOK_PRESETS.map((preset, i) => (
                <button
                  type="button"
                  key={preset.name}
                  onClick={() => handleApplyHookStyle(i)}
                  className={`px-2 py-1.5 text-[10px] rounded-md bg-zinc-800/60 border text-zinc-400 hover:text-white hover:bg-zinc-700/60 transition-colors truncate ${
                    selectedStyleIdx === i
                      ? 'border-blue-500 ring-1 ring-blue-500 text-white'
                      : 'border-white/[0.06]'
                  }`}
                  title={preset.name}
                >
                  {preset.name}
                </button>
              ))}
            </div>
            {/* Animation presets */}
            <p className="text-[10px] text-zinc-500 mt-2 mb-1">Animation</p>
            <div className="grid grid-cols-4 gap-1.5">
              {HOOK_ANIMATIONS.map((anim, i) => (
                <button
                  type="button"
                  key={anim.name}
                  onClick={() => handleApplyHookAnimation(i)}
                  className={`px-2 py-1.5 text-[10px] rounded-md bg-zinc-800/60 border text-zinc-400 hover:text-white hover:bg-zinc-700/60 transition-colors truncate ${
                    selectedAnimIdx === i
                      ? 'border-blue-500 ring-1 ring-blue-500 text-white'
                      : 'border-white/[0.06]'
                  }`}
                  title={anim.name}
                >
                  {anim.name}
                </button>
              ))}
            </div>
          </>
        ) : (
          <Button
            onClick={() => handleGenerateHook(
              HOOK_PRESETS[selectedStyleIdx].style,
              HOOK_ANIMATIONS[selectedAnimIdx].animation ?? undefined,
            )}
            variant="outline"
            size="sm"
            className="w-full"
            disabled={isGeneratingHook || mediaItems.length === 0}
          >
            {isGeneratingHook ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-3.5 w-3.5" />
                Generate Hook
              </>
            )}
          </Button>
        )}
      </div>

      {/* Separator */}
      <div className="mx-4 my-3 border-t border-white/[0.06]" />

      {/* Add Text button */}
      <div className="px-4">
        <Button onClick={() => handleAddText()} className="w-full h-9">
          Add Text
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 mt-3">
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
