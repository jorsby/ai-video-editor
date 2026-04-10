import type { ICaptionsControlProps } from '@/components/editor/interface/captions';

export const HOOK_CLIP_NAME = '__video_hook__';

interface HookClipOptions {
  videoWidth: number;
  videoHeight: number;
  hookText: string;
  durationUs: number;
  fontFamily?: string;
  fontUrl?: string;
  fontSize?: number;
  isRTL?: boolean;
}

export interface HookTextConfig {
  content: string;
  textOpts: {
    fontSize: number;
    fontFamily: string;
    fontWeight: string;
    fill: string;
    align: string;
    wordWrap: boolean;
    wordWrapWidth: number;
    stroke: { color: string; width: number; join: string };
    dropShadow: {
      color: string;
      alpha: number;
      blur: number;
      angle: number;
      distance: number;
    };
    fontUrl: string;
  };
  clipProps: {
    left: number;
    top: number;
    zIndex: number;
    durationUs: number;
  };
}

/**
 * Calculate how long the hook should display based on word count.
 * Returns duration in microseconds.
 */
export function calculateHookDuration(hookText: string): number {
  return 3 * 1_000_000;
}

/**
 * Generate a Text clip configuration for the video hook (title card).
 * Returns a config object to be used with `new Text(config.content, config.textOpts)`.
 */
export function generateHookTextConfig(
  options: HookClipOptions
): HookTextConfig {
  const {
    videoWidth,
    videoHeight,
    hookText,
    durationUs,
    fontSize = 85,
    isRTL = false,
  } = options;

  const fontFamily = options.fontFamily ?? (isRTL ? 'Cairo' : 'Montserrat');
  const fontUrl =
    options.fontUrl ??
    (isRTL
      ? 'https://fonts.gstatic.com/s/cairo/v28/SLXgc1nY6HkvangtZmpcWmhzfH5lWWgcQyyS4J0.ttf'
      : 'https://fonts.gstatic.com/s/montserrat/v18/JTURjIg1_i6t8kCHKm45_c5H7g7J_950vCo.ttf');

  const wordWrapWidth = videoWidth * 0.85;

  return {
    content: hookText,
    textOpts: {
      fontSize,
      fontFamily,
      fontWeight: '800',
      fill: '#ffffff',
      align: isRTL ? 'right' : 'center',
      wordWrap: true,
      wordWrapWidth,
      stroke: {
        color: '#000000',
        width: 7,
        join: 'round',
      },
      dropShadow: {
        color: '#000000',
        alpha: 0.6,
        blur: 6,
        angle: Math.PI / 4,
        distance: 3,
      },
      fontUrl,
    },
    clipProps: {
      left: (videoWidth - wordWrapWidth) / 2,
      top: videoHeight * 0.35,
      zIndex: 15,
      durationUs,
    },
  };
}

/**
 * Render hook text as a transparent PNG using Canvas API,
 * styled with a caption preset. Used for FFmpeg overlay on shorts.
 */
export async function renderHookOverlayPng(options: {
  hookLines: { line1: string; line2: string; line3: string };
  preset: ICaptionsControlProps;
  videoWidth: number;
  videoHeight: number;
}): Promise<Blob> {
  const { hookLines, preset, videoWidth, videoHeight } = options;

  const canvas = document.createElement('canvas');
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  const ctx = canvas.getContext('2d')!;

  // Load custom font if preset specifies one
  const fontFamily = preset.fontFamily || 'Montserrat';
  const fontUrl =
    preset.fontUrl ||
    'https://fonts.gstatic.com/s/montserrat/v18/JTURjIg1_i6t8kCHKm45_c5H7g7J_950vCo.ttf';

  try {
    const face = new FontFace(fontFamily, `url(${fontUrl})`);
    const loaded = await face.load();
    document.fonts.add(loaded);
  } catch {
    // Fall back to system font if loading fails
  }

  const fontSize = Math.round(videoWidth * 0.065);
  const lineSpacing = fontSize * 1.6;

  // Build lines array, apply textTransform
  let lines = [hookLines.line1, hookLines.line2, hookLines.line3].filter(
    Boolean
  );
  if (preset.textTransform === 'uppercase') {
    lines = lines.map((l) => l.toUpperCase());
  } else if (preset.textTransform === 'lowercase') {
    lines = lines.map((l) => l.toLowerCase());
  }

  const fontSpec = `800 ${fontSize}px "${fontFamily}", sans-serif`;
  ctx.font = fontSpec;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const totalHeight = lines.length * lineSpacing;
  const startY = videoHeight * 0.35 - totalHeight / 2 + lineSpacing / 2;
  const centerX = videoWidth / 2;

  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineSpacing;
    const text = lines[i];

    // Background box behind text
    if (preset.backgroundColor && preset.backgroundColor !== 'transparent') {
      const metrics = ctx.measureText(text);
      const padX = fontSize * 0.4;
      const padY = fontSize * 0.25;
      const boxW = metrics.width + padX * 2;
      const boxH = lineSpacing * 0.85;
      ctx.fillStyle = preset.backgroundColor;
      ctx.beginPath();
      ctx.roundRect(centerX - boxW / 2, y - boxH / 2, boxW, boxH, 6);
      ctx.fill();
    }

    // Drop shadow
    if (preset.boxShadow && preset.boxShadow.color !== 'transparent') {
      ctx.shadowColor = preset.boxShadow.color;
      ctx.shadowBlur = preset.boxShadow.blur;
      ctx.shadowOffsetX = preset.boxShadow.x;
      ctx.shadowOffsetY = preset.boxShadow.y;
    }

    // Stroke (border)
    if (
      preset.borderWidth > 0 &&
      preset.borderColor &&
      preset.borderColor !== 'transparent'
    ) {
      ctx.strokeStyle = preset.borderColor;
      ctx.lineWidth = preset.borderWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, centerX, y);
    }

    // Fill text with activeColor (hook text is all "active")
    ctx.fillStyle = preset.activeColor || '#ffffff';
    ctx.fillText(text, centerX, y);

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to render hook PNG'));
      },
      'image/png'
    );
  });
}
