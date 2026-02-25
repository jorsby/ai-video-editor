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
  return 3 * 1_000_000;
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
    fontSize = 85,
    isRTL = false,
  } = options;

  const fontFamily = options.fontFamily ?? (isRTL ? 'Cairo' : 'Montserrat');
  const fontUrl = options.fontUrl ?? (isRTL
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
      textCase: 'uppercase',
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
