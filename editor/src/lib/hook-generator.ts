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
 * Generate a Caption clip JSON for the video hook (title card).
 * Uses the same Caption clip type as subtitles but with all text visible at once
 * and centered on screen.
 */
export function generateHookClip(options: HookClipOptions) {
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

  const durationMs = durationUs / 1000;

  const lines = hookText.split('\n');
  const allWords: Array<{
    text: string;
    from: number;
    to: number;
    isKeyWord: boolean;
    paragraphIndex: number;
  }> = [];

  lines.forEach((line, lineIndex) => {
    const wordsInLine = line.trim().split(/\s+/).filter(Boolean);
    wordsInLine.forEach((word) => {
      allWords.push({
        text: word,
        from: 0,
        to: durationMs,
        isKeyWord: false,
        paragraphIndex: lineIndex,
      });
    });
  });

  const captionWidth = videoWidth * 0.85;
  const captionHeight = (fontSize * 1.3) * lines.length + 40;

  return {
    type: 'Caption',
    src: '',
    display: {
      from: 0,
      to: durationUs,
    },
    playbackRate: 1,
    duration: durationUs,
    left: (videoWidth - captionWidth) / 2,
    top: (videoHeight - captionHeight) / 2,
    width: captionWidth,
    height: captionHeight,
    angle: 0,
    zIndex: 15,
    opacity: 1,
    flip: null,
    text: hookText,
    style: {
      fontSize,
      fontFamily,
      fontWeight: '700',
      fontStyle: 'normal',
      color: '#ffffff',
      align: isRTL ? 'right' : 'center',
      fontUrl,
      isRTL,
      stroke: {
        color: '#000000',
        width: 5,
      },
      shadow: {
        color: '#000000',
        alpha: 0.6,
        blur: 6,
        offsetX: 2,
        offsetY: 2,
      },
    },
    caption: {
      words: allWords,
      colors: {
        appeared: '#ffffff',
        active: '#ffffff',
        activeFill: 'transparent',
        background: '',
        keyword: '#ffffff',
      },
      preserveKeywordColor: false,
      positioning: {
        videoWidth,
        videoHeight,
      },
    },
    wordsPerLine: 'multiple',
  };
}
