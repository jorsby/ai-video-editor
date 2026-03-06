import { BaseSprite } from '../sprite/base-sprite';
import { IClip, IClipMeta, ITransitionInfo } from './iclip';
import { ClipJSON } from '../json-serialization';
/**
 * Base class for all clips that extends BaseSprite
 * Provides common functionality for sprite operations (position, animation, timing)
 * and frame management
 */
export declare abstract class BaseClip extends BaseSprite implements IClip {
    abstract readonly type: string;
    private lastVf;
    protected destroyed: boolean;
    /**
     * Source URL or identifier for this clip
     * Used for serialization and reloading from JSON
     */
    src: string;
    /**
     * Transition info (optional)
     */
    transition?: ITransitionInfo;
    abstract tick(time: number): Promise<{
        video?: VideoFrame | ImageBitmap | null;
        audio?: Float32Array[];
        state: 'done' | 'success';
    }>;
    ready: Promise<IClipMeta>;
    abstract readonly meta: IClipMeta;
    abstract clone(): Promise<this>;
    abstract split?(time: number): Promise<[this, this]>;
    constructor();
    /**
     * Get video frame and audio at specified time without rendering to canvas
     * Useful for Pixi.js rendering where canvas context is not needed
     * @param time Specified time in microseconds
     */
    getFrame(time: number): Promise<{
        video: ImageBitmap | null;
        audio: Float32Array[];
        done: boolean;
    }>;
    /**
     * Draw image at specified time to canvas context and return corresponding audio data
     * @param time Specified time in microseconds
     */
    offscreenRender(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, time: number): Promise<{
        audio: Float32Array[];
        done: boolean;
    }>;
    /**
     * Set clip properties (position, size, display timeline)
     * @param props Properties to set
     * @param fps Optional FPS for frame-to-time conversion (default: 30)
     * @returns this for method chaining
     *
     * @example
     * // Using frames (will be converted to microseconds)
     * clip.set({
     *   display: {
     *     from: 150, // frames
     *     to: 450, // frames (10 seconds at 30fps)
     *   },
     * }, 30);
     *
     * // Using microseconds directly
     * clip.set({
     *   display: {
     *     from: 5000000, // microseconds
     *     to: 15000000, // microseconds
     *   },
     * });
     */
    set(props: {
        display?: {
            from?: number;
            to?: number;
        };
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        duration?: number;
    }, fps?: number): this;
    /**
     * Base implementation of toJSON that handles common clip properties
     * Subclasses should override to add their specific options
     * @param main Whether this is the main clip (for Compositor)
     */
    toJSON(main?: boolean): ClipJSON;
    /**
     * Get the list of visible transformer handles for this clip type
     * Default implementation returns all handles
     * Override in subclasses to customize handle visibility (e.g., TextClip)
     */
    getVisibleHandles(): Array<'tl' | 'tr' | 'bl' | 'br' | 'ml' | 'mr' | 'mt' | 'mb' | 'rot'>;
    /**
     * Scale clip to fit within the scene dimensions while maintaining aspect ratio
     * @param sceneWidth Scene width
     * @param sceneHeight Scene height
     */
    scaleToFit(sceneWidth: number, sceneHeight: number): Promise<void>;
    /**
     * Scale clip to fill the scene dimensions while maintaining aspect ratio
     * May crop parts of the clip.
     * @param sceneWidth Scene width
     * @param sceneHeight Scene height
     */
    scaleToFill(sceneWidth: number, sceneHeight: number): Promise<void>;
    /**
     * Center the clip within the scene dimensions
     * @param sceneWidth Scene width
     * @param sceneHeight Scene height
     */
    centerInScene(sceneWidth: number, sceneHeight: number): void;
    destroy(): void;
}
