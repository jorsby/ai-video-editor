import { BaseClip } from './base-clip';
import { IClip, IPlaybackCapable } from './iclip';
import { AudioClipJSON } from '../json-serialization';
interface IAudioClipOpts {
    loop?: boolean;
    volume?: number;
}
/**
 * Audio clip providing audio data for creating and editing audio/video
 *
 * @example
 * // Load audio clip asynchronously
 * const audioClip = await AudioClip.fromUrl('path/to/audio.mp3', {
 *   loop: true,
 * });
 *
 * @example
 * // Traditional approach (for advanced use)
 * new AudioClip((await fetch('<mp3 url>')).body, {
 *   loop: true,
 * }),
 */
export declare class AudioClip extends BaseClip implements IPlaybackCapable {
    readonly type = "Audio";
    static ctx: AudioContext | null;
    ready: IClip['ready'];
    private _meta;
    /**
     * Audio metadata
     *
     * ⚠️ Note, these are converted (normalized) metadata, not original audio metadata
     */
    get meta(): {
        sampleRate: number;
        chanCount: number;
        duration: number;
        width: number;
        height: number;
    };
    private chan0Buf;
    private chan1Buf;
    /**
     * Get complete PCM data from audio clip
     */
    getPCMData(): Float32Array[];
    private opts;
    /**
     * Whether to loop the audio (hybrid JSON structure)
     */
    loop: boolean;
    /**
     * Load an audio clip from a URL
     * @param url Audio URL
     * @param opts Audio configuration (loop, volume)
     * @returns Promise that resolves to an audio clip
     *
     * @example
     * const audioClip = await AudioClip.fromUrl('path/to/audio.mp3', {
     *   loop: true,
     *   volume: 0.8,
     * });
     */
    static fromUrl(url: string, opts?: IAudioClipOpts): Promise<AudioClip>;
    /**
     * Create an AudioClip instance from a JSON object (fabric.js pattern)
     * @param json The JSON object representing the clip
     * @returns Promise that resolves to an AudioClip instance
     */
    static fromObject(json: AudioClipJSON): Promise<AudioClip>;
    /**
     *
     * @param dataSource Audio file stream
     * @param opts Audio configuration, controls volume and whether to loop
     */
    constructor(dataSource: ReadableStream<Uint8Array> | Float32Array[], opts?: IAudioClipOpts, src?: string);
    private init;
    /**
     * Intercept data returned by {@link AudioClip.tick} method for secondary processing of audio data
     * @param time Time when tick was called
     * @param tickRet Data returned by tick
     *
     */
    tickInterceptor: <T extends Awaited<ReturnType<AudioClip['tick']>>>(time: number, tickRet: T) => Promise<T>;
    private timestamp;
    private frameOffset;
    /**
     * Return audio PCM data corresponding to the time difference between last and current moments
     *
     * If the difference exceeds 3s or current time is less than last time, reset state
     * @example
     * tick(0) // => []
     * tick(1e6) // => [leftChanPCM(1s), rightChanPCM(1s)]
     *
     */
    tick(time: number): Promise<{
        audio: Float32Array[];
        state: 'success' | 'done';
    }>;
    /**
     * Split at specified time, return two audio clips before and after
     * @param time Time in microseconds
     */
    split(time: number): Promise<[this, this]>;
    clone(): Promise<this>;
    /**
     * Destroy instance and release resources
     */
    destroy(): void;
    toJSON(main?: boolean): AudioClipJSON;
    static concatAudioClip: typeof concatAudioClip;
    /**
     * Create HTMLAudioElement for playback
     */
    createPlaybackElement(): Promise<{
        element: HTMLAudioElement;
        objectUrl?: string;
    }>;
    play(element: HTMLVideoElement | HTMLAudioElement, timeSeconds: number): Promise<void>;
    pause(element: HTMLVideoElement | HTMLAudioElement): void;
    seek(element: HTMLVideoElement | HTMLAudioElement, timeSeconds: number): Promise<void>;
    syncPlayback(element: HTMLVideoElement | HTMLAudioElement, isPlaying: boolean, timeSeconds: number): void;
    cleanupPlayback(element: HTMLVideoElement | HTMLAudioElement, objectUrl?: string): void;
}
/**
 * Concatenate multiple AudioClips
 */
export declare function concatAudioClip(clips: AudioClip[], opts?: IAudioClipOpts): Promise<AudioClip>;
export {};
