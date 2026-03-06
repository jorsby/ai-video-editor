import { Texture } from 'pixi.js';
import { BaseClip } from './base-clip';
import { IClip } from './iclip';
import { ClipJSON, ImageClipJSON } from '../json-serialization';
type AnimateImgType = 'avif' | 'webp' | 'png' | 'gif';
/**
 * Image clip supporting animated images
 *
 * Ordinary text can be converted to image clip using {@link renderTxt2ImgBitmap}
 *
 * @example
 * // Load from URL using PixiJS Assets (optimized for Studio)
 * const imgClip = await ImageClip.fromUrl('path/to/image.png');
 *
 * @example
 * // Traditional approach (for Compositor/export)
 * new ImageClip((await fetch('<img url>')).body);
 *
 * @example
 * new ImageClip(
 *   await renderTxt2ImgBitmap(
 *     'Watermark',
 *    `font-size:40px; color: white; text-shadow: 2px 2px 6px red;`,
 *   )
 * )
 *
 */
export declare class ImageClip extends BaseClip implements IClip {
    readonly type = "Image";
    ready: IClip['ready'];
    private _meta;
    /**
     * ⚠️ Static images have duration of Infinity
     *
     * When wrapping with Sprite, you need to set its duration to a finite number
     *
     */
    get meta(): {
        duration: number;
        width: number;
        height: number;
    };
    private img;
    private pixiTexture;
    private frames;
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
    /**
     * Load an image clip from a URL using PixiJS Assets
     * This is optimized for Studio as it uses Texture directly
     *
     * @param url Image URL
     * @param src Optional source identifier for serialization
     * @returns Promise that resolves to an ImageClip instance
     *
     * @example
     * const imgClip = await ImageClip.fromUrl('path/to/image.png');
     */
    static fromUrl(url: string, src?: string): Promise<ImageClip>;
    /**
     * Get the PixiJS Texture (if available)
     * This is used for optimized rendering in Studio
     */
    getTexture(): Texture | null;
    /**
     * Static images can be initialized using stream or ImageBitmap
     *
     * Animated images need to use VideoFrame[] or provide image type
     */
    constructor(dataSource: ReadableStream | ImageBitmap | VideoFrame[] | {
        type: `image/${AnimateImgType}`;
        stream: ReadableStream;
    }, src?: string);
    private initAnimateImg;
    tickInterceptor: <T extends Awaited<ReturnType<ImageClip['tick']>>>(time: number, tickRet: T) => Promise<T>;
    tick(time: number): Promise<{
        video: ImageBitmap | VideoFrame;
        state: 'success';
    }>;
    split(time: number): Promise<[this, this]>;
    clone(): Promise<this>;
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
    destroy(): void;
    toJSON(main?: boolean): ImageClipJSON;
    /**
     * Create an ImageClip instance from a JSON object (fabric.js pattern)
     * @param json The JSON object representing the clip
     * @returns Promise that resolves to an ImageClip instance
     */
    static fromObject(json: ClipJSON): Promise<ImageClip>;
}
export {};
