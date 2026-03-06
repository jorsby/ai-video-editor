import { Application, Sprite, Texture, Container, Graphics, RenderTexture } from 'pixi.js';
import { ImageClip } from './clips/image-clip';
import { IClip } from './clips/iclip';
import { VideoClip } from './clips/video-clip';
import { PixiSpriteRenderer } from './sprite/pixi-sprite-renderer';
import { ProjectJSON } from './json-serialization';
import { Transformer } from './transfomer/transformer';
import { EffectKey } from './effect/glsl/gl-effect';
import { default as EventEmitter } from './event-emitter';
import { SelectionManager } from './studio/selection-manager';
import { Transport } from './studio/transport';
import { TimelineModel } from './studio/timeline-model';
export interface IStudioOpts {
    width: number;
    height: number;
    fps?: number;
    bgColor?: string;
    canvas?: HTMLCanvasElement;
    interactivity?: boolean;
}
interface ActiveGlobalEffect {
    id: string;
    key: EffectKey;
    startTime: number;
    duration: number;
    trackIndex?: number;
}
interface GlobalEffectInfo {
    id: string;
    key: EffectKey;
    startTime: number;
    duration: number;
}
export interface StudioEvents {
    'selection:created': {
        selected: IClip[];
    };
    'selection:updated': {
        selected: IClip[];
    };
    'selection:cleared': {
        deselected: IClip[];
    };
    'track:added': {
        track: StudioTrack;
    };
    'track:removed': {
        trackId: string;
    };
    'clip:added': {
        clip: IClip;
        trackId: string;
    };
    'clips:added': {
        clips: IClip[];
        trackId?: string;
    };
    'clip:removed': {
        clipId: string;
    };
    'clip:updated': {
        clip: IClip;
    };
    'clip:replaced': {
        oldClip: IClip;
        newClip: IClip;
        trackId: string;
    };
    'studio:restored': {
        clips: IClip[];
        tracks: StudioTrack[];
        settings: IStudioOpts;
    };
    currentTime: {
        currentTime: number;
    };
    play: {
        isPlaying: boolean;
    };
    pause: {
        isPlaying: boolean;
    };
    [key: string]: any;
    [key: symbol]: any;
}
export interface StudioTrack {
    id: string;
    name: string;
    type: string;
    clipIds: string[];
}
export declare class Studio extends EventEmitter<StudioEvents> {
    selection: SelectionManager;
    transport: Transport;
    timeline: TimelineModel;
    pixiApp: Application | null;
    get tracks(): StudioTrack[];
    get clips(): IClip[];
    spriteRenderers: Map<IClip, PixiSpriteRenderer>;
    artboard: Container | null;
    clipContainer: Container | null;
    artboardMask: Graphics | null;
    artboardBg: Graphics | null;
    get activeTransformer(): Transformer | null;
    set activeTransformer(val: Transformer | null);
    get selectedClips(): Set<IClip>;
    set selectedClips(val: Set<IClip>);
    get interactiveClips(): Set<IClip>;
    set interactiveClips(val: Set<IClip>);
    get playbackElements(): Map<IClip, import('./studio/transport').PlaybackElementInfo>;
    videoSprites: Map<IClip, Sprite>;
    clipListeners: Map<IClip, () => void>;
    get isPlaying(): boolean;
    set isPlaying(val: boolean);
    get currentTime(): number;
    set currentTime(val: number);
    get maxDuration(): number;
    set maxDuration(val: number);
    opts: Required<Omit<IStudioOpts, 'canvas'>> & {
        canvas?: HTMLCanvasElement;
    };
    destroyed: boolean;
    private renderingSuspended;
    globalEffects: Map<string, GlobalEffectInfo>;
    activeGlobalEffect: ActiveGlobalEffect | null;
    currentGlobalEffectSprite: Sprite | null;
    effectFilters: Map<string, {
        filter: import('pixi.js').Filter;
        render({ width, height, canvasTexture, progress }: import('./effect/types').EffectRendererOptions): RenderTexture;
    }>;
    transitionRenderers: Map<string, {
        render({ width, height, from, to, progress }: import('./transition/types').TransitionRendererOptions): RenderTexture;
        destroy(): void;
    }>;
    transitionSprites: Map<string, Sprite>;
    transFromTexture: RenderTexture | null;
    transToTexture: RenderTexture | null;
    transBgGraphics: Graphics | null;
    clipsNormalContainer: Container | null;
    clipsEffectContainer: Container | null;
    videoTextureCache: WeakMap<HTMLVideoElement, Texture<import('pixi.js').TextureSource<any>>>;
    lastFromFrame: Texture | ImageBitmap | null;
    lastToFrame: Texture | ImageBitmap | null;
    /**
     * Convert hex color string to number
     */
    private hexToNumber;
    ready: Promise<void>;
    /**
     * Create a new Studio instance
     */
    constructor(opts: IStudioOpts);
    private handleTimelineChange;
    private handleClipRemoved;
    private initPixiApp;
    /**
     * Get studio options
     */
    getOptions(): IStudioOpts;
    /**
     * Update studio dimensions
     */
    updateDimensions(width: number, height: number): void;
    private handleResize;
    private updateArtboardLayout;
    /**
     * Get the canvas element (creates one if not provided)
     */
    getCanvas(): HTMLCanvasElement;
    /**
     * Add a Media clip (Video/Image) to the main track with ripple effect
     */
    /**
     * Add a Media clip (Video/Image) to the main track with ripple effect
     */
    addMedia(clip: VideoClip | ImageClip): Promise<void>;
    addTransition(transitionKey: string, duration?: number, fromClipId?: string | null, toClipId?: string | null): Promise<void>;
    findTrackIdByClipId(clipId: string): string | undefined;
    /**
     * Add a clip (or clips) to the studio
     * @param clipOrClips The clip or array of clips to add
     * @param options Options for addition (trackId, etc.)
     */
    addClip(clipOrClips: IClip | IClip[], options?: {
        trackId?: string;
        audioSource?: string | File | Blob;
    } | string | File | Blob): Promise<void>;
    /**
     * Add a new track to the studio
     */
    addTrack(track: {
        name: string;
        type: string;
        id?: string;
    }): StudioTrack;
    setTracks(tracks: StudioTrack[]): Promise<void>;
    removeTrack(trackId: string): Promise<void>;
    /**
     * Get a clip by its ID
     */
    getClipById(id: string): IClip | undefined;
    updateClip(id: string, updates: Partial<IClip>): Promise<void>;
    updateClips(updates: {
        id: string;
        updates: Partial<IClip>;
    }[]): Promise<void>;
    suspendRendering(): void;
    resumeRendering(): void;
    getTracks(): StudioTrack[];
    getClip(id: string): IClip | undefined;
    /**
     * Setup sprite interactivity for click selection
     * Delegated to SelectionManager
     */
    setupSpriteInteractivity(clip: IClip): void;
    /**
     * Setup playback element for a clip (if it supports playback)
     */
    /**
     * Remove a clip from the studio
     */
    removeClip(clip: IClip): Promise<void>;
    removeClipById(clipId: string): Promise<void>;
    deleteSelected(): Promise<void>;
    /**
     * Duplicate all currently selected clips
     */
    duplicateSelected(): Promise<void>;
    splitSelected(splitTime?: number): Promise<void>;
    trimSelected(trimFromSeconds: number): Promise<void>;
    updateSelected(updates: Partial<IClip>): Promise<void>;
    /**
     * Clear all clips from the studio
     */
    clear(): Promise<void>;
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
    /**
     * Get current playback time (in microseconds)
     */
    getCurrentTime(): number;
    /**
     * Get maximum duration (in microseconds)
     */
    getMaxDuration(): number;
    /**
     * Check if currently playing
     */
    getIsPlaying(): boolean;
    /**
     * Get currently selected clips
     */
    getSelectedClips(): IClip[];
    private getVideoTexture;
    private isPlaybackCapable;
    updateFrame(timestamp: number): Promise<void>;
    /**
     * Apply global effect to the current scene
     */
    moveClipToEffectContainer(clip: IClip, toEffect?: boolean): void;
    applyGlobalEffect(key: EffectKey, options: {
        startTime: number;
        duration?: number;
        id?: string;
    }, clips: IClip[]): string;
    getTrackIndex(clipId: string): number;
    /**
     * Get the frame from the previous clip on the same track for transition
     */
    getTransitionFromFrame(clip: IClip, timestamp: number): Promise<ImageBitmap | null | Texture>;
    private getPreviousClipOnTrack;
    /**
     * Renders a clip frame onto a transition texture with red background
     */
    private renderClipToTransitionTexture;
    removeGlobalEffect(id: string): void;
    clearGlobalEffects(): void;
    private updateActiveGlobalEffect;
    private applyGlobalEffectIfNeeded;
    /**
     * Destroy the studio and clean up resources
     */
    destroy(): void;
    /**
     * Select a clip and show transform controls
     * Delegated to InteractionManager
     */
    selectClip(clip: IClip, addToSelection?: boolean): void;
    /**
     * Set the selection to a specific list of clips
     */
    setSelection(clips: IClip[]): void;
    /**
     * Select clips by their IDs
     */
    selectClipsByIds(ids: string[]): void;
    /**
     * Deselect the current clip and hide transform controls
     */
    deselectClip(): void;
    /**
     * Export current studio state to JSON
     * @param sourceUrlMap Optional map of clips to their source URLs (required for proper serialization)
     */
    exportToJSON(): ProjectJSON;
    loadFromJSON(json: ProjectJSON): Promise<void>;
}
export {};
