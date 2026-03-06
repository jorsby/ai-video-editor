import { MP4Sample } from 'wrapbox';
import { file } from 'opfs-tools';
import { BaseClip } from './base-clip';
import { IClip, IPlaybackCapable } from './iclip';
import { VideoClipJSON } from '../json-serialization';
type OPFSToolFile = ReturnType<typeof file>;
type MPClipCloneArgs = Awaited<ReturnType<typeof mp4FileToSamples>> & {
    localFile: OPFSToolFile;
};
interface MP4DecoderConf {
    video: VideoDecoderConfig | null;
    audio: AudioDecoderConfig | null;
}
export interface IMP4ClipOpts {
    audio?: boolean | {
        volume: number;
    };
    /**
     * Unsafe, may be deprecated at any time
     */
    __unsafe_hardwareAcceleration__?: HardwarePreference;
}
type ExtMP4Sample = Omit<MP4Sample, 'data'> & {
    is_idr: boolean;
    deleted?: boolean;
    data: null | Uint8Array;
};
/**
 * Video clip, parses MP4 files, uses {@link VideoClip.tick} to decode image frames at specified time on demand
 *
 * Can be used to implement video frame extraction, thumbnail generation, video editing and other functions
 *
 * @example
 * // Load video clip asynchronously
 * const videoClip = await VideoClip.fromUrl('clip.mp4', {
 *   x: 0,
 *   y: 0,
 *   width: 1920,
 *   height: 1080,
 * });
 *
 * // Set timeline position
 * videoClip.set({
 *   display: {
 *     from: 150, // frames
 *     to: 450, // frames (10 seconds at 30fps)
 *   },
 * });
 *
 */
export declare class VideoClip extends BaseClip implements IPlaybackCapable {
    readonly type = "Video";
    private insId;
    private logger;
    ready: IClip['ready'];
    private _meta;
    get meta(): {
        duration: number;
        width: number;
        height: number;
        audioSampleRate: number;
        audioChanCount: number;
    };
    private localFile;
    /** Store binary data of video header (box: ftyp, moov) */
    private headerBoxPos;
    /**
     * Provide binary data of video header (box: ftyp, moov)
     * Use any mp4 demuxer to parse and get detailed video information
     * Unit tests include sample code using mp4box.js
     */
    getFileHeaderBinData(): Promise<ArrayBuffer>;
    /** Store video transform and rotation info, currently only restores rotation */
    private parsedMatrix;
    private vfRotater;
    private videoSamples;
    private audioSamples;
    private videoFrameFinder;
    private audioFrameFinder;
    private decoderConf;
    private opts;
    /**
     * Whether to include audio track (hybrid JSON structure)
     */
    audio: boolean;
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
     * Load a video clip from a URL
     * @param url Video URL
     * @param opts Position and size options
     * @returns Promise that resolves to a video clip
     *
     * @example
     * const videoClip = await VideoClip.fromUrl('clip.mp4', {
     *   x: 0,
     *   y: 0,
     *   width: 1920,
     *   height: 1080,
     * });
     */
    static fromUrl(url: string, opts?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
    }): Promise<VideoClip>;
    constructor(source: OPFSToolFile | ReadableStream<Uint8Array> | MPClipCloneArgs, opts?: IMP4ClipOpts, src?: string);
    /**
     * Intercept data returned by {@link VideoClip.tick} method for secondary processing of image and audio data
     * @param time Time when tick was called
     * @param tickRet Data returned by tick
     *
     *    */
    tickInterceptor: <T extends Awaited<ReturnType<VideoClip['tick']>>>(time: number, tickRet: T) => Promise<T>;
    /**
     * Get image frame and audio data at specified time
     * @param time Time in microseconds
     */
    tick(time: number): Promise<{
        video?: VideoFrame;
        audio: Float32Array[];
        state: 'success' | 'done';
    }>;
    split(time: number): Promise<[this, this]>;
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
     * Split VideoClip into VideoClips containing only video track and audio track
     * @returns VideoClip[]
     */
    splitTrack(): Promise<VideoClip[]>;
    destroy(): void;
    toJSON(main?: boolean): VideoClipJSON;
    /**
     * Create a VideoClip instance from a JSON object (fabric.js pattern)
     * @param json The JSON object representing the clip
     * @returns Promise that resolves to a VideoClip instance
     */
    static fromObject(json: VideoClipJSON): Promise<VideoClip>;
    /**
     * Create HTMLVideoElement for playback
     */
    createPlaybackElement(): Promise<{
        element: HTMLVideoElement;
        objectUrl?: string;
    }>;
    play(element: HTMLVideoElement | HTMLAudioElement, timeSeconds: number): Promise<void>;
    pause(element: HTMLVideoElement | HTMLAudioElement): void;
    seek(element: HTMLVideoElement | HTMLAudioElement, timeSeconds: number): Promise<void>;
    syncPlayback(element: HTMLVideoElement | HTMLAudioElement, isPlaying: boolean, timeSeconds: number): void;
    cleanupPlayback(element: HTMLVideoElement | HTMLAudioElement, objectUrl?: string): void;
    /**
     * Scale clip to fit within the scene dimensions while maintaining aspect ratio
     * Similar to fabric.js scaleToFit
     * @param sceneWidth Scene width
     * @param sceneHeight Scene height
     */
    scaleToFit(sceneWidth: number, sceneHeight: number): Promise<void>;
    /**
     * Scale clip to fill the scene dimensions while maintaining aspect ratio
     * May crop parts of the clip. Similar to fabric.js scaleToFill
     * @param sceneWidth Scene width
     * @param sceneHeight Scene height
     */
    scaleToFill(sceneWidth: number, sceneHeight: number): Promise<void>;
    /**
     * Center the clip within the scene dimensions
     * Similar to fabric.js center
     * @param sceneWidth Scene width
     * @param sceneHeight Scene height
     */
    centerInScene(sceneWidth: number, sceneHeight: number): void;
}
declare function mp4FileToSamples(otFile: OPFSToolFile, opts?: IMP4ClipOpts): Promise<{
    videoSamples: ExtMP4Sample[];
    audioSamples: ExtMP4Sample[];
    decoderConf: MP4DecoderConf;
    headerBoxPos: {
        start: number;
        size: number;
    }[];
    parsedMatrix: {
        perspective: number;
        rotationRad: number;
        rotationDeg: number;
        scaleX: number;
        scaleY: number;
        translateX: number;
        translateY: number;
    };
}>;
export {};
