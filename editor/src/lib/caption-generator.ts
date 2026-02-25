import { groupWordsByWidth } from "@/utils/schema-converter";
import * as PIXI from "pixi.js";
import { DEFAULT_CAPTION_FONT_SIZE } from "@/components/editor/constant/caption";

interface CaptionClipOptions {
  videoWidth: number;
  videoHeight: number;
  words: any[];
  fontSize?: number;
  fontFamily?: string;
  fontUrl?: string;
  mode?: "single" | "multiple";
  style?: any;
  isRTL?: boolean;
}

/**
 * Generate caption clips from transcription words
 */
export async function generateCaptionClips(
  options: CaptionClipOptions,
): Promise<any[]> {
  const {
    videoWidth,
    videoHeight,
    words,
    fontSize = DEFAULT_CAPTION_FONT_SIZE,
    isRTL = false,
    mode = "multiple",
  } = options;

  const fontFamily = options.fontFamily ?? (isRTL ? "Cairo" : "Bangers-Regular");
  const fontUrl = options.fontUrl ?? (isRTL
    ? "https://fonts.gstatic.com/s/cairo/v28/SLXgc1nY6HkvangtZmpcWmhzfH5lWWgcQyyS4J0.ttf"
    : "https://fonts.gstatic.com/s/poppins/v15/pxiByp8kv8JHgFVrLCz7V1tvFP-KUEg.ttf");

  const maxCaptionWidth = videoWidth * 0.8;
  let captionChunks: any[] = [];

  const canvas =
    typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = canvas?.getContext("2d");
  if (ctx) {
    ctx.font = `${fontSize}px ${fontFamily}`;
  }

  const measureText = (text: string) => {
    if (!ctx) return { width: 0, height: fontSize };
    const metrics = ctx.measureText(text);
    const height =
      metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    return {
      width: metrics.width,
      height: height || fontSize,
    };
  };
  if (mode === "single") {
    // Each word is a chunk
    captionChunks = words.map((word) => {
      const text = word.word || word.text || "";
      const dims = measureText(text);
      const bitmapText = new PIXI.BitmapText(text, {
        fontFamily,
        fontSize,
      });
      const testWidth = bitmapText.width + 60;
      return {
        text,
        from: word.start || word.from / 1000,
        to: word.end || word.to / 1000,
        width: testWidth,
        height: dims.height,
        words: [
          {
            text,
            from: 0,
            to:
              ((word.end || word.to / 1000) -
                (word.start || word.from / 1000)) *
              1000,
            isKeyWord: true,
            paragraphIndex: word.paragraphIndex ?? 0,
          },
        ],
      };
    });
  } else {
    captionChunks = groupWordsByWidth(
      words,
      maxCaptionWidth,
      fontSize,
      fontFamily,
    );
  }

  const clips: any[] = [];

  for (const chunk of captionChunks) {
    const chunkFromMs = chunk.from * 1000; // seconds to ms
    const chunkToMs = chunk.to * 1000;
    const chunkDurationMs = chunkToMs - chunkFromMs;

    const fromUs = chunkFromMs * 1000; // ms to μs
    const toUs = chunkToMs * 1000;
    const durationUs = chunkDurationMs * 1000;

    // Use actual measured dimensions from chunk, with padding
    const captionWidth =
      Math.ceil(chunk.width) + (mode === "single" ? 60 : 100);
    const captionHeight = Math.ceil(chunk.height) + 20;

    clips.push({
      type: "Caption",
      src: "",
      display: {
        from: fromUs,
        to: toUs,
      },
      playbackRate: 1,
      duration: durationUs,
      left: (videoWidth - captionWidth) / 2, // Center horizontally
      top: (() => {
        const align = options.style?.verticalAlign;
        if (align === "top") return 80;
        if (align === "top-quarter") return videoHeight * 0.30 - captionHeight / 2;
        if (align === "center") return (videoHeight - captionHeight) / 2;
        if (align === "bottom-quarter") return videoHeight * 0.70 - captionHeight / 2;
        return videoHeight - captionHeight - 80;
      })(),
      width: captionWidth,
      height: captionHeight,
      angle: 0,
      zIndex: 10,
      opacity: 1,
      flip: null,
      text: chunk.text,
      style: options.style || {
        fontSize: fontSize,
        fontFamily: fontFamily,
        fontWeight: "700",
        fontStyle: "normal",
        color: "#ffffff",
        align: isRTL ? "right" : "center",
        fontUrl: fontUrl,
        isRTL,
        stroke: {
          color: "#000000",
          width: 4,
        },
        shadow: {
          color: "#000000",
          alpha: 0.5,
          blur: 4,
          offsetX: 2,
          offsetY: 2,
        },
      },
      caption: {
        words: chunk.words,
        colors: {
          appeared: "#ffffff",
          active: "#ffffff",
          activeFill: "#FF5700",
          background: "",
          keyword: "#ffffff",
        },
        preserveKeywordColor: true,
        positioning: {
          videoWidth: videoWidth,
          videoHeight: videoHeight,
        },
      },
      wordsPerLine: mode,
    });
  }

  return clips;
}
