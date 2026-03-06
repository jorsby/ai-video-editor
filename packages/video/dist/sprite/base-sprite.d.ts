import { default as EventEmitter } from '../event-emitter';
type IRectBaseProps = any;
interface IAnimationOpts {
    duration: number;
    delay?: number;
    iterCount?: number;
}
type TAnimateProps = IRectBaseProps & {
    opacity: number;
};
export type TAnimationKeyFrame = Array<[number, Partial<TAnimateProps>]>;
type TKeyFrameOpts = Partial<Record<`${number}%` | 'from' | 'to', Partial<TAnimateProps>>>;
export interface BaseSpriteEvents {
    propsChange: Partial<{
        left: number;
        top: number;
        width: number;
        height: number;
        angle: number;
        zIndex: number;
        opacity: number;
        volume: number;
    }>;
    [key: string]: any;
    [key: symbol]: any;
}
/**
 * Sprite base class
 *
 * @see {@link OffscreenSprite}
 */
export declare abstract class BaseSprite extends EventEmitter<BaseSpriteEvents> {
    /**
     * Unique identifier for the sprite/clip
     */
    id: string;
    /**
     * Control display time range of clips, commonly used in editing scenario timeline (track) module
     * from: start time offset in microseconds
     * to: end time (from + duration) in microseconds
     */
    display: {
        from: number;
        to: number;
    };
    /**
     * Duration of the clip in microseconds
     * Cannot exceed the duration of the referenced {@link IClip}
     */
    duration: number;
    /**
     * Playback rate of current clip, 1 means normal playback
     * **Note**
     *    1. When setting playbackRate, duration must be actively corrected
     *    2. Audio uses the simplest interpolation algorithm to change rate, so changing rate will cause pitch variation, for custom algorithm please use {@link VideoClip.tickInterceptor} to implement
     */
    playbackRate: number;
    /**
     * Trim range of the source media in microseconds
     * from: start time in microseconds
     * to: end time in microseconds
     */
    trim: {
        from: number;
        to: number;
    };
    constructor();
    private _left;
    /**
     * Left position (x coordinate)
     */
    get left(): number;
    set left(v: number);
    private _top;
    /**
     * Top position (y coordinate)
     */
    get top(): number;
    set top(v: number);
    private _width;
    /**
     * Width
     */
    get width(): number;
    set width(v: number);
    private _height;
    /**
     * Height
     */
    get height(): number;
    set height(v: number);
    private _angle;
    /**
     * Rotation angle in degrees
     */
    get angle(): number;
    set angle(v: number);
    /**
     * Center point calculated from position and dimensions
     */
    get center(): {
        x: number;
        y: number;
    };
    private _zIndex;
    get zIndex(): number;
    /**
     * Control layering relationship between clips, clips with smaller zIndex will be occluded
     */
    set zIndex(v: number);
    private _opacity;
    /**
     * Opacity (0.0 to 1.0)
     */
    get opacity(): number;
    set opacity(v: number);
    private _volume;
    /**
     * Audio volume level (0.0 to 1.0)
     */
    get volume(): number;
    set volume(v: number);
    /**
     * Flip clip horizontally or vertically
     */
    flip: 'horizontal' | 'vertical' | null;
    effects: Array<{
        id: string;
        key: string;
        startTime: number;
        duration: number;
        targets?: number[];
    }>;
    /**
     * Styling properties (e.g., stroke, dropShadow, borderRadius)
     * This is a generic object to hold visual styles across different clip types
     */
    protected _style: any;
    get style(): any;
    set style(v: any);
    private animatKeyFrame;
    private animatOpts;
    /**
     * @see {@link IClip.ready}
     * For clips, this should be Promise<IClipMeta>, but for BaseSprite it's just Promise<void>
     */
    ready: Promise<any>;
    protected _render(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): void;
    /**
     * Add animation to clip, usage reference CSS animation
     *
     * @example
     * sprite.setAnimation(
     *   {
     *     '0%': { x: 0, y: 0 },
     *     '25%': { x: 1200, y: 680 },
     *     '50%': { x: 1200, y: 0 },
     *     '75%': { x: 0, y: 680 },
     *     '100%': { x: 0, y: 0 },
     *   },
     *   { duration: 4e6, iterCount: 1 },
     * );
     *
     */
    setAnimation(keyFrame: TKeyFrameOpts, opts: IAnimationOpts): void;
    /**
     * If current sprite has animation set, set sprite's animation properties to state at specified time
     */
    animate(time: number): void;
    /**
     * Copy current sprite's properties to target
     *
     * Used for cloning or copying state between {@link OffscreenSprite} instances
     */
    copyStateTo<T extends BaseSprite>(target: T): void;
    /**
     * Update multiple properties at once
     */
    update(updates: Partial<this>): void;
    protected destroy(): void;
}
export declare function linearTimeFn(time: number, keyFrame: TAnimationKeyFrame, opts: Required<IAnimationOpts>): Partial<TAnimateProps>;
export {};
