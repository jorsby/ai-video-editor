import { BaseClip } from './base-clip';
import { IClip } from './iclip';
import { CaptionClipJSON } from '../json-serialization';
import { Application, Texture } from 'pixi.js';
export interface ICaptionClipOpts {
    /**
     * Font size in pixels
     * @default 30
     */
    fontSize?: number;
    /**
     * Font family
     * @default 'Arial'
     */
    fontFamily?: string;
    fontUrl?: string;
    /**
     * Font weight (e.g., 'normal', 'bold', '400', '700')
     * @default 'normal'
     */
    fontWeight?: string;
    /**
     * Font style (e.g., 'normal', 'italic')
     * @default 'normal'
     */
    fontStyle?: string;
    /**
     * Text color (hex string, color name, or gradient object)
     * @default '#ffffff'
     */
    fill?: string | number | {
        type: 'gradient';
        x0: number;
        y0: number;
        x1: number;
        y1: number;
        colors: Array<{
            ratio: number;
            color: string | number;
        }>;
    };
    /**
     * Caption data (matches caption object in JSON)
     */
    caption?: {
        words?: Array<{
            text: string;
            from: number;
            to: number;
            isKeyWord: boolean;
            paragraphIndex?: number;
        }>;
        colors?: {
            appeared?: string;
            active?: string;
            activeFill?: string;
            background?: string;
            keyword?: string;
        };
        preserveKeywordColor?: boolean;
        positioning?: {
            videoWidth?: number;
            videoHeight?: number;
            bottomOffset?: number;
        };
    };
    /**
     * @deprecated Use caption.words instead
     */
    words?: Array<{
        text: string;
        from: number;
        to: number;
        isKeyWord: boolean;
        paragraphIndex?: number;
    }>;
    /**
     * @deprecated Use caption.colors instead
     */
    colors?: {
        appeared?: string;
        active?: string;
        activeFill?: string;
        background?: string;
        keyword?: string;
    };
    /**
     * @deprecated Use caption.preserveKeywordColor instead
     */
    preserveKeywordColor?: boolean;
    /**
     * @deprecated Use caption.positioning.videoWidth instead
     */
    videoWidth?: number;
    /**
     * @deprecated Use caption.positioning.videoHeight instead
     */
    videoHeight?: number;
    /**
     * @deprecated Use caption.positioning.bottomOffset instead
     */
    bottomOffset?: number;
    /**
     * Stroke color (hex string or color name) or stroke object with advanced options
     */
    stroke?: string | number | {
        color: string | number;
        width: number;
        join?: 'miter' | 'round' | 'bevel';
    };
    /**
     * Stroke width in pixels (used when stroke is a simple color)
     * @default 0
     */
    strokeWidth?: number;
    /**
     * Text alignment ('left', 'center', 'right')
     * @default 'center'
     */
    align?: 'left' | 'center' | 'right';
    /**
     * Drop shadow configuration
     */
    dropShadow?: {
        color?: string | number;
        alpha?: number;
        blur?: number;
        angle?: number;
        distance?: number;
    };
    /**
     * Word wrap width (0 = no wrap)
     * @default 0
     */
    wordWrapWidth?: number;
    /**
     * Word wrap mode ('break-word' or 'normal')
     * @default 'break-word'
     */
    wordWrap?: boolean;
    /**
     * Line height (multiplier)
     * @default 1
     */
    lineHeight?: number;
    /**
     * Letter spacing in pixels
     * @default 0
     */
    letterSpacing?: number;
    /**
     * Text case transformation
     * @default 'none'
     */
    textCase?: 'none' | 'uppercase' | 'lowercase' | 'title';
    /**
     * Media ID to which the captions were applied
     */
    mediaId?: string;
}
/**
 * Caption clip using Canvas 2D for rendering
 * Each instance represents a single caption segment
 *
 * @example
 * const captionClip = new CaptionClip('Hello World', {
 *   fontSize: 44,
 *   fontFamily: 'Arial',
 *   fill: '#ffffff',
 *   videoWidth: 1280,
 *   videoHeight: 720,
 * });
 * captionClip.display.from = 0;
 * captionClip.duration = 3e6; // 3 seconds
 */
export declare class CaptionClip extends BaseClip implements IClip {
    readonly type = "Caption";
    ready: IClip['ready'];
    private _meta;
    get meta(): {
        duration: number;
        width: number;
        height: number;
    };
    /**
     * Caption text content (hybrid JSON structure)
     */
    text: string;
    get style(): any;
    set style(v: any);
    get fontFamily(): string;
    set fontFamily(v: string);
    get fontUrl(): string;
    set fontUrl(v: string);
    get fontSize(): number;
    set fontSize(v: number);
    get fontWeight(): string;
    set fontWeight(v: string);
    get fontStyle(): string;
    set fontStyle(v: string);
    get fill(): any;
    set fill(v: any);
    get align(): 'left' | 'center' | 'right';
    set align(v: 'left' | 'center' | 'right');
    get stroke(): any;
    set stroke(v: any);
    get strokeWidth(): number;
    set strokeWidth(v: number);
    get dropShadow(): any;
    set dropShadow(v: any);
    get caption(): any;
    set caption(v: any);
    /**
     * Bottom offset from video bottom (hybrid JSON structure)
     */
    bottomOffset?: number;
    /**
     * Text case proxy
     */
    get textCase(): string;
    set textCase(v: 'none' | 'uppercase' | 'lowercase' | 'title');
    /**
     * Unique identifier for this clip instance
     */
    id: string;
    /**
     * Media ID of the source clip
     */
    get mediaId(): string | undefined;
    set mediaId(v: string | undefined);
    /**
     * Array of effects to be applied to this clip
     * Each effect specifies key, startTime, duration, and optional targets
     */
    effects: Array<{
        id: string;
        key: string;
        startTime: number;
        duration: number;
    }>;
    /**
     * Words getter for the clip
     */
    get words(): any[];
    /**
     * Words setter that triggers re-render and ensures consistency
     */
    set words(v: any[]);
    private opts;
    private pixiTextContainer;
    private renderTexture;
    private wordTexts;
    private extraPadding;
    private textStyle;
    private externalRenderer;
    private pixiApp;
    private originalOpts;
    constructor(text: string, opts?: ICaptionClipOpts, renderer?: Application['renderer']);
    /**
     * Update text styling options and refresh the caption rendering
     */
    updateStyle(opts: Partial<ICaptionClipOpts>): Promise<void>;
    private refreshCaptions;
    private lastLoggedTime;
    updateState(currentTime: number): void;
    /**
     * Get the PixiJS Texture (RenderTexture) for optimized rendering in Studio
     * This avoids ImageBitmap → Canvas → Texture conversion
     *
     * @returns The RenderTexture containing the rendered caption, or null if not ready
     */
    getTexture(): Promise<Texture | null>;
    /**
     * Set an external renderer (e.g., from Studio) to avoid creating our own Pixi App
     */
    setRenderer(renderer: Application['renderer']): void;
    private getRenderer;
    tick(time: number): Promise<{
        video: ImageBitmap;
        state: 'success';
    }>;
    split(_time: number): Promise<[this, this]>;
    addEffect(effect: {
        id: string;
        key: string;
        startTime: number;
        duration: number;
    }): void;
    editEffect(effectId: string, newEffectData: Partial<{
        key: string;
        startTime: number;
        duration: number;
    }>): void;
    removeEffect(effectId: string): void;
    clone(): Promise<this>;
    destroy(): void;
    toJSON(main?: boolean): CaptionClipJSON;
    /**
     * Create a CaptionClip instance from a JSON object (fabric.js pattern)
     * @param json The JSON object representing the clip
     * @returns Promise that resolves to a CaptionClip instance
     */
    static fromObject(json: CaptionClipJSON): Promise<CaptionClip>;
}
