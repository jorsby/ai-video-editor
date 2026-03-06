import { IClip } from './clips';
import { default as EventEmitter } from './event-emitter';
import { ProjectJSON } from './json-serialization';
export interface ICompositorOpts {
    width?: number;
    height?: number;
    bitrate?: number;
    fps?: number;
    bgColor?: string;
    videoCodec?: string;
    /**
     * If false, exclude audio track from the output video
     */
    audio?: false;
    /**
     * Write metadata tags to the output video
     */
    metaDataTags?: Record<string, string>;
    /**
     * Unsafe, may be deprecated at any time
     */
    __unsafe_hardwareAcceleration__?: HardwarePreference;
}
/**
 * Video compositor that can add multiple {@link OffscreenSprite} instances,
 * @example
 * const spr1 = new OffscreenSprite(
 *   new VideoClip((await fetch('<mp4 url>')).body),
 * );
 * const spr2 = new OffscreenSprite(
 *   await AudioClip.fromUrl('<audio url>'),
 * );
 * const com = new Compositor({ width: 1280, height: 720, });

 * await com.addSprite(spr1);
 * await com.addSprite(spr2);

 * com.output(); // => ReadableStream
 *
 */
export declare class Compositor extends EventEmitter<{
    OutputProgress: number;
    error: Error;
}> {
    /**
     * Check compatibility with the current environment
     * @param args.videoCodec Specify video codec, default avc1.42E032
     * @param args.width Specify video width, default 1920
     * @param args.height Specify video height, default 1080
     * @param args.bitrate Specify video bitrate, default 5e6
     */
    static isSupported(args?: {
        videoCodec?: string;
        width?: number;
        height?: number;
        bitrate?: number;
    }): Promise<boolean>;
    private logger;
    private destroyed;
    private sprites;
    private canvas;
    private pixiApp;
    private stopOutput;
    private opts;
    private hasVideoTrack;
    /**
     * Create a compositor instance based on configuration
     * @param opts ICompositorOpts
     */
    constructor(opts?: ICompositorOpts);
    initPixiApp(): Promise<void>;
    /**
     * Add a clip for video composition. Video duration defaults to the maximum duration value from all clips
     * @param clip Clip (extends BaseSprite)
     * @param opts.main If main is true, the video duration uses this clip's duration value
     */
    addSprite(clip: IClip, opts?: {
        main?: boolean;
    }): Promise<void>;
    private initMuxer;
    /**
     * Output video file binary stream
     * @param opts.maxTime Maximum duration allowed for output video, content exceeding this will be ignored
     */
    output(opts?: {
        maxTime?: number;
    }): ReadableStream<Uint8Array>;
    /**
     * Destroy instance and release resources
     */
    destroy(): void;
    private runEncoding;
    /**
     * Export current compositor state to JSON
     */
    exportToJSON(): ProjectJSON;
    /**
     * Load clips from JSON
     * @param json The JSON project data
     */
    loadFromJSON(json: ProjectJSON): Promise<void>;
}
/**
 * Buffer input data and convert to AudioData with fixed frame count
 * @param framesPerChunk Number of audio frames per AudioData instance
 */
export declare function createAudioTrackBuf(framesPerChunk: number): (timestamp: number, trackAudios: Float32Array[][]) => AudioData[];
