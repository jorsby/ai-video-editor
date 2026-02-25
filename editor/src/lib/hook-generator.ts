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
    dropShadow: { color: string; alpha: number; blur: number; angle: number; distance: number };
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
  const wordCount = hookText.split(/\s+/).filter(Boolean).length;
  const seconds = Math.min(5, Math.max(3, 2 + wordCount * 0.3));
  return seconds * 1_000_000;
}

/**
 * Generate a Text clip configuration for the video hook (title card).
 * Returns a config object to be used with `new Text(config.content, config.textOpts)`.
 */
export function generateHookTextConfig(options: HookClipOptions): HookTextConfig {
  const {
    videoWidth,
    videoHeight,
    hookText,
    durationUs,
    fontSize = 70,
    isRTL = false,
  } = options;

  const fontFamily = options.fontFamily ?? (isRTL ? 'Cairo' : 'Bangers-Regular');
  const fontUrl = options.fontUrl ?? (isRTL
    ? 'https://fonts.gstatic.com/s/cairo/v28/SLXgc1nY6HkvangtZmpcWmhzfH5lWWgcQyyS4J0.ttf'
    : 'https://fonts.gstatic.com/s/poppins/v15/pxiByp8kv8JHgFVrLCz7V1tvFP-KUEg.ttf');

  const wordWrapWidth = videoWidth * 0.85;

  return {
    content: hookText,
    textOpts: {
      fontSize,
      fontFamily,
      fontWeight: '700',
      fill: '#ffffff',
      align: isRTL ? 'right' : 'center',
      wordWrap: true,
      wordWrapWidth,
      stroke: {
        color: '#000000',
        width: 5,
        join: 'round',
      },
      dropShadow: {
        color: '#000000',
        alpha: 0.6,
        blur: 6,
        angle: Math.PI / 4,
        distance: Math.sqrt(2 * 2 + 2 * 2),
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
