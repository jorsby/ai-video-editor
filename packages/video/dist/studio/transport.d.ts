import { Studio } from '../studio';
import { IClip, IPlaybackCapable } from '../clips/iclip';
export interface PlaybackElementInfo {
    element: HTMLVideoElement | HTMLAudioElement;
    objectUrl?: string;
}
export declare class Transport {
    private studio;
    isPlaying: boolean;
    currentTime: number;
    maxDuration: number;
    private playStartTime;
    private playStartTimestamp;
    private rafId;
    playbackElements: Map<IClip, PlaybackElementInfo>;
    constructor(studio: Studio);
    setMaxDuration(duration: number): void;
    /**
     * Start playback
     */
    play(): Promise<void>;
    /**
     * Pause playback
     */
    pause(): void;
    /**
     * Stop playback and reset to start
     */
    stop(): Promise<void>;
    /**
     * Seek to a specific time (in microseconds)
     */
    seek(time: number): Promise<void>;
    private renderLoop;
    isPlaybackCapable(clip: any): clip is IPlaybackCapable;
}
