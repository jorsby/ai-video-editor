import { IClip, ITransitionInfo } from './clips';
interface BaseClipJSON {
    id?: string;
    effects?: Array<{
        id: string;
        key: string;
        startTime: number;
        duration: number;
        targets?: number[];
    }>;
    src: string;
    display: {
        from: number;
        to: number;
    };
    playbackRate: number;
    duration: number;
    left: number;
    top: number;
    width: number;
    height: number;
    angle: number;
    zIndex: number;
    opacity: number;
    flip: 'horizontal' | 'vertical' | null;
    trim?: {
        from: number;
        to: number;
    };
    transition?: ITransitionInfo;
    style?: any;
    animation?: {
        keyFrames: Record<string, Partial<{
            x: number;
            y: number;
            w: number;
            h: number;
            angle: number;
            opacity: number;
        }>>;
        opts: {
            duration: number;
            delay?: number;
            iterCount?: number;
        };
    };
    main?: boolean;
}
export interface VideoClipJSON extends BaseClipJSON {
    type: 'Video';
    audio?: boolean;
    volume?: number;
}
export interface AudioClipJSON extends BaseClipJSON {
    type: 'Audio';
    loop?: boolean;
    volume?: number;
}
export interface ImageClipJSON extends BaseClipJSON {
    type: 'Image';
}
export interface TextStyleJSON {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    fontStyle?: string;
    color?: string;
    align?: 'left' | 'center' | 'right';
    fontUrl?: string;
    stroke?: {
        color: string;
        width: number;
        join?: 'miter' | 'round' | 'bevel';
        cap?: 'butt' | 'round' | 'square';
        miterLimit?: number;
    };
    shadow?: {
        color: string;
        alpha: number;
        blur: number;
        distance: number;
        angle: number;
    };
    wordWrap?: boolean;
    wordWrapWidth?: number;
    lineHeight?: number;
    letterSpacing?: number;
    textCase?: 'none' | 'uppercase' | 'lowercase' | 'title';
}
export interface TextClipJSON extends BaseClipJSON {
    type: 'Text';
    text: string;
    style?: TextStyleJSON;
}
export interface CaptionColorsJSON {
    appeared?: string;
    active?: string;
    activeFill?: string;
    background?: string;
    keyword?: string;
}
export interface CaptionPositioningJSON {
    bottomOffset?: number;
    videoWidth?: number;
    videoHeight?: number;
}
export interface CaptionDataJSON {
    words?: Array<{
        text: string;
        from: number;
        to: number;
        isKeyWord: boolean;
        paragraphIndex?: number;
    }>;
    colors?: CaptionColorsJSON;
    preserveKeywordColor?: boolean;
    positioning?: CaptionPositioningJSON;
}
export interface CaptionClipJSON extends BaseClipJSON {
    type: 'Caption';
    text: string;
    style?: TextStyleJSON;
    caption?: CaptionDataJSON;
    bottomOffset?: number;
    words?: Array<{
        text: string;
        from: number;
        to: number;
        isKeyWord: boolean;
        paragraphIndex?: number;
    }>;
    appearedColor?: string;
    activeColor?: string;
    activeFillColor?: string;
    backgroundColor?: string;
    isKeyWordColor?: string;
    preservedColorKeyWord?: boolean;
    videoWidth?: number;
    videoHeight?: number;
    fontUrl?: string;
    mediaId?: string;
}
export interface EffectClipJSON extends BaseClipJSON {
    type: 'Effect';
    effect: {
        id: string;
        key: string;
        name: string;
    };
}
export interface TransitionClipJSON extends BaseClipJSON {
    type: 'Transition';
    transitionEffect: {
        id: string;
        key: string;
        name: string;
    };
    fromClipId: string | null;
    toClipId: string | null;
}
export interface PlaceholderClipJSON extends BaseClipJSON {
    type: 'Placeholder';
}
export interface TransitionJSON {
    key: string;
    duration: number;
    clips: string[];
}
export type ClipJSON = VideoClipJSON | AudioClipJSON | ImageClipJSON | TextClipJSON | CaptionClipJSON | EffectClipJSON | TransitionClipJSON | PlaceholderClipJSON;
export interface StudioTrackJSON {
    id: string;
    name: string;
    type: string;
    clipIds: string[];
}
export interface ProjectJSON {
    tracks?: StudioTrackJSON[];
    clips: ClipJSON[];
    transition?: TransitionJSON[];
    transitions?: TransitionJSON[];
    globalEffects?: Array<{
        id: string;
        key: string;
        startTime: number;
        duration: number;
    }>;
    settings?: {
        width?: number;
        height?: number;
        fps?: number;
        bgColor?: string;
        videoCodec?: string;
        bitrate?: number;
        audio?: boolean;
        metaDataTags?: Record<string, string>;
    };
}
/**
 * Serialize a clip to JSON format
 * @param clip The clip to serialize
 * @param main Whether this is the main clip (for Compositor)
 */
export declare function clipToJSON(clip: IClip, main?: boolean): ClipJSON;
/**
 * Deserialize JSON to a clip instance
 * Uses fromObject static method if available (fabric.js pattern), otherwise falls back to manual construction
 */
export declare function jsonToClip(json: ClipJSON): Promise<IClip>;
export {};
