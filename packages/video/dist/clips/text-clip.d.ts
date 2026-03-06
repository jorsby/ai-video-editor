import { Application, Texture } from 'pixi.js';
import { BaseClip } from './base-clip';
import { IClip } from './iclip';
import { TextClipJSON } from '../json-serialization';
export interface ITextClipOpts {
    /**
     * Font size in pixels
     * @default 40
     */
    fontSize?: number;
    /**
     * Font family
     * @default 'Roboto'
     */
    fontFamily?: string;
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
     * Font URL for custom fonts
     */
    fontUrl?: string;
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
     * Stroke color (hex string or color name) or stroke object with advanced options
     */
    stroke?: string | number | {
        color: string | number;
        width: number;
        join?: 'miter' | 'round' | 'bevel';
        cap?: 'butt' | 'round' | 'square';
        miterLimit?: number;
    };
    /**
     * Stroke width in pixels (used when stroke is a simple color)
     * @default 0
     */
    strokeWidth?: number;
    /**
     * Text alignment ('left', 'center', 'right')
     * @default 'left'
     */
    align?: 'left' | 'center' | 'right';
    /**
     * Alias for align to match UI property naming
     */
    textAlign?: 'left' | 'center' | 'right';
    /**
     * Vertical alignment ('top', 'center', 'bottom')
     * @default 'top'
     */
    verticalAlign?: 'top' | 'center' | 'bottom' | 'underline' | 'overline' | 'strikethrough';
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
     * Text decoration ('none', 'underline', 'line-through', 'overline')
     * @default 'none'
     */
    textDecoration?: 'none' | 'underline' | 'line-through' | 'overline';
}
/**
 * Text clip using PixiJS Text for rendering
 *
 * @example
 * const textClip = new TextClip('Hello World', {
 *   fontSize: 48,
 *   fill: '#ffffff',
 *   stroke: '#000000',
 *   strokeWidth: 2,
 *   dropShadow: {
 *     color: '#000000',
 *     alpha: 0.5,
 *     blur: 4,
 *     distance: 2,
 *   },
 * });
 * textClip.duration = 5e6; // 5 seconds
 */
export declare class TextClip extends BaseClip {
    readonly type = "Text";
    ready: IClip['ready'];
    private _meta;
    get meta(): {
        duration: number;
        width: number;
        height: number;
    };
    get width(): number;
    set width(v: number);
    get height(): number;
    set height(v: number);
    private _lastContentWidth;
    private _lastContentHeight;
    private _text;
    /**
     * Text content (hybrid JSON structure)
     */
    get text(): string;
    set text(v: string);
    /**
     * Text styling (hybrid JSON structure)
     * Provides direct access to styling properties
     */
    /**
     * Text styling (hybrid JSON structure)
     * Provides direct access to styling properties
     */
    get style(): any;
    set style(opts: Partial<ITextClipOpts>);
    /**
     * Text alignment proxy for compatibility with UI
     */
    get textAlign(): 'left' | 'center' | 'right';
    set textAlign(v: 'left' | 'center' | 'right');
    /**
     * Vertical alignment or decoration proxy
     */
    get verticalAlign(): string;
    set verticalAlign(v: string);
    /**
     * Text case proxy
     */
    get textCase(): string;
    set textCase(v: 'none' | 'uppercase' | 'lowercase' | 'title');
    private pixiText;
    private textStyle;
    private renderTexture;
    private externalRenderer;
    private pixiApp;
    private originalOpts;
    /**
     * Unique identifier for this clip instance
     */
    id: string;
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
    constructor(text: string, opts?: ITextClipOpts, renderer?: Application['renderer']);
    /**
     * Set an external renderer (e.g., from Studio) to avoid creating our own Pixi App
     * This is an optimization for Studio preview
     * Can be called before ready() completes
     */
    setRenderer(renderer: Application['renderer']): void;
    /**
     * Get the renderer for rendering text to RenderTexture
     * Creates a minimal renderer as fallback if no external renderer is provided
     */
    private getRenderer;
    /**
     * Get the PixiJS Texture (RenderTexture) for optimized rendering in Studio
     * This avoids ImageBitmap → Canvas → Texture conversion
     *
     * @returns The RenderTexture containing the rendered text, or null if not ready
     */
    getTexture(): Promise<Texture | null>;
    tick(_time: number): Promise<{
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
    /**
     * Update text styling options and refresh the texture
     * This is used for dynamic updates like resizing with text reflow
     */
    updateStyle(opts: Partial<ITextClipOpts>): Promise<void>;
    /**
     * Refresh the internal Pixi Text and RenderTexture
     * Calculates dimensions based on text bounds and wrapping options
     */
    private refreshText;
    /**
     * Helper to create PixiJS TextStyle options from TextClip options
     */
    private createStyleFromOpts;
    destroy(): void;
    toJSON(main?: boolean): TextClipJSON;
    /**
     * Create a TextClip instance from a JSON object (fabric.js pattern)
     * @param json The JSON object representing the clip
     * @returns Promise that resolves to a TextClip instance
     */
    static fromObject(json: TextClipJSON): Promise<TextClip>;
    /**
     * Override handle visibility for text clips
     * Text clips should only show: mr (mid-right), mb (mid-bottom), br (bottom-right), and rot (rotation)
     * This allows resizing width and height independently while preventing corner handles that might distort text
     */
    getVisibleHandles(): Array<'tl' | 'tr' | 'bl' | 'br' | 'ml' | 'mr' | 'mt' | 'mb' | 'rot'>;
}
